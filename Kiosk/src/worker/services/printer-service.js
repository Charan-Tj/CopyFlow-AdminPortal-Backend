const { execFile } = require('child_process');

function execPromise(psScript) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

class PrinterService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async discoverPrinters() {
    try {
      const raw = await execPromise('Get-Printer | Select-Object Name,DriverName,PrinterStatus,WorkOffline | ConvertTo-Json');
      const parsed = JSON.parse(raw || '[]');
      const printers = Array.isArray(parsed) ? parsed : [parsed];

      return printers.map((printer) => ({
        id: this.toPrinterId(printer.Name),
        name: printer.Name,
        model: printer.DriverName || 'Unknown',
        status: this.mapPrinterStatus(printer),
        serverStatus: this.mapServerStatus(printer),
        colorCapable: false,
        isDefault: Boolean(this.config.defaultPrinter && this.config.defaultPrinter === printer.Name),
        lastSeenAt: new Date().toISOString()
      }));
    } catch (error) {
      this.logger.warn('Falling back to mock printer list; PowerShell discovery failed', { error: error.message });

      const fallback = this.config.defaultPrinter
        ? [this.config.defaultPrinter]
        : this.config.fallbackPrinters;

      return fallback.map((name) => ({
        id: this.toPrinterId(name),
        name,
        model: 'Fallback Printer',
        status: 'online',
        serverStatus: 'READY',
        colorCapable: false,
        isDefault: Boolean(this.config.defaultPrinter && this.config.defaultPrinter === name),
        lastSeenAt: new Date().toISOString()
      }));
    }
  }

  toPrinterId(name) {
    return String(name || 'printer')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  mapPrinterStatus(printer) {
    if (printer.WorkOffline) {
      return 'offline';
    }
    if (printer.PrinterStatus === 4) {
      return 'printing';
    }
    if (printer.PrinterStatus === 7) {
      return 'offline';
    }
    if (printer.PrinterStatus === 3) {
      return 'idle';
    }
    return 'online';
  }

  mapServerStatus(printer) {
    if (printer.WorkOffline || printer.PrinterStatus === 7) {
      return 'OFFLINE';
    }
    return 'READY';
  }
}

module.exports = { PrinterService };
