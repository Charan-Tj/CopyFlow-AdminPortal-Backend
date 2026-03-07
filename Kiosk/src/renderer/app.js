/* global agentApi, registrationApi */

const state = {
  snapshot: null,
  selectedPrinter: 'ALL',
  logs: []
};

const el = {
  healthSummary: document.getElementById('healthSummary'),
  summaryCards: document.getElementById('summaryCards'),
  printersList: document.getElementById('printersList'),
  queuePrinterFilter: document.getElementById('queuePrinterFilter'),
  queueTableBody: document.getElementById('queueTableBody'),
  recentJobsTableBody: document.getElementById('recentJobsTableBody'),
  alertsList: document.getElementById('alertsList'),
  logsPanel: document.getElementById('logsPanel'),
  addMockJobBtn: document.getElementById('addMockJobBtn'),
  // Registration overlay elements
  registrationOverlay: document.getElementById('registrationOverlay'),
  regCodeInput: document.getElementById('regCodeInput'),
  regValidateBtn: document.getElementById('regValidateBtn'),
  regCodeError: document.getElementById('regCodeError'),
  regStepCode: document.getElementById('regStepCode'),
  regStepPreview: document.getElementById('regStepPreview'),
  regStepWorking: document.getElementById('regStepWorking'),
  regNodePreview: document.getElementById('regNodePreview'),
  regEmailInput: document.getElementById('regEmailInput'),
  regPasswordInput: document.getElementById('regPasswordInput'),
  regPasswordConfirm: document.getElementById('regPasswordConfirm'),
  regRegisterError: document.getElementById('regRegisterError'),
  regBackBtn: document.getElementById('regBackBtn'),
  regRegisterBtn: document.getElementById('regRegisterBtn'),
  regWorkingMsg: document.getElementById('regWorkingMsg')
};

// ── Registration Wizard ────────────────────────────────────────────────────

function showRegistrationOverlay() {
  el.registrationOverlay.style.display = 'flex';
}

function hideRegistrationOverlay() {
  el.registrationOverlay.style.display = 'none';
}

function regShowStep(step) {
  el.regStepCode.style.display = step === 'code' ? 'grid' : 'none';
  el.regStepPreview.style.display = step === 'preview' ? 'grid' : 'none';
  el.regStepWorking.style.display = step === 'working' ? 'grid' : 'none';
}

function regSetCodeError(msg) {
  if (msg) {
    el.regCodeError.textContent = msg;
    el.regCodeError.style.display = 'block';
  } else {
    el.regCodeError.style.display = 'none';
  }
}

function regSetRegisterError(msg) {
  if (msg) {
    el.regRegisterError.textContent = msg;
    el.regRegisterError.style.display = 'block';
  } else {
    el.regRegisterError.style.display = 'none';
  }
}

async function handleValidateCode() {
  const code = el.regCodeInput.value.trim();
  if (!code) {
    regSetCodeError('Please enter the registration code.');
    return;
  }
  regSetCodeError(null);
  el.regValidateBtn.disabled = true;
  el.regValidateBtn.textContent = 'Validating…';

  try {
    const result = await registrationApi.validate(code);
    const node = result.node;
    el.regNodePreview.innerHTML = `
      <strong>${node.name}</strong><br/>
      ${node.college}<br/>
      <span style="color:#6a7d91">${node.city} &nbsp;·&nbsp; Code: ${node.node_code}</span>
    `;
    regShowStep('preview');
  } catch (err) {
    regSetCodeError(err?.message || 'Invalid or expired registration code.');
  } finally {
    el.regValidateBtn.disabled = false;
    el.regValidateBtn.textContent = 'Validate';
  }
}

async function handleRegister() {
  const code = el.regCodeInput.value.trim();
  const email = el.regEmailInput.value.trim();
  const password = el.regPasswordInput.value;
  const confirm = el.regPasswordConfirm.value;

  if (!email) { regSetRegisterError('Email is required.'); return; }
  if (password.length < 8) { regSetRegisterError('Password must be at least 8 characters.'); return; }
  if (password !== confirm) { regSetRegisterError('Passwords do not match.'); return; }
  regSetRegisterError(null);

  regShowStep('working');
  el.regWorkingMsg.textContent = 'Registering node…';

  const result = await registrationApi.complete(code, email, password);

  if (result.ok) {
    el.regWorkingMsg.textContent = `Registered as ${result.node?.name || 'node'}. Starting agent…`;
    // Overlay will disappear once the worker emits state:update with workerStatus running
    setTimeout(hideRegistrationOverlay, 1800);
  } else {
    regShowStep('preview');
    regSetRegisterError(result.message || 'Registration failed. Please try again.');
  }
}

function bindRegistrationEvents() {
  el.regValidateBtn.addEventListener('click', handleValidateCode);

  el.regCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleValidateCode();
    }
  });

  el.regBackBtn.addEventListener('click', () => {
    regSetRegisterError(null);
    regShowStep('code');
  });

  el.regRegisterBtn.addEventListener('click', handleRegister);
}


function safe(value, fallback = '-') {
  return value ?? fallback;
}

function render() {
  if (!state.snapshot) {
    return;
  }

  renderHealth();
  renderSummary();
  renderPrinters();
  renderQueueFilter();
  renderQueueTable();
  renderRecentJobs();
  renderAlerts();
  renderLogs();
}

function renderHealth() {
  const health = state.snapshot.health;
  const api = health.apiReachable ? 'API: connected' : 'API: disconnected';
  const worker = `Worker: ${health.workerStatus}`;
  const heartbeat = health.lastHeartbeatAt ? `Last heartbeat: ${new Date(health.lastHeartbeatAt).toLocaleTimeString()}` : 'Last heartbeat: -';
  el.healthSummary.textContent = `${worker} | ${api} | ${heartbeat}`;
}

function renderSummary() {
  const snapshot = state.snapshot;
  const printers = snapshot.printers || [];
  const queuedJobs = Object.values(snapshot.queues || {}).reduce((sum, queue) => sum + queue.length, 0);
  const recentJobs = snapshot.recentJobs || [];
  const failed24h = recentJobs.filter((job) => job.status === 'failed').length;
  const success24h = recentJobs.filter((job) => job.status === 'completed' || job.status === 'success').length;

  const metrics = [
    { title: 'Total Printers', value: printers.length },
    { title: 'Online Printers', value: printers.filter((p) => p.status !== 'offline').length },
    { title: 'Busy Printers', value: printers.filter((p) => p.status === 'busy').length },
    { title: 'Queued Jobs', value: queuedJobs },
    { title: 'Success Jobs', value: success24h },
    { title: 'Failed Jobs', value: failed24h },
    { title: 'Unacked Alerts', value: (snapshot.alerts || []).filter((a) => !a.acknowledged).length }
  ];

  el.summaryCards.innerHTML = metrics
    .map((metric) => {
      const accent = metric.title === 'Success Jobs' ? ' style="color:var(--ok)"' : '';
      return `<div class="card"><h3>${metric.title}</h3><strong${accent}>${metric.value}</strong></div>`;
    })
    .join('');
}

function renderPrinters() {
  const snapshot = state.snapshot;
  const pausedSet = new Set(snapshot.pausedPrinters || []);

  el.printersList.innerHTML = (snapshot.printers || [])
    .map((printer) => {
      const queueLength = (snapshot.queues[printer.name] || []).length;
      const active = snapshot.activeJobs[printer.name];
      const paused = pausedSet.has(printer.name);

      return `
        <div class="printer-card">
          <div class="printer-top">
            <strong>${printer.name}</strong>
            <span class="badge ${printer.status}">${printer.status}</span>
          </div>
          <div class="small">Model: ${safe(printer.model)}</div>
          <div class="small">Queue: ${queueLength} | Active: ${active ? active.jobId : '-'}</div>
          <div>
            ${paused
              ? `<button class="btn secondary" data-action="resume-queue" data-printer="${printer.name}">Resume Queue</button>`
              : `<button class="btn warn" data-action="pause-queue" data-printer="${printer.name}">Pause Queue</button>`}
          </div>
        </div>
      `;
    })
    .join('');

  el.printersList.querySelectorAll('button[data-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      await agentApi.performAction({
        type: button.dataset.action,
        printerName: button.dataset.printer
      });
    });
  });
}

function renderQueueFilter() {
  const printers = state.snapshot.printers || [];
  const options = ['ALL', ...printers.map((p) => p.name)];
  el.queuePrinterFilter.innerHTML = options
    .map((name) => `<option value="${name}" ${state.selectedPrinter === name ? 'selected' : ''}>${name}</option>`)
    .join('');
}

function renderQueueTable() {
  const rows = [];
  const queues = state.snapshot.queues || {};

  Object.entries(queues).forEach(([printerName, jobs]) => {
    if (state.selectedPrinter !== 'ALL' && state.selectedPrinter !== printerName) {
      return;
    }
    jobs.forEach((job) => {
      rows.push({ printerName, ...job });
    });
  });

  if (rows.length === 0) {
    el.queueTableBody.innerHTML = '<tr><td colspan="6">No queued jobs</td></tr>';
    return;
  }

  el.queueTableBody.innerHTML = rows
    .map((job) => {
      const shortName = (job.fileName || '').replace(/.*[\\/]/, '') || job.fileName || '-';
      return `
      <tr>
        <td title="${job.jobId}">${job.jobId}</td>
        <td title="${job.printerName}">${job.printerName}</td>
        <td title="${job.fileName || ''}">${shortName}</td>
        <td>${job.owner}</td>
        <td>${job.priority}</td>
        <td>${job.status}</td>
      </tr>
    `;
    })
    .join('');
}

function renderRecentJobs() {
  const jobs = (state.snapshot.recentJobs || []).slice(0, 50);
  if (jobs.length === 0) {
    el.recentJobsTableBody.innerHTML = '<tr><td colspan="7">No completed jobs yet</td></tr>';
    return;
  }

  el.recentJobsTableBody.innerHTML = jobs
    .map((job) => {
      const pages = job.settings
        ? (job.settings.pageCount || 1) * (job.settings.copies || 1)
        : '-';
      const duration = job.durationMs ? `${(job.durationMs / 1000).toFixed(1)} s` : '-';
      return `
        <tr>
          <td>${job.jobId}</td>
          <td>${safe(job.assignedPrinter)}</td>
          <td><span class="badge ${job.status}">${job.status}</span></td>
          <td>${pages}</td>
          <td>${duration}</td>
          <td>${job.completedAt ? new Date(job.completedAt).toLocaleString() : '-'}</td>
          <td>${safe(job.lastError)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAlerts() {
  const alerts = (state.snapshot.alerts || []).slice(0, 20);
  if (alerts.length === 0) {
    el.alertsList.innerHTML = '<div class="small">No alerts</div>';
    return;
  }

  el.alertsList.innerHTML = alerts
    .map(
      (alert) => `
      <div class="alert">
        <div><strong>${alert.type}</strong></div>
        <div class="small">${alert.message}</div>
        <div class="small">${new Date(alert.updatedAt).toLocaleString()}</div>
        ${alert.acknowledged ? '<div class="small">Acknowledged</div>' : `<button class="btn secondary" data-alert-id="${alert.id}">Acknowledge</button>`}
      </div>
    `
    )
    .join('');

  el.alertsList.querySelectorAll('button[data-alert-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await agentApi.performAction({ type: 'ack-alert', alertId: button.dataset.alertId });
    });
  });
}

function renderLogs() {
  el.logsPanel.textContent = state.logs.slice(-200).join('\n');
  el.logsPanel.scrollTop = el.logsPanel.scrollHeight;
}

function bindEvents() {
  el.queuePrinterFilter.addEventListener('change', () => {
    state.selectedPrinter = el.queuePrinterFilter.value;
    renderQueueTable();
  });

  el.addMockJobBtn.addEventListener('click', async () => {
    await agentApi.performAction({
      type: 'enqueue-mock-job',
      printerName: state.selectedPrinter === 'ALL' ? undefined : state.selectedPrinter
    });
  });
}

async function bootstrap() {
  bindEvents();
  bindRegistrationEvents();

  state.snapshot = await agentApi.getSnapshot();

  // If the agent is already waiting for registration (app restarted without creds)
  if (state.snapshot?.health?.workerStatus === 'unregistered') {
    showRegistrationOverlay();
    regShowStep('code');
  }

  render();

  agentApi.onStateUpdate((snapshot) => {
    state.snapshot = snapshot;
    // Once the worker starts after registration, hide the overlay
    if (snapshot?.health?.workerStatus === 'running') {
      hideRegistrationOverlay();
    }
    render();
  });

  // Backend sent registration:required event (first-ever launch)
  agentApi.onRegistrationRequired(() => {
    showRegistrationOverlay();
    regShowStep('code');
  });

  agentApi.onLog((entry) => {
    state.logs.push(`[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`);
    if (entry.extra) {
      state.logs.push(`  ${JSON.stringify(entry.extra)}`);
    }
    renderLogs();
  });
}

bootstrap();
