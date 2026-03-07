class JobService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.mockJobCounter = 1;
    this.accessToken = config.apiToken || null;
    this.nodeInfo = null;
  }

  async login(force = false) {
    if (!force && this.accessToken) {
      return true;
    }

    try {
      const response = await fetch(`${this.config.apiBaseUrl}/node/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.config.nodeEmail,
          password: this.config.nodePassword
        })
      });

      if (!response.ok) {
        throw new Error(`Login failed with status ${response.status}`);
      }

      const body = await response.json();
      if (!body?.access_token) {
        throw new Error('Login response does not include access_token');
      }

      this.accessToken = body.access_token;
      this.nodeInfo = body.node || null;
      this.logger.info('Node login successful', { node: this.nodeInfo?.code || null });
      return true;
    } catch (error) {
      this.logger.warn('Node login failed', { error: error.message });
      return false;
    }
  }

  async fetchPendingJobs() {
    const response = await this.authenticatedFetch('/node/jobs', { method: 'GET' });
    if (!response) {
      return [];
    }
    if (response.status === 204 || response.status === 404) {
      return [];
    }
    if (!response.ok) {
      this.logger.warn('Fetch pending jobs failed', { status: response.status });
      return [];
    }

    const data = await response.json();
    // Server returns a plain array; guard against a future {jobs:[]} wrapper too
    return Array.isArray(data) ? data : Array.isArray(data?.jobs) ? data.jobs : [];
  }

  async claimJob(jobId) {
    const response = await this.authenticatedFetch(`/node/jobs/${jobId}/claim`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!response) {
      return null;
    }
    if (response.status === 409) {
      this.logger.warn('Job already claimed by another node', { jobId });
      return null;
    }
    if (!response.ok) {
      this.logger.warn('Claim failed', { jobId, status: response.status });
      return null;
    }

    return response.json();
  }

  async acknowledgeJob(jobId, payload) {
    const response = await this.authenticatedFetch(`/node/jobs/${jobId}/acknowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!response) return { ok: false, status: 0 };
    if (response.ok) {
      const body = await response.json().catch(() => ({}));
      return { ok: true, alreadyAcknowledged: Boolean(body?.alreadyAcknowledged) };
    }
    return { ok: false, status: response.status };
  }

  async failJob(jobId, payload) {
    const response = await this.authenticatedFetch(`/node/jobs/${jobId}/fail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    if (!response) return { ok: false, status: 0 };
    if (response.ok) return { ok: true };
    return { ok: false, status: response.status };
  }

  async heartbeat(payload) {
    const response = await this.authenticatedFetch('/node/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    return Boolean(response?.ok);
  }

  async authenticatedFetch(route, options = {}, allowRetry = true) {
    const hasToken = await this.login(false);
    if (!hasToken) {
      return null;
    }

    const response = await fetch(`${this.config.apiBaseUrl}${route}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...this.authHeaders()
      }
    });

    if (response.status === 401 && allowRetry) {
      const refreshed = await this.login(true);
      if (!refreshed) {
        return response;
      }
      return this.authenticatedFetch(route, options, false);
    }

    return response;
  }

  createMockJob(printerName) {
    const serial = String(this.mockJobCounter++).padStart(4, '0');
    return {
      job_id: `MOCK-${serial}`,
      file_url: this.config.mockFileUrl,
      file_checksum: '',
      copies: 1,
      color_mode: 'BW',
      sides: 'single',
      page_count: 1,
      payable_amount: 0,
      createdAt: new Date().toISOString(),
      requestedPrinter: printerName || this.config.defaultPrinter || null,
      owner: this.config.mockOwner,
      priority: this.config.mockPriority,
      fileName: `${this.config.mockFilePrefix}-${serial}.pdf`
    };
  }

  mapFailureToErrorCode(message) {
    const normalized = String(message || '').toUpperCase();
    if (normalized.includes('OFFLINE')) {
      return 'ERR_PRINTER_OFFLINE';
    }
    if (normalized.includes('JAM')) {
      return 'ERR_PAPER_JAM';
    }
    if (normalized.includes('INK')) {
      return 'ERR_LOW_INK';
    }
    if (normalized.includes('CHECKSUM')) {
      return 'ERR_CHECKSUM_MISMATCH';
    }
    if (normalized.includes('NOT FOUND')) {
      return 'ERR_PRINTER_NOT_FOUND';
    }
    if (normalized.includes('TIMEOUT')) {
      return 'ERR_TIMEOUT';
    }
    return 'ERR_FILE_DOWNLOAD_FAILED';
  }

  /**
   * Expose the current access token so other services (WebSocketService) can
   * attach it to their own connections without duplicating login logic.
   */
  getAccessToken() {
    return this.accessToken;
  }

  /**
   * Set the access token directly (used after self-registration which returns
   * a JWT immediately — avoids a redundant login round-trip).
   */
  setAccessToken(token) {
    this.accessToken = token;
  }

  /**
   * Update email + password at runtime after self-registration so that token
   * refresh on 401 continues to work correctly.
   */
  setCredentials(email, password) {
    this.config.nodeEmail = email;
    this.config.nodePassword = password;
  }

  // ── Self-Registration ──────────────────────────────────────────────────────

  /**
   * Validate a one-time registration code without consuming it.
   * Returns { valid, node: { id, name, node_code, college, city } }
   */
  async validateRegistrationCode(code) {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/node/register/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_code: code })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || `Validation failed (HTTP ${response.status})`);
      }

      return response.json();
    } catch (error) {
      throw new Error(`Code validation error: ${error.message}`);
    }
  }

  /**
   * Register this node using a one-time code.
   * Creates a NodeCredential on the backend and returns an access_token + node info.
   */
  async registerNode(code, email, password) {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/node/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registration_code: code, email, password })
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.message || `Registration failed (HTTP ${response.status})`);
      }

      return response.json(); // { access_token, node: { id, name, code } }
    } catch (error) {
      throw new Error(`Registration error: ${error.message}`);
    }
  }

  authHeaders() {
    if (!this.accessToken) {
      return {};
    }
    return {
      Authorization: `Bearer ${this.accessToken}`
    };
  }
}

module.exports = { JobService };
