const axios = require('axios');

const DEFAULTS = {
  pendingJobsPath: '/node/jobs',
  eventsPath: '/node/events',
  loginPath: '/node/auth/login'
};

const config = {
  serverUrl: process.env.SERVER_URL || '',
  agentId: process.env.AGENT_ID || 'local-agent',
  nodeEmail: process.env.NODE_EMAIL || '',
  nodePassword: process.env.NODE_PASSWORD || '',
  pendingJobsPath: process.env.PENDING_JOBS_PATH || DEFAULTS.pendingJobsPath,
  eventsPath: process.env.EVENTS_PATH || DEFAULTS.eventsPath,
  loginPath: process.env.NODE_LOGIN_PATH || DEFAULTS.loginPath
};

let client = createClient(config.serverUrl);
let accessToken = process.env.AGENT_TOKEN || null;
let lastAuthAt = null;
let lastError = null;

function createClient(serverUrl) {
  if (!serverUrl) {
    return null;
  }

  return axios.create({
    baseURL: serverUrl,
    timeout: 15000
  });
}

function normalizePath(path, fallback) {
  const value = String(path || '').trim();
  if (!value) {
    return fallback;
  }
  return value.startsWith('/') ? value : `/${value}`;
}

function sanitizeConfigForOutput() {
  return {
    serverUrl: config.serverUrl,
    agentId: config.agentId,
    nodeEmail: config.nodeEmail,
    nodePasswordSet: Boolean(config.nodePassword),
    pendingJobsPath: config.pendingJobsPath,
    eventsPath: config.eventsPath,
    loginPath: config.loginPath,
    connected: isConnected(),
    lastAuthAt,
    lastError
  };
}

function updateConfig(partial = {}) {
  const previousServerUrl = config.serverUrl;

  if (Object.prototype.hasOwnProperty.call(partial, 'serverUrl')) {
    config.serverUrl = String(partial.serverUrl || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'agentId')) {
    config.agentId = String(partial.agentId || '').trim() || 'local-agent';
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'nodeEmail')) {
    config.nodeEmail = String(partial.nodeEmail || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'nodePassword')) {
    config.nodePassword = String(partial.nodePassword || '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'pendingJobsPath')) {
    config.pendingJobsPath = normalizePath(partial.pendingJobsPath, DEFAULTS.pendingJobsPath);
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'eventsPath')) {
    config.eventsPath = normalizePath(partial.eventsPath, DEFAULTS.eventsPath);
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'loginPath')) {
    config.loginPath = normalizePath(partial.loginPath, DEFAULTS.loginPath);
  }

  if (previousServerUrl !== config.serverUrl) {
    client = createClient(config.serverUrl);
  }

  accessToken = null;
  lastAuthAt = null;
  lastError = null;

  return sanitizeConfigForOutput();
}

function authHeaders() {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

async function loginIfNeeded(force = false) {
  if (!client) {
    lastError = 'Server URL is not configured';
    return false;
  }

  if (!force && accessToken) {
    return true;
  }

  if (!config.nodeEmail || !config.nodePassword) {
    lastError = 'Node email/password are not configured';
    return false;
  }

  try {
    const response = await client.post(config.loginPath, {
      email: config.nodeEmail,
      password: config.nodePassword
    });

    accessToken = response.data?.access_token || null;
    if (accessToken) {
      lastAuthAt = new Date().toISOString();
      lastError = null;
    } else {
      lastError = 'Login response did not include access_token';
    }

    return Boolean(accessToken);
  } catch (error) {
    accessToken = null;
    lastAuthAt = null;
    const status = error?.response?.status;
    const details = error?.response?.data?.message || error.message;
    lastError = status ? `Login failed (${status}): ${details}` : `Login failed: ${details}`;
    return false;
  }
}

async function authorizedRequest(method, path, data) {
  if (!client) {
    throw new Error('Server API is not configured');
  }

  await loginIfNeeded(false);

  try {
    return await client.request({
      method,
      url: path,
      data,
      headers: authHeaders()
    });
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401) {
      const refreshed = await loginIfNeeded(true);
      if (refreshed) {
        return client.request({
          method,
          url: path,
          data,
          headers: authHeaders()
        });
      }
    }

    throw error;
  }
}

function isEnabled() {
  return Boolean(client && config.serverUrl);
}

function isConnected() {
  return isEnabled() && Boolean(accessToken);
}

function getConfig() {
  return sanitizeConfigForOutput();
}

async function testConnection() {
  const loggedIn = await loginIfNeeded(true);
  if (!loggedIn) {
    return {
      ok: false,
      ...sanitizeConfigForOutput()
    };
  }

  return {
    ok: true,
    ...sanitizeConfigForOutput()
  };
}

async function fetchPendingJobs() {
  if (!isEnabled()) {
    return [];
  }

  const response = await authorizedRequest('GET', config.pendingJobsPath);
  const jobs = response.data?.jobs ?? response.data ?? [];
  return Array.isArray(jobs) ? jobs : [];
}

async function sendEvent(type, payload) {
  if (!isEnabled()) {
    return;
  }

  await authorizedRequest('POST', config.eventsPath, {
    type,
    agentId: config.agentId || 'local-agent',
    time: new Date().toISOString(),
    payload
  });
}

async function reportPrinterStatus(printers) {
  await sendEvent('PRINTER_STATUS', { printers });
}

async function reportJobUpdate(jobId, status, details = {}) {
  await sendEvent('JOB_UPDATE', { jobId, status, details });
}

module.exports = {
  isEnabled,
  isConnected,
  getConfig,
  updateConfig,
  testConnection,
  fetchPendingJobs,
  sendEvent,
  reportPrinterStatus,
  reportJobUpdate
};
