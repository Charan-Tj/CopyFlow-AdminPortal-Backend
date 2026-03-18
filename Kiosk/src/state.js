const MAX_LOGS = 300;
const MAX_JOBS = 500;
const MAX_AUDIT = 500;
const MAX_NOTIFICATIONS = 200;

const state = {
  startTimestamp: Date.now(),
  startedAt: new Date().toISOString(),
  lastHeartbeatAt: new Date().toISOString(),
  lastPollAt: null,
  eventSequenceNumber: 0,
  queuePaused: false,
  queue: [],
  printers: [],
  jobs: [],
  logs: [],
  auditLogs: [],
  notifications: [],
  payments: [],
  seenJobIds: new Set(),
  seenFingerprints: new Set(),
  metrics: {
    totalJobs: 0,
    successfulJobs: 0,
    failedJobs: 0,
    totalRevenue: 0,
    totalPages: 0,
    totalLatencyMs: 0,
    completedTimestamps: []
  },
  settings: {
    pricing: {
      bwPerPage: Number(process.env.PRICE_BW_PER_PAGE || 2),
      colorPerPage: Number(process.env.PRICE_COLOR_PER_PAGE || 5)
    },
    retry: {
      maxAttempts: Number(process.env.RETRY_MAX_ATTEMPTS || 2)
    },
    lifecycle: {
      historyRetentionHours: Number(process.env.JOB_HISTORY_RETENTION_HOURS || 48)
    },
    routingRules: [
      { key: 'color', match: true, routeToPrinter: null },
      { key: 'paperSize', match: 'A3', routeToPrinter: null }
    ]
  }
};

function addLog(level, message, meta = {}) {
  state.lastHeartbeatAt = new Date().toISOString();

  state.logs.unshift({
    time: new Date().toISOString(),
    level,
    message,
    meta
  });

  if (state.logs.length > MAX_LOGS) {
    state.logs.length = MAX_LOGS;
  }
}

function setPrinters(printers) {
  state.printers = Array.isArray(printers) ? printers : [];
}

function upsertJob(job) {
  const index = state.jobs.findIndex((entry) => entry.jobId === job.jobId);
  if (index >= 0) {
    state.jobs[index] = { ...state.jobs[index], ...job };
  } else {
    state.jobs.unshift(job);
  }

  if (state.jobs.length > MAX_JOBS) {
    state.jobs.length = MAX_JOBS;
  }
}

function enqueueJob(job) {
  state.queue.push(job);
}

function dequeueJob() {
  return state.queue.shift();
}

function removeQueuedJob(jobId) {
  const index = state.queue.findIndex((entry) => entry.id === jobId || entry.jobId === jobId);
  if (index >= 0) {
    return state.queue.splice(index, 1)[0];
  }
  return null;
}

function addAudit(action, actor = 'system', meta = {}) {
  state.auditLogs.unshift({
    time: new Date().toISOString(),
    actor,
    action,
    meta
  });

  if (state.auditLogs.length > MAX_AUDIT) {
    state.auditLogs.length = MAX_AUDIT;
  }
}

function addNotification(type, message, severity = 'info', meta = {}) {
  state.notifications.unshift({
    time: new Date().toISOString(),
    type,
    message,
    severity,
    meta
  });

  if (state.notifications.length > MAX_NOTIFICATIONS) {
    state.notifications.length = MAX_NOTIFICATIONS;
  }
}

function registerPayment(payment) {
  state.payments.unshift({
    time: new Date().toISOString(),
    amount: Number(payment.amount || 0),
    ref: payment.ref || null,
    source: payment.source || 'manual'
  });

  if (state.payments.length > MAX_JOBS) {
    state.payments.length = MAX_JOBS;
  }
}

function trimOldJobs() {
  const retentionMs = state.settings.lifecycle.historyRetentionHours * 60 * 60 * 1000;
  const threshold = Date.now() - retentionMs;
  state.jobs = state.jobs.filter((job) => {
    const updated = Date.parse(job.updatedAt || job.createdAt || state.startedAt);
    return Number.isFinite(updated) ? updated >= threshold : true;
  });
}

function touchHeartbeat() {
  state.lastHeartbeatAt = new Date().toISOString();
}

function recordCompletionMetrics(job) {
  const pages = Number(job.pages || 1) * Number(job.copies || 1);
  state.metrics.totalPages += pages;
  state.metrics.totalRevenue += Number(job.price || 0);
  state.metrics.completedTimestamps.unshift(Date.now());
  if (state.metrics.completedTimestamps.length > MAX_JOBS) {
    state.metrics.completedTimestamps.length = MAX_JOBS;
  }
}

function getUptimeSeconds() {
  return Math.floor((Date.now() - state.startTimestamp) / 1000);
}

function getNextSequenceNumber() {
  state.eventSequenceNumber += 1;
  return state.eventSequenceNumber;
}

module.exports = {
  state,
  addLog,
  setPrinters,
  upsertJob,
  enqueueJob,
  dequeueJob,
  removeQueuedJob,
  addAudit,
  addNotification,
  registerPayment,
  trimOldJobs,
  touchHeartbeat,
  recordCompletionMetrics,
  getUptimeSeconds,
  getNextSequenceNumber
};
