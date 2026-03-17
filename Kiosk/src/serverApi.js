const axios = require('axios');

const serverUrl = process.env.SERVER_URL;
const agentId = process.env.AGENT_ID;
const nodeEmail = process.env.NODE_EMAIL;
const nodePassword = process.env.NODE_PASSWORD;
const pendingJobsPath = process.env.PENDING_JOBS_PATH || '/node/jobs';
const eventsPath = process.env.EVENTS_PATH || '/node/events';
const loginPath = process.env.NODE_LOGIN_PATH || '/node/auth/login';

const client = serverUrl
  ? axios.create({
      baseURL: serverUrl,
      timeout: 15000
    })
  : null;

let accessToken = process.env.AGENT_TOKEN || null;

function authHeaders() {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

async function loginIfNeeded(force = false) {
  if (!client) {
    return false;
  }

  if (!force && accessToken) {
    return true;
  }

  if (!nodeEmail || !nodePassword) {
    return false;
  }

  const response = await client.post(loginPath, {
    email: nodeEmail,
    password: nodePassword
  });

  accessToken = response.data?.access_token || null;
  return Boolean(accessToken);
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
  return Boolean(client);
}

async function fetchPendingJobs() {
  if (!isEnabled()) {
    return [];
  }

  const response = await authorizedRequest('GET', pendingJobsPath);
  const jobs = response.data?.jobs ?? response.data ?? [];
  return Array.isArray(jobs) ? jobs : [];
}

async function sendEvent(type, payload) {
  if (!isEnabled()) {
    return;
  }

  await authorizedRequest('POST', eventsPath, {
    type,
    agentId: agentId || 'local-agent',
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
  fetchPendingJobs,
  sendEvent,
  reportPrinterStatus,
  reportJobUpdate
};
