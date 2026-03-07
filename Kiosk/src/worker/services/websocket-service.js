/**
 * WebSocketService — connects to the backend Socket.IO /node namespace
 * to receive real-time job push events without waiting for the next poll cycle.
 *
 * Emits:
 *   'connected'           - socket established
 *   'disconnected'        - socket lost (reconnects automatically)
 *   'new-job' (payload)   - backend pushed a new job for this node
 */

const { EventEmitter } = require('events');

class WebSocketService extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.socket = null;
  }

  /**
   * Connect to the backend /node WebSocket namespace.
   *
   * @param {() => string | null} getToken  Function that returns the current JWT.
   *        Called once on connect and again on reconnect so a refreshed token is used.
   */
  connect(getToken) {
    if (this.socket) {
      return; // Already connected or connecting
    }

    let io;
    try {
      io = require('socket.io-client').io;
    } catch {
      this.logger.warn(
        'socket.io-client not installed; real-time job push is disabled. Run: npm install socket.io-client'
      );
      return;
    }

    const token = getToken();
    if (!token) {
      this.logger.warn('No access token available — WebSocket connection deferred until login succeeds');
      return;
    }

    this.socket = io(`${this.config.apiBaseUrl}/node`, {
      auth: { token },
      transports: ['websocket'],
      reconnection: true,
      reconnectionDelay: 5000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      timeout: 10000
    });

    this.socket.on('connect', () => {
      this.logger.info('WebSocket connected to backend /node gateway');
      this.emit('connected');
    });

    this.socket.on('disconnect', (reason) => {
      this.logger.warn('WebSocket disconnected', { reason });
      this.emit('disconnected', reason);
    });

    // Backend emits 'new-job' when a payment is confirmed and a print job is ready
    this.socket.on('new-job', (payload) => {
      this.logger.info('WebSocket: new-job event received', { jobId: payload?.job_id });
      this.emit('new-job', payload);
    });

    this.socket.on('connect_error', (err) => {
      this.logger.warn('WebSocket connection error', { error: err.message });
    });
  }

  /**
   * Update the auth token (e.g. after a token refresh).
   * If the socket is disconnected it will reconnect with the new token.
   */
  updateToken(token) {
    if (this.socket) {
      this.socket.auth = { token };
      if (!this.socket.connected) {
        this.socket.connect();
      }
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

module.exports = { WebSocketService };
