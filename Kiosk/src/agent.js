require('dotenv').config();

const path = require('node:path');
const express = require('express');
const { listPrinters } = require('./printers');
const serverApi = require('./serverApi');
const { downloadFile, printPdf, cleanupFile } = require('./printService');
const { queryPrinterConsumables } = require('./snmp');
const {
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
  recordCompletionMetrics
} = require('./state');

const app = express();
const port = Number(process.env.PORT || 4173);
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 10000);
const printerSyncMs = Number(process.env.PRINTER_SYNC_MS || 30000);
const lifecycleSweepMs = Number(process.env.LIFECYCLE_SWEEP_MS || 60000);
const snmpEnabled = String(process.env.SNMP_ENABLED || 'false').toLowerCase() === 'true';
const snmpCommunity = process.env.SNMP_COMMUNITY || 'public';
const snmpTimeoutMs = Number(process.env.SNMP_TIMEOUT_MS || 2000);

let pollingBusy = false;
let printerSyncBusy = false;
let queueBusy = false;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

function normalizeJob(rawJob = {}) {
  const id = rawJob.id || rawJob.jobId || `job-${Date.now()}-${Math.round(Math.random() * 1000)}`;
  const pages = Number(rawJob.pages || 1);
  const copies = Number(rawJob.copies || 1);

  return {
    ...rawJob,
    id,
    jobId: id,
    userName: rawJob.userName || 'unknown-user',
    documentName: rawJob.documentName || rawJob.fileName || 'document.pdf',
    pages: Number.isFinite(pages) && pages > 0 ? pages : 1,
    copies: Number.isFinite(copies) && copies > 0 ? copies : 1,
    color: Boolean(rawJob.color),
    paperSize: rawJob.paperSize || 'A4'
  };
}

function fingerprintForJob(job) {
  return [job.userName, job.documentName, job.fileUrl, job.pages, job.copies].join('|');
}

function estimateCost(job) {
  const pagesToBill = Number(job.pages || 1) * Number(job.copies || 1);
  const rate = job.color ? state.settings.pricing.colorPerPage : state.settings.pricing.bwPerPage;
  return Number((pagesToBill * rate).toFixed(2));
}

function classifyError(errorMessage = '') {
  const text = String(errorMessage).toLowerCase();
  if (text.includes('timeout')) {
    return 'TIMEOUT';
  }
  if (text.includes('offline') || text.includes('not found')) {
    return 'PRINTER_OFFLINE_OR_MISSING';
  }
  if (text.includes('access') || text.includes('permission')) {
    return 'ACCESS_DENIED';
  }
  if (text.includes('pdf') || text.includes('format')) {
    return 'INVALID_DOCUMENT';
  }
  return 'UNKNOWN_PRINT_ERROR';
}

function resolvePrinterForJob(job) {
  if (job.printerName) {
    return job.printerName;
  }

  for (const rule of state.settings.routingRules) {
    if (rule.routeToPrinter && job[rule.key] === rule.match) {
      return rule.routeToPrinter;
    }
  }

  const onlinePrinter = state.printers.find((printer) => !printer.workOffline);
  if (onlinePrinter) {
    return onlinePrinter.name;
  }

  return state.printers[0]?.name || 'Unknown Printer';
}

function enrichPrinters() {
  const jobStats = new Map();

  for (const job of state.jobs) {
    const key = job.printerName || 'Unknown Printer';
    const current = jobStats.get(key) || { printed: 0, failed: 0, pages: 0 };
    if (job.status === 'PRINTED') {
      current.printed += 1;
      current.pages += Number(job.pages || 1) * Number(job.copies || 1);
    }
    if (job.status === 'FAILED') {
      current.failed += 1;
    }
    jobStats.set(key, current);
  }

  return state.printers.map((printer) => {
    const stats = jobStats.get(printer.name) || { printed: 0, failed: 0, pages: 0 };
    const total = stats.printed + stats.failed;
    const failRate = total > 0 ? stats.failed / total : 0;
    const offlinePenalty = printer.workOffline ? 30 : 0;
    const healthScore = Math.max(0, Math.round(100 - failRate * 70 - offlinePenalty));
    const supplyCandidates = Array.isArray(printer.consumables) ? printer.consumables : [];
    const blackSupply = supplyCandidates.find((supply) => /black|k\b|toner/i.test(String(supply.description || '')));
    const anySupply = supplyCandidates[0] || null;
    const snmpInk = Number((blackSupply || anySupply || {}).percent);
    const inkLevel = Number.isFinite(snmpInk) ? snmpInk : Math.max(5, Math.round(100 - stats.pages * 0.4));
    const estimatedPagesLeft = Math.max(0, Math.round((inkLevel / 100) * 600));

    return {
      ...printer,
      icon: printer.workOffline ? 'offline-printer' : 'online-printer',
      healthScore,
      inkLevel,
      estimatedPagesLeft
    };
  });
}

function computeSla() {
  const completed = state.metrics.successfulJobs + state.metrics.failedJobs;
  const successRate = completed > 0 ? (state.metrics.successfulJobs / completed) * 100 : 0;
  const avgLatencyMs = state.metrics.successfulJobs
    ? Math.round(state.metrics.totalLatencyMs / state.metrics.successfulJobs)
    : 0;
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  const jobsLastHour = state.metrics.completedTimestamps.filter((ts) => ts >= oneHourAgo).length;

  return {
    successRate: Number(successRate.toFixed(2)),
    avgLatencyMs,
    jobsLastHour
  };
}

function computeDiagnostics() {
  const grouped = {};
  for (const job of state.jobs) {
    if (job.status !== 'FAILED') {
      continue;
    }
    const key = job.diagnostic || 'UNKNOWN_PRINT_ERROR';
    grouped[key] = (grouped[key] || 0) + 1;
  }
  return grouped;
}

function computeReconciliation() {
  const paid = state.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const expected = Number(state.metrics.totalRevenue || 0);
  return {
    expected: Number(expected.toFixed(2)),
    paid: Number(paid.toFixed(2)),
    delta: Number((paid - expected).toFixed(2))
  };
}

function dashboardSnapshot() {
  return {
    health: {
      ok: true,
      serverConnected: serverApi.isEnabled(),
      startedAt: state.startedAt,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastPollAt: state.lastPollAt,
      queuePaused: state.queuePaused
    },
    queue: {
      count: state.queue.length,
      jobs: state.queue.slice(0, 100)
    },
    metrics: {
      totalJobs: state.metrics.totalJobs,
      successfulJobs: state.metrics.successfulJobs,
      failedJobs: state.metrics.failedJobs,
      totalRevenue: Number(state.metrics.totalRevenue.toFixed(2)),
      totalPages: state.metrics.totalPages
    },
    sla: computeSla(),
    reconciliation: computeReconciliation(),
    diagnostics: computeDiagnostics(),
    printers: enrichPrinters(),
    jobs: state.jobs.slice(0, 200),
    notifications: state.notifications.slice(0, 100),
    auditLogs: state.auditLogs.slice(0, 100)
  };
}

function queueJob(rawJob, actor = 'system') {
  const job = normalizeJob(rawJob);
  const fingerprint = fingerprintForJob(job);

  if (state.seenJobIds.has(job.id) || state.seenFingerprints.has(fingerprint)) {
    addLog('warn', 'Duplicate job ignored', { jobId: job.id });
    addNotification('DUPLICATE_JOB', `Duplicate prevented for ${job.id}`, 'warning', {
      jobId: job.id
    });
    return false;
  }

  state.seenJobIds.add(job.id);
  state.seenFingerprints.add(fingerprint);
  enqueueJob(job);

  upsertJob({
    jobId: job.id,
    userName: job.userName,
    documentName: job.documentName,
    fileUrl: job.fileUrl,
    pages: job.pages,
    copies: job.copies,
    color: job.color,
    paperSize: job.paperSize,
    printerName: job.printerName,
    price: estimateCost(job),
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  addAudit('JOB_QUEUED', actor, { jobId: job.id });
  return true;
}

async function executePrintAttempt(job, attempt) {
  const printerName = resolvePrinterForJob(job);
  let localFilePath;

  if (attempt === 1) {
    state.metrics.totalJobs += 1;
  }

  await serverApi.reportJobUpdate(job.id, 'RECEIVED', { printerName, attempt });

  const startedAtMs = Date.now();

  try {
    upsertJob({
      jobId: job.id,
      printerName,
      status: attempt > 1 ? 'RETRYING' : 'PRINTING',
      attempt,
      updatedAt: new Date().toISOString()
    });

    localFilePath = await downloadFile(job.fileUrl, job.id);
    await printPdf(localFilePath, printerName, Number(job.copies || 1));

    const latencyMs = Date.now() - startedAtMs;

    const completedJob = {
      jobId: job.id,
      userName: job.userName,
      documentName: job.documentName,
      pages: job.pages,
      copies: job.copies,
      color: job.color,
      paperSize: job.paperSize,
      price: estimateCost(job),
      printerName,
      status: 'PRINTED',
      attempt,
      latencyMs,
      updatedAt: new Date().toISOString()
    };

    upsertJob(completedJob);
    state.metrics.successfulJobs += 1;
    state.metrics.totalLatencyMs += latencyMs;
    recordCompletionMetrics(completedJob);

    addLog('info', 'Print completed', { jobId: job.id, printerName, attempt });
    addAudit('JOB_PRINTED', 'system', { jobId: job.id, printerName, attempt });
    await serverApi.reportJobUpdate(job.id, 'PRINTED', { printerName, attempt, latencyMs });
    return;
  } catch (error) {
    const diagnostic = classifyError(error.message);
    addLog('error', 'Print attempt failed', {
      jobId: job.id,
      printerName,
      attempt,
      diagnostic,
      error: error.message
    });

    upsertJob({
      jobId: job.id,
      printerName,
      attempt,
      diagnostic,
      status: 'RETRYING',
      updatedAt: new Date().toISOString(),
      error: error.message
    });

    throw error;
  } finally {
    await cleanupFile(localFilePath);
  }
}

async function processJobWithRetry(job) {
  const maxAttempts = Math.max(1, Number(state.settings.retry.maxAttempts || 1));
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await executePrintAttempt(job, attempt);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await serverApi.reportJobUpdate(job.id, 'RETRYING', { attempt, error: error.message });
      }
    }
  }

  state.metrics.failedJobs += 1;
  const diagnostic = classifyError(lastError?.message || 'Unknown error');

  upsertJob({
    jobId: job.id,
    status: 'FAILED',
    diagnostic,
    error: lastError?.message || 'Unknown error',
    updatedAt: new Date().toISOString()
  });

  addNotification('PRINT_FAILED', `Job ${job.id} failed: ${diagnostic}`, 'error', { jobId: job.id });
  addAudit('JOB_FAILED', 'system', { jobId: job.id, diagnostic });
  await serverApi.reportJobUpdate(job.id, 'FAILED', {
    diagnostic,
    error: lastError?.message || 'Unknown error'
  });
}

async function processQueue() {
  if (queueBusy || state.queuePaused) {
    return;
  }

  queueBusy = true;

  try {
    while (!state.queuePaused && state.queue.length > 0) {
      const job = dequeueJob();
      if (!job) {
        break;
      }

      await processJobWithRetry(job);
    }
  } finally {
    queueBusy = false;
  }
}

app.get('/api/health', (_req, res) => {
  res.json(dashboardSnapshot().health);
});

app.get('/api/dashboard', (_req, res) => {
  res.json(dashboardSnapshot());
});

app.get('/api/printers', async (_req, res) => {
  try {
    res.json({ printers: enrichPrinters() });
  } catch (error) {
    addLog('error', 'Failed to list printers', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/jobs', (_req, res) => {
  res.json({ jobs: state.jobs });
});

app.get('/api/queue', (_req, res) => {
  res.json({ queuePaused: state.queuePaused, jobs: state.queue });
});

app.post('/api/queue/pause', (req, res) => {
  const actor = req.body?.actor || 'dashboard-user';
  state.queuePaused = true;
  addAudit('QUEUE_PAUSED', actor);
  res.json({ ok: true, queuePaused: state.queuePaused });
});

app.post('/api/queue/resume', async (req, res) => {
  const actor = req.body?.actor || 'dashboard-user';
  state.queuePaused = false;
  addAudit('QUEUE_RESUMED', actor);
  await processQueue();
  res.json({ ok: true, queuePaused: state.queuePaused });
});

app.delete('/api/queue/:jobId', (req, res) => {
  const actor = req.body?.actor || 'dashboard-user';
  const removed = removeQueuedJob(req.params.jobId);
  if (!removed) {
    return res.status(404).json({ error: 'Queued job not found' });
  }
  upsertJob({ jobId: req.params.jobId, status: 'CANCELLED', updatedAt: new Date().toISOString() });
  addAudit('QUEUE_JOB_CANCELLED', actor, { jobId: req.params.jobId });
  return res.json({ ok: true });
});

app.get('/api/logs', (_req, res) => {
  res.json({ logs: state.logs });
});

app.get('/api/audit', (_req, res) => {
  res.json({ auditLogs: state.auditLogs });
});

app.get('/api/notifications', (_req, res) => {
  res.json({ notifications: state.notifications });
});

app.post('/api/estimate-cost', (req, res) => {
  const job = normalizeJob(req.body || {});
  res.json({ estimatedCost: estimateCost(job) });
});

app.post('/api/payments', (req, res) => {
  registerPayment(req.body || {});
  addAudit('PAYMENT_REGISTERED', req.body?.actor || 'dashboard-user', {
    amount: Number(req.body?.amount || 0),
    ref: req.body?.ref || null
  });
  res.json({ ok: true, reconciliation: computeReconciliation() });
});

app.get('/api/reconciliation', (_req, res) => {
  res.json(computeReconciliation());
});

app.get('/api/reports/jobs.csv', (_req, res) => {
  const headers = [
    'jobId',
    'userName',
    'documentName',
    'status',
    'printerName',
    'pages',
    'copies',
    'price',
    'updatedAt'
  ];

  const lines = [
    headers.join(','),
    ...state.jobs.map((job) =>
      [
        job.jobId,
        job.userName,
        job.documentName,
        job.status,
        job.printerName,
        job.pages,
        job.copies,
        job.price,
        job.updatedAt
      ]
        .map((item) => `"${String(item ?? '').replaceAll('"', '""')}"`)
        .join(',')
    )
  ];

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="jobs-report.csv"');
  res.send(lines.join('\n'));
});

app.post('/api/settings/routing', (req, res) => {
  if (!Array.isArray(req.body?.routingRules)) {
    return res.status(400).json({ error: 'routingRules must be an array' });
  }

  state.settings.routingRules = req.body.routingRules;
  addAudit('ROUTING_RULES_UPDATED', req.body?.actor || 'dashboard-user', {
    count: state.settings.routingRules.length
  });
  return res.json({ ok: true, routingRules: state.settings.routingRules });
});

app.post('/api/settings/lifecycle', (req, res) => {
  const retentionHours = Number(req.body?.historyRetentionHours);
  if (!Number.isFinite(retentionHours) || retentionHours < 1) {
    return res.status(400).json({ error: 'historyRetentionHours must be >= 1' });
  }

  state.settings.lifecycle.historyRetentionHours = retentionHours;
  addAudit('LIFECYCLE_UPDATED', req.body?.actor || 'dashboard-user', { retentionHours });
  return res.json({ ok: true, lifecycle: state.settings.lifecycle });
});

app.post('/api/logout', async (req, res) => {
  const actor = req.body?.actor || 'dashboard-user';
  addAudit('LOGOUT', actor);
  await serverApi.sendEvent('AGENT_LOGOUT', { actor });
  res.json({ ok: true });
});

app.post('/api/jobs/print', async (req, res) => {
  const { jobId, fileUrl, printerName, copies, userName, documentName, pages, color, paperSize, actor } =
    req.body || {};

  if (!fileUrl) {
    return res.status(400).json({ error: 'fileUrl is required' });
  }

  try {
    const queued = queueJob(
      {
      id: jobId || `manual-${Date.now()}`,
      fileUrl,
      printerName,
      copies: Number(copies || 1),
      userName,
      documentName,
      pages,
      color,
      paperSize
      },
      actor || 'dashboard-user'
    );

    if (!queued) {
      return res.status(202).json({ ok: true, duplicate: true });
    }

    await processQueue();

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

async function syncPrinterStatus() {
  if (printerSyncBusy) {
    return;
  }

  printerSyncBusy = true;

  try {
    const printers = await listPrinters();

    const enrichedPrinters = await Promise.all(
      printers.map(async (printer) => {
        try {
          const snmpData = await queryPrinterConsumables(printer, {
            enabled: snmpEnabled,
            community: snmpCommunity,
            timeoutMs: snmpTimeoutMs
          });

          if (!snmpData) {
            return printer;
          }

          return {
            ...printer,
            snmpHost: snmpData.host,
            consumables: snmpData.consumables,
            snmpSampledAt: snmpData.sampledAt
          };
        } catch {
          return printer;
        }
      })
    );

    setPrinters(enrichedPrinters);
    const offlinePrinters = enrichedPrinters.filter((printer) => printer.workOffline);
    if (offlinePrinters.length > 0) {
      addNotification(
        'PRINTER_OFFLINE',
        `${offlinePrinters.length} printer(s) are offline`,
        'warning',
        { names: offlinePrinters.map((printer) => printer.name) }
      );
    }
    await serverApi.reportPrinterStatus(enrichedPrinters);
  } catch (error) {
    addLog('error', 'Failed to sync printer status', { error: error.message });
  } finally {
    printerSyncBusy = false;
  }
}

async function pollPendingJobs() {
  if (pollingBusy) {
    return;
  }

  pollingBusy = true;

  try {
    state.lastPollAt = new Date().toISOString();
    const jobs = await serverApi.fetchPendingJobs();

    for (const job of jobs) {
      queueJob(job, 'server-poll');
    }

    await processQueue();
  } catch (error) {
    addLog('error', 'Failed to poll jobs', { error: error.message });
  } finally {
    pollingBusy = false;
  }
}

app.listen(port, () => {
  addLog('info', 'Kiosk web agent started', {
    port,
    serverConnected: serverApi.isEnabled()
  });

  console.log(`Kiosk web agent running on http://localhost:${port}`);

  // Kick off once on startup, then run intervals.
  syncPrinterStatus();
  pollPendingJobs();

  setInterval(() => {
    touchHeartbeat();
    trimOldJobs();
  }, lifecycleSweepMs);

  setInterval(syncPrinterStatus, printerSyncMs);
  setInterval(pollPendingJobs, pollIntervalMs);
});
