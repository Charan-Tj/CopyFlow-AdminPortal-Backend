const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

async function listPrinters() {
  if (process.platform !== 'win32') {
    return [];
  }

  const command = 'Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,WorkOffline | ConvertTo-Json -Depth 4';

  const { stdout } = await execFileAsync('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command
  ]);

  if (!stdout || !stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(stdout);
  const printers = Array.isArray(parsed) ? parsed : [parsed];

  return printers.map((printer) => ({
    name: printer.Name,
    driverName: printer.DriverName,
    portName: printer.PortName,
    printerStatus: printer.PrinterStatus,
    workOffline: Boolean(printer.WorkOffline)
  }));
}

module.exports = {
  listPrinters
};
