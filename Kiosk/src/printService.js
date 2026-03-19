const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');
const { print } = require('pdf-to-printer');

const execFileAsync = promisify(execFile);

function ensureTempDir() {
  const tempDir = path.join(process.cwd(), '.temp');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  return tempDir;
}

function inferFileName(url, jobId) {
  try {
    const parsed = new URL(url);
    const base = path.basename(parsed.pathname) || `${jobId}.pdf`;
    return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
  } catch {
    return `${jobId || Date.now()}.pdf`;
  }
}

async function downloadFile(fileUrl, jobId) {
  const tempDir = ensureTempDir();
  const fileName = inferFileName(fileUrl, jobId);
  const filePath = path.join(tempDir, `${Date.now()}-${fileName}`);

  const response = await axios.get(fileUrl, { responseType: 'stream', timeout: 30000 });
  await pipeline(response.data, fs.createWriteStream(filePath));

  return filePath;
}

async function printPdf(filePath, printerName, copies) {
  const options = {
    printer: printerName,
    copies: Number.isFinite(copies) ? copies : 1
  };

  await print(filePath, options);
}

async function waitForSpooler(printerName, maxWaitMs = 300000) {
  if (process.platform !== 'win32' || !printerName) {
    return;
  }

  const start = Date.now();
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  
  // Wait just a bit before checking to let windows spooler register the job
  await delay(2000);

  const command = `Get-PrintJob -PrinterName "${printerName}" | Select-Object Id | ConvertTo-Json`;

  while (Date.now() - start < maxWaitMs) {
    try {
      const { stdout } = await execFileAsync('powershell', [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        command
      ]);

      if (!stdout || !stdout.trim()) {
        // Spooler is empty for this printer
        break;
      }
      
      const parsed = JSON.parse(stdout);
      const jobs = Array.isArray(parsed) ? parsed : [parsed];
      if (jobs.length === 0) {
        break;
      }
    } catch (error) {
      // If error (printer invalid or off), break to avoid infinite loop
      break;
    }
    
    // Check every 3 seconds
    await delay(3000);
  }
}

async function cleanupFile(filePath) {
  if (!filePath) {
    return;
  }

  try {
    await fsp.unlink(filePath);
  } catch {
    // Ignore cleanup errors.
  }
}

module.exports = {
  downloadFile,
  printPdf,
  waitForSpooler,
  cleanupFile
};
