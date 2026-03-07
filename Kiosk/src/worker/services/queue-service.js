class QueueService {
  constructor(store) {
    this.store = store;
    this.pausedPrinters = new Set();
  }

  enqueue(printerName, job) {
    this.store.enqueue(printerName, job);
  }

  dequeue(printerName) {
    return this.store.dequeue(printerName);
  }

  isPaused(printerName) {
    return this.pausedPrinters.has(printerName);
  }

  pause(printerName) {
    this.pausedPrinters.add(printerName);
  }

  resume(printerName) {
    this.pausedPrinters.delete(printerName);
  }

  getQueueLength(printerName) {
    const snapshot = this.store.getSnapshot();
    return (snapshot.queues[printerName] || []).length;
  }

  getPausedPrinters() {
    return Array.from(this.pausedPrinters);
  }
}

module.exports = { QueueService };
