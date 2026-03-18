const SESSION_TOKEN_KEY = 'kiosk_session_token';
let sessionToken = localStorage.getItem(SESSION_TOKEN_KEY) || '';
let refreshTimer = null;

function setSessionToken(token) {
  sessionToken = token || '';
  if (sessionToken) {
    localStorage.setItem(SESSION_TOKEN_KEY, sessionToken);
  } else {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

function setFormMessage(id, message, isError = false) {
  const el = document.getElementById(id);
  if (!el) {
    return;
  }

  el.textContent = message || '';
  el.style.color = isError ? '#b3261e' : '#2f6f3e';
}

async function requestJson(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (sessionToken) {
    headers.Authorization = `Bearer ${sessionToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const body = await response.json().catch(() => ({}));

  if (response.status === 401) {
    setSessionToken('');
    showLogin();
    throw new Error('Authentication required');
  }

  if (!response.ok) {
    throw new Error(body.error || `Request failed (${response.status})`);
  }

  return body;
}

async function readJson(url, fallback) {
  try {
    return await requestJson(url);
  } catch {
    return fallback;
  }
}

async function sendJson(url, method, payload = {}) {
  return requestJson(url, {
    method,
    body: payload
  });
}

function renderList(elementId, lines) {
  const root = document.getElementById(elementId);
  root.innerHTML = '';

  if (!lines.length) {
    const li = document.createElement('li');
    li.textContent = 'No data';
    root.appendChild(li);
    return;
  }

  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    root.appendChild(li);
  }
}

function updateKioskTitle(name) {
  const title = String(name || '').trim() || 'Local Kiosk';
  const heading = document.getElementById('kioskTitle');
  if (heading) {
    heading.textContent = title;
  }
  document.title = `${title} | CopyFlow`;
}

function setupTabs() {
  const buttons = document.querySelectorAll('.menu-btn');
  const panels = document.querySelectorAll('.tab-panel');

  function activate(tabName) {
    buttons.forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === tabName);
    });

    panels.forEach((panel) => {
      const show = panel.dataset.panel === tabName;
      panel.hidden = !show;
    });
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => activate(button.dataset.tab));
  });

  activate('dashboard');
}

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('activeUser').textContent = 'Guest';
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function hideLogin(userName) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('activeUser').textContent = userName || 'User';
  if (!refreshTimer) {
    refreshTimer = setInterval(refresh, 5000);
  }
}

async function loadConnectionForm() {
  const connection = await readJson('/api/connection', null);
  if (!connection) {
    return;
  }

  document.getElementById('serverUrl').value = connection.serverUrl || '';
  document.getElementById('agentId').value = connection.agentId || '';
  document.getElementById('nodeEmail').value = connection.nodeEmail || '';
  document.getElementById('nodePassword').value = '';
  document.getElementById('pendingJobsPath').value = connection.pendingJobsPath || '/node/jobs';
  document.getElementById('eventsPath').value = connection.eventsPath || '/node/events';
  document.getElementById('loginPath').value = connection.loginPath || '/node/auth/login';
  const message = connection.connected
    ? 'Connected to backend'
    : `Disconnected${connection.lastError ? `: ${connection.lastError}` : ''}`;
  setFormMessage('connectionMessage', message, !connection.connected);
}

async function refresh() {
  if (!sessionToken) {
    return;
  }

  const [dashboard, logs] = await Promise.all([
    readJson('/api/dashboard', {
      health: { ok: false },
      metrics: {},
      queue: { jobs: [] },
      printers: [],
      jobs: [],
      sla: {},
      diagnostics: {},
      reconciliation: {},
      notifications: [],
      auditLogs: []
    }),
    readJson('/api/logs', { logs: [] })
  ]);

  updateKioskTitle(dashboard.kiosk?.name || dashboard.kiosk?.agentId || 'Local Kiosk');

  const healthEl = document.getElementById('health');
  healthEl.textContent = dashboard.health.ok
    ? `Agent running | server connected: ${dashboard.health.serverConnected ? 'yes' : 'no'} | queue: ${dashboard.health.queuePaused ? 'paused' : 'active'}`
    : 'Agent health endpoint unavailable';

  const orbit = document.getElementById('printerOrbit');
  orbit.classList.toggle('online', Boolean(dashboard.health?.serverConnected));
  const ownerBadge = document.getElementById('activeJobOwner');
  const paperName = document.getElementById('paperName');
  const activeJob = (dashboard.jobs || []).find((job) =>
    ['PRINTING', 'RETRYING', 'PROCESSING'].includes(String(job.status || '').toUpperCase())
  );

  if (activeJob) {
    const ownerName = activeJob.userName || activeJob.owner || 'Unknown user';
    ownerBadge.textContent = ownerName;
    paperName.textContent = ownerName;
    orbit.classList.add('processing');
  } else {
    ownerBadge.textContent = 'No job';
    paperName.textContent = 'No job';
    orbit.classList.remove('processing');
  }

  renderList('kpis', [
    `Total jobs: ${dashboard.metrics.totalJobs || 0}`,
    `Printed: ${dashboard.metrics.successfulJobs || 0}`,
    `Failed: ${dashboard.metrics.failedJobs || 0}`,
    `Revenue: ${dashboard.metrics.totalRevenue || 0}`,
    `Pages: ${dashboard.metrics.totalPages || 0}`
  ]);

  renderList('shopkeeperStats', [
    `Total Jobs Handled: ${dashboard.metrics.totalJobs || 0}`,
    `Successful Prints: ${dashboard.metrics.successfulJobs || 0}`,
    `Failed Prints: ${dashboard.metrics.failedJobs || 0}`,
    `Total Revenue: ${dashboard.metrics.totalRevenue || 0}`,
    `Total Pages Printed: ${dashboard.metrics.totalPages || 0}`
  ]);

  renderList(
    'queue',
    (dashboard.queue.jobs || []).map(
      (job) => `${job.id || job.jobId} | ${job.userName || '-'} | ${job.documentName || '-'} | copies: ${job.copies || 1}`
    )
  );

  renderList(
    'printers',
    (dashboard.printers || []).map(
      (printer) =>
        `${printer.icon === 'offline-printer' ? '⛔' : '🖨'} ${printer.name} | status: ${printer.printerStatus} | ink: ${printer.inkLevel}% | health: ${printer.healthScore}`
    )
  );

  renderList(
    'jobs',
    (dashboard.jobs || []).map(
      (job) =>
        `${job.jobId} | ${job.userName || '-'} | ${job.documentName || '-'} | status: ${job.status || '-'} | printer: ${job.printerName || '-'}`
    )
  );

  renderList('reconciliation', [
    `Expected: ${dashboard.reconciliation.expected || 0}`,
    `Paid: ${dashboard.reconciliation.paid || 0}`,
    `Delta: ${dashboard.reconciliation.delta || 0}`
  ]);

  renderList(
    'audit',
    (dashboard.auditLogs || []).map(
      (entry) => `${entry.time} | ${entry.actor} | ${entry.action}`
    )
  );

  renderList(
    'logs',
    (logs.logs || []).map((entry) => `${entry.time} | ${entry.level} | ${entry.message}`)
  );
}

async function submitConnection(updateOnly) {
  const payload = {
    serverUrl: document.getElementById('serverUrl').value.trim(),
    agentId: document.getElementById('agentId').value.trim(),
    nodeEmail: document.getElementById('nodeEmail').value.trim(),
    pendingJobsPath: document.getElementById('pendingJobsPath').value.trim(),
    eventsPath: document.getElementById('eventsPath').value.trim(),
    loginPath: document.getElementById('loginPath').value.trim()
  };

  const password = document.getElementById('nodePassword').value.trim();
  if (password) {
    payload.nodePassword = password;
  }

  try {
    await sendJson('/api/connection', 'POST', payload);
    setFormMessage('connectionMessage', 'Connection settings saved', false);

    if (!updateOnly) {
      const result = await sendJson('/api/connection/test', 'POST', {});
      if (result.ok) {
        setFormMessage('connectionMessage', 'Backend connection successful', false);
      }
    }

    document.getElementById('nodePassword').value = '';
    await refresh();
  } catch (error) {
    setFormMessage('connectionMessage', error.message, true);
  }
}

function registerAuthHandlers() {
  const loginForm = document.getElementById('loginForm');
  const logoutButton = document.getElementById('logoutButton');

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
      const response = await sendJson('/api/auth/login', 'POST', { username, password });
      setSessionToken(response.token || '');
      hideLogin(response.user?.name || username);
      setFormMessage('loginMessage', '');
      await loadConnectionForm();
      await refresh();
    } catch (error) {
      setFormMessage('loginMessage', error.message, true);
    }
  });

  logoutButton.addEventListener('click', async () => {
    try {
      await sendJson('/api/auth/logout', 'POST', {});
    } catch {
      // ignore network/logout cleanup errors
    }

    setSessionToken('');
    showLogin();
    setFormMessage('loginMessage', 'Signed out', false);
  });
}

function registerConnectionHandlers() {
  const connectionForm = document.getElementById('connectionForm');
  const testButton = document.getElementById('testConnectionButton');

  connectionForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await submitConnection(true);
  });

  testButton.addEventListener('click', async () => {
    await submitConnection(false);
  });
}

async function bootstrapAuth() {
  if (!sessionToken) {
    showLogin();
    return;
  }

  try {
    const session = await requestJson('/api/auth/session');
    hideLogin(session.user?.name || 'User');
    await loadConnectionForm();
    await refresh();
  } catch {
    showLogin();
  }
}

setupTabs();
registerAuthHandlers();
registerConnectionHandlers();
bootstrapAuth();
