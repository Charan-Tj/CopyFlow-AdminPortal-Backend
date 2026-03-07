/**
 * DownloadService — downloads job files from signed URLs to a local temp
 * directory and optionally verifies the MD5 checksum.
 *
 * All built-in Node.js modules are used so no native dependencies are required.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');
const crypto = require('crypto');

const TEMP_DIR = path.join(os.tmpdir(), 'copyflow-jobs');

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Build a safe temp filename: only keep alphanumerics, hyphens, and
 * underscores in the jobId-derived part so the path cannot escape TEMP_DIR.
 */
function safeFilename(jobId, url) {
  let ext = '.pdf';
  try {
    const parsed = new URL(url);
    // Strip query string before extracting extension
    const extCandidate = path.extname(parsed.pathname);
    if (extCandidate) {
      ext = extCandidate;
    }
  } catch {
    // Malformed URL — default to .pdf
  }
  const safeName = String(jobId).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeName}${ext}`;
}

class DownloadService {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Download a file from `url` to a temp path.
   * If `expectedChecksum` (MD5 hex) is supplied the file is verified and an
   * error is thrown on mismatch (the temp file is deleted in that case).
   *
   * @returns {Promise<string>} Absolute path to the local temp file.
   */
  async downloadAndVerify(url, jobId, expectedChecksum) {
    ensureTempDir();

    // Local file path — resolve it directly without downloading
    const isLocalPath = url && !url.startsWith('http://') && !url.startsWith('https://');
    if (isLocalPath) {
      this.logger.info('Using local file for job', { jobId, path: url });
      if (!fs.existsSync(url)) {
        throw new Error(`Local file not found: ${url}`);
      }
      // Return the path as-is; cleanup is skipped for local files (we don't delete originals)
      return url;
    }

    const filename = safeFilename(jobId, url);
    const destPath = path.join(TEMP_DIR, filename);

    // Redact query string (contains signed URL tokens) from logs
    const logUrl = url.split('?')[0] + (url.includes('?') ? '?...' : '');
    this.logger.info('Downloading job file', { jobId, url: logUrl });

    await this._fetchWithRedirect(url, destPath);

    if (expectedChecksum) {
      const actual = await this.computeMd5(destPath);
      if (actual !== expectedChecksum.toLowerCase()) {
        this.cleanupFile(destPath);
        throw new Error(
          `Checksum mismatch for job ${jobId}: expected ${expectedChecksum}, got ${actual}`
        );
      }
      this.logger.info('File checksum verified', { jobId });
    }

    return destPath;
  }

  computeMd5(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  cleanupFile(filePath) {
    try {
      // Only delete files we downloaded into our own temp directory — never delete originals
      if (filePath && filePath.startsWith(TEMP_DIR) && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Best-effort cleanup — ignore errors
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _fetchWithRedirect(url, destPath, redirectsLeft = 5) {
    if (redirectsLeft <= 0) {
      return Promise.reject(new Error('Too many redirects while downloading file'));
    }

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      const request = protocol.get(url, { timeout: 60000 }, (response) => {
        // Follow redirects (Supabase signed URLs may redirect once)
        if (
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          response.headers.location
        ) {
          file.close();
          fs.unlink(destPath, () => {});
          this._fetchWithRedirect(response.headers.location, destPath, redirectsLeft - 1)
            .then(resolve)
            .catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`Download failed with HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => file.close(resolve));
        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });

      request.on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Download request timed out after 60 s'));
      });
    });
  }
}

module.exports = { DownloadService };
