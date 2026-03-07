const { EventEmitter } = require('events');
const { StateStore } = require('./state-store');
const { ConfigService } = require('./services/config-service');
const { PrinterService } = require('./services/printer-service');
const { JobService } = require('./services/job-service');
const { QueueService } = require('./services/queue-service');
const { PrintService } = require('./services/print-service');
const { StorageService } = require('./services/storage-service');
const { WebSocketService } = require('./services/websocket-service');
const { createLogger } = require('./utils/logger');

class Agent extends EventEmitter {
  constructor() {
    super();

    this.store = new StateStore();
    this.logger = createLogger((entry) => this.emit('log', entry));
    this.config = new ConfigService().get();

    this.printerService = new PrinterService(this.config, this.logger);
    this.jobService = new JobService(this.config, this.logger);
    this.queueService = new QueueService(this.store);
    this.printService = new PrintService(this.config, this.logger);
    this.storage = new StorageService();
    this.wsService = new WebSocketService(this.config, this.logger);

    this.intervals = [];
    this.processingPrinters = new Set();

    this.store.on('update', (snapshot) => {
      this.emit('state:update', {
        ...snapshot,
        pausedPrinters: this.queueService.getPausedPrinters()
      });
    });
  }

  async start() {
    this.logger.info('Starting CopyFlow print agent', { deviceId: this.config.deviceId });

    // If .env doesn't have credentials, check persistent storage (set by self-registration)
    if (!this.config.nodeEmail || !this.config.nodePassword) {
      const saved = this.storage.loadCredentials();
      if (saved) {
        this.config.nodeEmail = saved.email;
        this.config.nodePassword = saved.password;
        this.jobService.setCredentials(saved.email, saved.password);
        this.logger.info('Credentials loaded from local storage');
      }
    }

    // Still no credentials — show the registration wizard in the UI
    if (!this.config.nodeEmail || !this.config.nodePassword) {
      this.logger.info('No credentials found — waiting for self-registration');
      this.store.setHealth({ workerStatus: 'unregistered' });
      this.emit('registration:required');
      return;
    }

    await this._startWorker();
  }

  async _startWorker() {
    // Load persisted job history into the in-memory store so the UI shows
    // history from previous sessions immediately on launch.
    const savedHistory = this.storage.loadHistory(100);
    if (savedHistory.length > 0) {
      this.store.setRecentJobs(savedHistory);
      this.logger.info(`Loaded ${savedHistory.length} jobs from persistent storage`);
    }

    await this.refreshPrinters();
    this.store.setHealth({ workerStatus: 'running' });

    this.intervals.push(setInterval(() => this.refreshPrinters(), this.config.printerRefreshIntervalMs));
    this.intervals.push(setInterval(() => this.pollNextJob(), this.config.pollIntervalMs));
    this.intervals.push(setInterval(() => this.sendHeartbeat(), this.config.heartbeatIntervalMs));
    this.intervals.push(
      setInterval(() => this.processRetryQueue(), this.config.callbackRetryIntervalMs)
    );

    // Prune stale retry items (> 24 h old) on startup
    this.storage.pruneRetryQueue();

    // Sync with the server: discard any retry-queue items whose job IDs
    // are no longer in the server's pending list (stale from a previous session).
    await this._discardStaleRetryItems();

    // Drain any retry items that were pending before last shutdown
    await this.processRetryQueue();

    await this.sendHeartbeat();

    // Connect WebSocket for real-time job push (after login token is available)
    if (this.config.wsEnabled) {
      this.wsService.connect(() => this.jobService.getAccessToken());
      this.wsService.on('new-job', () => {
        // Backend pushed a new job — skip waiting for the next poll tick
        this.pollNextJob();
      });
    }
  }

  // ── Self-Registration ──────────────────────────────────────────────────────

  /**
   * Validate a one-time registration code (preview only, does not consume it).
   * Returns { valid, node: { name, college, city, node_code } }
   */
  async validateRegistrationCode(code) {
    return this.jobService.validateRegistrationCode(code);
  }

  /**
   * Complete registration using a one-time code + chosen email/password.
   * Saves credentials to disk, sets the JWT, and starts the worker.
   */
  async completeRegistration(code, email, password) {
    try {
      const result = await this.jobService.registerNode(code, email, password);

      // Persist so the app logs in automatically on every subsequent restart
      this.storage.saveCredentials({ email, password });

      // Update runtime config + token (skip a redundant re-login)
      this.config.nodeEmail = email;
      this.config.nodePassword = password;
      this.jobService.setCredentials(email, password);
      this.jobService.setAccessToken(result.access_token);

      this.logger.info('Self-registration complete', { node: result.node?.code });

      // Start the full worker now that credentials are available
      await this._startWorker();

      return { ok: true, node: result.node };
    } catch (error) {
      this.logger.warn('Self-registration failed', { error: error.message });
      return { ok: false, message: error.message };
    }
  }

  async stop() {
    this.logger.info('Stopping CopyFlow print agent');
    for (const id of this.intervals) {
      clearInterval(id);
    }
    this.intervals = [];
    this.wsService.disconnect();
    this.store.setHealth({ workerStatus: 'stopped' });
  }

  getSnapshot() {
    return {
      ...this.store.getSnapshot(),
      pausedPrinters: this.queueService.getPausedPrinters()
    };
  }

  async handleAction(payload) {
    const action = payload?.type;
    if (!action) {
      return { ok: false, message: 'Action type is required' };
    }

    if (action === 'pause-queue') {
      this.queueService.pause(payload.printerName);
      return { ok: true };
    }

    if (action === 'resume-queue') {
      this.queueService.resume(payload.printerName);
      this.processQueue(payload.printerName);
      return { ok: true };
    }

    if (action === 'ack-alert') {
      this.store.ackAlert(payload.alertId);
      return { ok: true };
    }

    if (action === 'enqueue-mock-job') {
      const job = this.jobService.createMockJob(payload.printerName);
      const printerName = this.resolvePrinter(job);
      const normalized = this.buildQueueJob(job, printerName);
      this.queueService.enqueue(printerName, normalized);
      this.processQueue(printerName);
      return { ok: true, jobId: normalized.jobId };
    }

    return { ok: false, message: `Unknown action: ${action}` };
  }

  async refreshPrinters() {
    const printers = await this.printerService.discoverPrinters();

    this.store.setPrinters(
      printers.map((printer) => {
        const currentJob = this.store.getSnapshot().activeJobs[printer.name];
        return {
          ...printer,
          status: this.queueService.isPaused(printer.name)
            ? 'paused'
            : currentJob
              ? 'busy'
              : printer.status === 'offline'
                ? 'offline'
                : 'online'
        };
      })
    );
  }

  async pollNextJob() {
    this.store.setHealth({ lastPollAt: new Date().toISOString() });
    const jobs = await this.jobService.fetchPendingJobs();
    if (!jobs.length) {
      return;
    }

    const job = jobs[0];
    const jobId = job.job_id || job.jobId;
    if (!jobId) {
      return;
    }

    const claimed = await this.jobService.claimJob(jobId);
    if (!claimed) {
      this.store.addAlert({
        type: 'claim-failed',
        message: `Unable to claim job ${jobId}`
      });
      return;
    }

    const printerName = this.resolvePrinter(claimed);
    const queueJob = this.buildQueueJob(claimed, printerName);
    this.queueService.enqueue(printerName, queueJob);
    this.processQueue(printerName);
  }

  resolvePrinter(job) {
    const snapshot = this.store.getSnapshot();
    const printers = snapshot.printers;

    const requestedPrinter = job.requestedPrinter || job.printer_name || job.printerName;

    if (requestedPrinter && printers.find((p) => p.name === requestedPrinter)) {
      return requestedPrinter;
    }

    if (this.config.defaultPrinter && printers.find((p) => p.name === this.config.defaultPrinter)) {
      return this.config.defaultPrinter;
    }

    if (printers.length > 0) {
      return printers[0].name;
    }

    return requestedPrinter || this.config.defaultPrinter || this.config.unknownPrinterName;
  }

  buildQueueJob(job, printerName) {
    const copies = Number(job.copies || job.settings?.copies || 1);
    const pageCount = Number(job.page_count || job.pageCount || 1);
    return {
      jobId: job.job_id || job.jobId,
      fileName: job.fileName || job.file_url || job.fileUrl || this.config.unknownFileName,
      fileUrl: job.file_url || job.fileUrl || null,
      owner: job.owner || this.config.unknownOwnerName,
      priority: job.priority || this.config.mockPriority,
      requestedPrinter: job.requestedPrinter || null,
      assignedPrinter: printerName,
      settings: {
        copies,
        colorMode: job.color_mode || job.settings?.colorMode || 'BW',
        sides: job.sides || job.settings?.sides || 'single',
        pageCount
      },
      checksum: job.file_checksum || null,
      status: 'queued',
      submittedAt: job.createdAt || job.submittedAt || new Date().toISOString(),
      timeline: [{ status: 'queued', at: new Date().toISOString() }],
      retries: 0,
      lastError: null
    };
  }

  async processQueue(printerName) {
    if (this.processingPrinters.has(printerName)) {
      return;
    }
    if (this.queueService.isPaused(printerName)) {
      return;
    }

    const job = this.queueService.dequeue(printerName);
    if (!job) {
      return;
    }

    this.processingPrinters.add(printerName);
    this.store.setActiveJob(printerName, job);

    try {
      const result = await this.printService.printJob(job, printerName, (stage) => {
        job.status = stage;
        job.timeline.push({ status: stage, at: new Date().toISOString() });
        this.store.setActiveJob(printerName, job);
      });

      job.status = 'success';
      job.timeline.push({ status: 'success', at: result.completedAt });

      const printerMeta = this.store.getSnapshot().printers.find((printer) => printer.name === printerName);
      const pagesPrinted = Number(job.settings.pageCount || 1) * Number(job.settings.copies || 1);
      const isMockJob = String(job.jobId).startsWith('MOCK-');

      // Mock jobs don't exist on the backend — skip the acknowledge callback entirely
      if (!isMockJob) {
        const ackPayload = {
          status: 'completed',
          printer_id: printerMeta?.id || this.config.deviceId,
          printer_name: printerName,
          pages_printed: pagesPrinted,
          completed_at: result.completedAt,
          consumables: {
            paper_level: this.config.heartbeatPaperLevel,
            ink_black: this.config.heartbeatInkBlack
          }
        };
        const ackResult = await this.jobService.acknowledgeJob(job.jobId, ackPayload);

        if (!ackResult.ok) {
          if (ackResult.status === 404) {
            // Job doesn't exist on the server — don't retry
            this.logger.warn('Acknowledge 404: job not found on server, skipping retry', { jobId: job.jobId });
          } else {
            this.store.addAlert({
              type: 'callback-warning',
              message: `Printed ${job.jobId}, but callback was not acknowledged by server`
            });
            this._enqueueCallbackRetry('acknowledge', job.jobId, ackPayload);
          }
        }
      }

      // Persist the completed job to disk
      const completedJob = { ...job, completedAt: result.completedAt, durationMs: result.durationMs };
      this.storage.saveJob(completedJob);
      this.store.pushRecentJob(completedJob);
    } catch (error) {
      job.status = 'failed';
      job.lastError = error.message;
      job.timeline.push({ status: 'failed', at: new Date().toISOString() });

      const failPayload = {
        reason: error.message,
        error_code: this.jobService.mapFailureToErrorCode(error.message)
      };
      const isMockJob = String(job.jobId).startsWith('MOCK-');
      if (!isMockJob) {
        const failResult = await this.jobService.failJob(job.jobId, failPayload);
        if (!failResult.ok) {
          if (failResult.status === 404) {
            this.logger.warn('Fail callback 404: job not found on server, skipping retry', { jobId: job.jobId });
          } else {
            this._enqueueCallbackRetry('fail', job.jobId, failPayload);
          }
        }
      }

      const failedJob = { ...job, completedAt: new Date().toISOString() };
      this.storage.saveJob(failedJob);
      this.store.pushRecentJob(failedJob);
      this.store.addAlert({
        type: 'print-failed',
        printerName,
        message: `Job ${job.jobId} failed on ${printerName}: ${error.message}`
      });
      this.store.setHealth({ lastError: error.message });
    } finally {
      this.store.setActiveJob(printerName, null);
      this.processingPrinters.delete(printerName);
      this.processQueue(printerName);
      this.refreshPrinters();
    }
  }

  async sendHeartbeat() {
    const snapshot = this.store.getSnapshot();
    const payload = {
      paper_level: this.config.heartbeatPaperLevel,
      printers: snapshot.printers.map((printer) => ({
        id: printer.id,
        name: printer.name,
        status: printer.serverStatus || (printer.status === 'offline' ? 'OFFLINE' : 'READY'),
        is_default: Boolean(printer.isDefault),
        color_capable: Boolean(printer.colorCapable),
        ink_level: {
          black: this.config.heartbeatInkBlack,
          cyan: null,
          magenta: null,
          yellow: null
        }
      }))
    };

    const ok = await this.jobService.heartbeat(payload);
    this.store.setHealth({
      apiReachable: ok,
      lastHeartbeatAt: new Date().toISOString()
    });

    if (!ok) {
      this.store.addAlert({
        type: 'api-unreachable',
        message: 'Backend heartbeat failed. The app will keep retrying.'
      });
    }
  }

  // ── Startup stale-job sync ──────────────────────────────────────────────

  /**
   * On startup, fetch the server's list of pending jobs and remove any
   * retry-queue items whose job IDs are no longer on the server.
   * This prevents the endless retry flood that occurs when the kiosk
   * restarts with stale cached job IDs.
   */
  async _discardStaleRetryItems() {
    try {
      const pendingJobs = await this.jobService.fetchPendingJobs();
      const serverJobIds = new Set(pendingJobs.map((j) => String(j.id || j.jobId)));
      const queue = this.storage.loadRetryQueue();
      let discarded = 0;
      for (const item of queue) {
        if (!serverJobIds.has(String(item.jobId))) {
          this.storage.removeRetryItem(item.id);
          discarded++;
        }
      }
      if (discarded > 0) {
        this.logger.info(`Startup sync: discarded ${discarded} stale retry item(s) not found on server`);
      }
    } catch (err) {
      // Non-fatal: if we can't reach the server, keep the queue as-is
      this.logger.warn('Startup sync: could not fetch pending jobs to prune stale items', { error: err.message });
    }
  }

  // ── Callback Retry Queue ──────────────────────────────────────────────────

  /**
   * Save a failed callback to the persistent retry queue.
   * Items are retried every config.callbackRetryIntervalMs and expired after 24 h.
   */
  _enqueueCallbackRetry(type, jobId, payload) {
    const item = {
      id: `${type}:${jobId}`,
      type,
      jobId,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastAttemptAt: null
    };
    this.storage.saveRetryItem(item);
    this.logger.info('Queued callback for retry', { type, jobId });
  }

  /**
   * Attempt to flush all pending callback retries.
   * - 404 response: job not found → drop immediately, never retry
   * - 4xx response: client error → drop after MAX_CALLBACK_RETRIES attempts
   * - alreadyAcknowledged: treat as success
   * - network/5xx: keep retrying up to MAX_CALLBACK_RETRIES with exponential backoff
   */
  async processRetryQueue() {
    const MAX_RETRIES = 5;
    const queue = this.storage.loadRetryQueue();
    if (!queue.length) return;

    this.logger.info(`Processing ${queue.length} pending callback retry item(s)`);

    for (const item of queue) {
      // Exponential backoff: don't retry until enough time has passed
      // Delays: attempt 1→2s, 2→4s, 3→8s, 4→16s, 5→32s (capped)
      if (item.attempts > 0 && item.lastAttemptAt) {
        const backoffMs = Math.min(2000 * Math.pow(2, item.attempts - 1), 32000);
        const elapsed = Date.now() - new Date(item.lastAttemptAt).getTime();
        if (elapsed < backoffMs) continue;
      }

      try {
        let result = { ok: false, status: 0 };
        if (item.type === 'acknowledge') {
          result = await this.jobService.acknowledgeJob(item.jobId, item.payload);
        } else if (item.type === 'fail') {
          result = await this.jobService.failJob(item.jobId, item.payload);
        }

        if (result.ok) {
          this.storage.removeRetryItem(item.id);
          if (result.alreadyAcknowledged) {
            this.logger.info('Retry: job already acknowledged on server, removing', { jobId: item.jobId });
          } else {
            this.logger.info('Retry callback succeeded', { type: item.type, jobId: item.jobId });
          }
        } else if (result.status === 404) {
          // Job doesn't exist on server — stop retrying permanently
          this.storage.removeRetryItem(item.id);
          this.logger.warn('Retry callback 404: job not found, removing from retry queue', { jobId: item.jobId });
        } else {
          item.attempts += 1;
          item.lastAttemptAt = new Date().toISOString();
          if (item.attempts >= MAX_RETRIES) {
            this.storage.removeRetryItem(item.id);
            this.store.addAlert({
              type: 'callback-abandoned',
              message: `Job ${item.jobId} callback abandoned after ${MAX_RETRIES} retries`
            });
            this.logger.warn('Retry callback abandoned (max retries reached)', { type: item.type, jobId: item.jobId, attempts: item.attempts });
          } else {
            this.storage.saveRetryItem(item);
            this.logger.warn('Retry callback failed, will retry', { type: item.type, jobId: item.jobId, attempts: item.attempts, status: result.status });
          }
        }
      } catch (err) {
        item.attempts += 1;
        item.lastAttemptAt = new Date().toISOString();
        if (item.attempts >= MAX_RETRIES) {
          this.storage.removeRetryItem(item.id);
          this.store.addAlert({
            type: 'callback-abandoned',
            message: `Job ${item.jobId} callback abandoned after ${MAX_RETRIES} retries`
          });
          this.logger.warn('Retry callback abandoned (max retries reached)', { type: item.type, jobId: item.jobId });
        } else {
          this.storage.saveRetryItem(item);
          this.logger.warn('Retry callback error', { type: item.type, jobId: item.jobId, error: err.message });
        }
      }
    }
  }
}

module.exports = { Agent };
