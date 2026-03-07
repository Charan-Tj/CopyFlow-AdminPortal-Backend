const path = require('path');
const dotenv = require('dotenv');

function readRequired(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function readOptional(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  return value.trim();
}

function readNumber(name) {
  const raw = readRequired(name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric environment variable: ${name}=${raw}`);
  }
  return parsed;
}

function readBoolean(name) {
  const raw = readRequired(name).toLowerCase();
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`Invalid boolean environment variable: ${name}=${raw}`);
  }
  return raw === 'true';
}

function readCsv(name) {
  const raw = readOptional(name, '');
  if (!raw) {
    return [];
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function readOptionalBoolean(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }
  return raw.trim().toLowerCase() === 'true';
}

function readOptionalNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    return fallback;
  }
  const parsed = Number(raw.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class ConfigService {
  constructor() {
    dotenv.config({ path: path.resolve(process.cwd(), '.env') });

    this.config = {
      deviceId: readRequired('DEVICE_ID'),
      apiBaseUrl: readRequired('API_BASE_URL'),
      apiToken: readOptional('API_TOKEN', ''),
      // NODE_EMAIL / NODE_PASSWORD are optional when using self-registration.
      // If absent the app shows the registration wizard on first launch.
      nodeEmail: readOptional('NODE_EMAIL', ''),
      nodePassword: readOptional('NODE_PASSWORD', ''),
      pollIntervalMs: readNumber('POLL_INTERVAL_MS'),
      heartbeatIntervalMs: readNumber('HEARTBEAT_INTERVAL_MS'),
      printerRefreshIntervalMs: readNumber('PRINTER_REFRESH_INTERVAL_MS'),
      defaultPrinter: readOptional('DEFAULT_PRINTER', ''),
      simulatePrint: readBoolean('SIMULATE_PRINT'),
      fallbackPrinters: readCsv('FALLBACK_PRINTERS'),
      mockFileUrl: readRequired('MOCK_FILE_URL'),
      mockOwner: readRequired('MOCK_OWNER'),
      mockPriority: readRequired('MOCK_PRIORITY'),
      mockFilePrefix: readRequired('MOCK_FILE_PREFIX'),
      unknownPrinterName: readRequired('UNKNOWN_PRINTER_NAME'),
      unknownFileName: readRequired('UNKNOWN_FILE_NAME'),
      unknownOwnerName: readRequired('UNKNOWN_OWNER_NAME'),
      heartbeatPaperLevel: readRequired('HEARTBEAT_PAPER_LEVEL'),
      heartbeatInkBlack: readNumber('HEARTBEAT_INK_BLACK'),
      stageDownloadMs: readNumber('STAGE_DOWNLOAD_MS'),
      stageSpoolMs: readNumber('STAGE_SPOOL_MS'),
      stagePrintMs: readNumber('STAGE_PRINT_MS'),
      appVersion: readRequired('APP_VERSION'),
      wsEnabled: readOptionalBoolean('WS_ENABLED', false),
      callbackRetryIntervalMs: readOptionalNumber('CALLBACK_RETRY_INTERVAL_MS', 60000)
    };
  }

  get() {
    return this.config;
  }
}

module.exports = { ConfigService };
