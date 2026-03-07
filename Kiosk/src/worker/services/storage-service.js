/**
 * StorageService — persists job history and callback retry queue to disk.
 * Data is stored as JSON files under ~/.copyflow-agent/ so they survive app restarts.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.copyflow-agent');
const JOB_HISTORY_FILE = path.join(DATA_DIR, 'job-history.json');
const RETRY_QUEUE_FILE = path.join(DATA_DIR, 'retry-queue.json');
const CREDENTIALS_FILE = path.join(DATA_DIR, 'credentials.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {
    // Corrupted file — silently return fallback
  }
  return fallback;
}

function writeJson(filePath, data) {
  ensureDir();
  // Atomic write: write to .tmp then rename to prevent corruption on crash
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

class StorageService {
  getDataDir() {
    return DATA_DIR;
  }

  // ── Job History ─────────────────────────────────────────────────────────────

  /**
   * Save or update a job in persistent history.
   * If a job with the same jobId already exists it is replaced (idempotent).
   * History is capped at 1 000 entries (oldest removed first).
   */
  saveJob(job) {
    const history = readJson(JOB_HISTORY_FILE, []);
    const idx = history.findIndex((h) => h.jobId === job.jobId);
    if (idx !== -1) {
      history[idx] = job;
    } else {
      history.unshift(job);
    }
    writeJson(JOB_HISTORY_FILE, history.slice(0, 1000));
  }

  /**
   * Load most-recent job history from disk.
   * @param {number} limit   Max entries to return (default 100).
   */
  loadHistory(limit = 100) {
    return readJson(JOB_HISTORY_FILE, []).slice(0, limit);
  }

  // ── Callback Retry Queue ────────────────────────────────────────────────────

  /**
   * Persist a retry item.
   * @param {{ id, type, jobId, payload, createdAt, attempts, lastAttemptAt }} item
   */
  saveRetryItem(item) {
    const queue = readJson(RETRY_QUEUE_FILE, []);
    const idx = queue.findIndex((q) => q.id === item.id);
    if (idx !== -1) {
      queue[idx] = item;
    } else {
      queue.push(item);
    }
    writeJson(RETRY_QUEUE_FILE, queue);
  }

  loadRetryQueue() {
    return readJson(RETRY_QUEUE_FILE, []);
  }

  removeRetryItem(id) {
    const queue = readJson(RETRY_QUEUE_FILE, []);
    writeJson(RETRY_QUEUE_FILE, queue.filter((q) => q.id !== id));
  }

  /**
   * Remove retry items older than maxAgeMs (default 24 hours).
   */
  pruneRetryQueue(maxAgeMs = 24 * 60 * 60 * 1000) {
    const queue = readJson(RETRY_QUEUE_FILE, []);
    const cutoff = Date.now() - maxAgeMs;
    writeJson(RETRY_QUEUE_FILE, queue.filter((q) => new Date(q.createdAt).getTime() > cutoff));
  }

  // ── Node Credentials ────────────────────────────────────────────────────────

  /**
   * Persist the operator credentials obtained via self-registration.
   * These are used on every subsequent app start to log in automatically.
   */
  saveCredentials({ email, password }) {
    writeJson(CREDENTIALS_FILE, { email, password, savedAt: new Date().toISOString() });
  }

  /**
   * Load saved credentials. Returns { email, password } or null if not found.
   */
  loadCredentials() {
    const data = readJson(CREDENTIALS_FILE, null);
    if (!data || !data.email || !data.password) {
      return null;
    }
    return { email: data.email, password: data.password };
  }

  /**
   * Remove saved credentials (e.g. on explicit de-registration).
   */
  clearCredentials() {
    try {
      if (fs.existsSync(CREDENTIALS_FILE)) {
        fs.unlinkSync(CREDENTIALS_FILE);
      }
    } catch {
      // Best-effort
    }
  }
}

module.exports = { StorageService };
