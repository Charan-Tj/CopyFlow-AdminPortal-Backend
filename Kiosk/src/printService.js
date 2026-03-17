const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pipeline } = require('node:stream/promises');
const axios = require('axios');
const { print } = require('pdf-to-printer');

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
  cleanupFile
};
