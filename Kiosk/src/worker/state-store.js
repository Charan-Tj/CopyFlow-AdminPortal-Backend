const { EventEmitter } = require('events');

class StateStore extends EventEmitter {
  constructor() {
    super();
    this.state = {
      startedAt: new Date().toISOString(),
      health: {
        workerStatus: 'starting',
        apiReachable: false,
        lastHeartbeatAt: null,
        lastPollAt: null,
        lastError: null
      },
      printers: [],
      queues: {},
      activeJobs: {},
      recentJobs: [],
      alerts: []
    };
  }

  setHealth(patch) {
    this.state.health = { ...this.state.health, ...patch };
    this.emitUpdate();
  }

  setPrinters(printers) {
    this.state.printers = printers;
    for (const printer of printers) {
      if (!this.state.queues[printer.name]) {
        this.state.queues[printer.name] = [];
      }
    }
    this.emitUpdate();
  }

  enqueue(printerName, job) {
    if (!this.state.queues[printerName]) {
      this.state.queues[printerName] = [];
    }
    this.state.queues[printerName].push(job);
    this.emitUpdate();
  }

  dequeue(printerName) {
    if (!this.state.queues[printerName] || this.state.queues[printerName].length === 0) {
      return null;
    }
    const job = this.state.queues[printerName].shift();
    this.emitUpdate();
    return job;
  }

  setActiveJob(printerName, job) {
    if (job) {
      this.state.activeJobs[printerName] = job;
    } else {
      delete this.state.activeJobs[printerName];
    }
    this.emitUpdate();
  }

  /**
   * Replace the entire recentJobs list — used to hydrate from persistent storage on startup.
   */
  setRecentJobs(jobs) {
    this.state.recentJobs = jobs.slice(0, 100);
    this.emitUpdate();
  }

  pushRecentJob(job) {
    // Replace existing entry if jobId matches (e.g. status update), otherwise prepend
    const idx = this.state.recentJobs.findIndex((j) => j.jobId === job.jobId);
    if (idx !== -1) {
      this.state.recentJobs[idx] = job;
    } else {
      this.state.recentJobs.unshift(job);
    }
    this.state.recentJobs = this.state.recentJobs.slice(0, 100);
    this.emitUpdate();
  }

  addAlert(alert) {
    const dedupeKey = `${alert.type}:${alert.printerName || 'global'}`;
    const existing = this.state.alerts.find((a) => a.dedupeKey === dedupeKey);
    if (existing) {
      existing.message = alert.message;
      existing.updatedAt = new Date().toISOString();
    } else {
      this.state.alerts.unshift({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dedupeKey,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        acknowledged: false,
        ...alert
      });
    }
    this.state.alerts = this.state.alerts.slice(0, 50);
    this.emitUpdate();
  }

  ackAlert(alertId) {
    const alert = this.state.alerts.find((item) => item.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.updatedAt = new Date().toISOString();
      this.emitUpdate();
    }
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  emitUpdate() {
    this.emit('update', this.getSnapshot());
  }
}

module.exports = { StateStore };
