async function readJson(url, fallback) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }
    return await response.json();
  } catch {
    return fallback;
  }
}

async function sendJson(url, method, payload = {}) {
  const headers = { 'Content-Type': 'application/json' };

  const response = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
    throw new Error(body.error || `Request failed (${response.status})`);
  }

  return response.json().catch(() => ({}));
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

async function refresh() {
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

  const healthEl = document.getElementById('health');
  healthEl.textContent = dashboard.health.ok
    ? `Agent running | server connected: ${dashboard.health.serverConnected ? 'yes' : 'no'} | queue: ${dashboard.health.queuePaused ? 'paused' : 'active'}`
    : 'Agent health endpoint unavailable';

  const orbit = document.getElementById('printerOrbit');
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
setupTabs();

refresh();
setInterval(refresh, 5000);
