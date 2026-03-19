import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NodeService } from '../node/node.service';
import { PrismaService } from '../prisma/prisma.service';

type SessionRecord = {
  userName: string;
  mode: 'local' | 'node';
  expiresAt: number;
};

type ConnectionConfig = {
  serverUrl: string;
  agentId: string;
  nodeEmail: string;
  nodePassword: string;
  defaultPrinterName: string;
  pendingJobsPath: string;
  eventsPath: string;
  loginPath: string;
};

type ConnectionState = {
  connected: boolean;
  lastError: string | null;
  lastCheckedAt: string | null;
};

type NodeContext = {
  id: string;
  name: string;
  code: string;
};

@Injectable()
export class KioskApiService {
  private readonly dashboardUser = process.env.KIOSK_DASHBOARD_USER || 'admin';
  private readonly dashboardPassword = process.env.KIOSK_DASHBOARD_PASSWORD || 'admin123';
  private readonly dashboardSessionTtlMs = Number(process.env.DASHBOARD_SESSION_TTL_MS || 8 * 60 * 60 * 1000);
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly heartbeatIntervalMs = Number(process.env.KIOSK_BRIDGE_HEARTBEAT_MS || 15000);
  private readonly heartbeatAuthTtlSeconds = Number(process.env.KIOSK_BRIDGE_TOKEN_TTL_SECONDS || 1800);
  private readonly readinessMinInkPercent = Number(process.env.KIOSK_BRIDGE_MIN_INK_LEVEL || process.env.MIN_INK_LEVEL || 10);
  private readonly lastHeartbeatByNodeId = new Map<string, number>();
  private readonly heartbeatSequenceByNodeId = new Map<string, number>();

  private readonly connection: ConnectionConfig = {
    serverUrl: process.env.KIOSK_DEFAULT_SERVER_URL || process.env.SERVER_URL || '',
    agentId: process.env.KIOSK_AGENT_ID || 'kiosk-cloud',
    nodeEmail: process.env.KIOSK_NODE_EMAIL || '',
    nodePassword: process.env.KIOSK_NODE_PASSWORD || '',
    defaultPrinterName: process.env.KIOSK_DEFAULT_PRINTER_NAME || '',
    pendingJobsPath: '/node/jobs',
    eventsPath: '/node/events',
    loginPath: '/node/auth/login',
  };

  private readonly connectionState: ConnectionState = {
    connected: false,
    lastError: null,
    lastCheckedAt: null,
  };

  constructor(
    private readonly nodeService: NodeService,
    private readonly prisma: PrismaService,
  ) {}

  health() {
    return {
      ok: true,
      service: 'kiosk-bridge',
      connected: this.connectionState.connected,
      lastCheckedAt: this.connectionState.lastCheckedAt,
    };
  }

  async login(body: { username?: string; email?: string; password?: string }) {
    const userName = String(body.username || body.email || '').trim();
    const password = String(body.password || '').trim();

    if (!userName || !password) {
      throw new UnauthorizedException('Invalid username or password');
    }

    if (userName === this.dashboardUser && password === this.dashboardPassword) {
      const token = this.createSession(userName, 'local');
      return {
        ok: true,
        token,
        user: { name: userName },
        mode: 'local',
        expiresInMs: this.dashboardSessionTtlMs,
      };
    }

    const nodeLogin = await this.nodeService.login(userName, password);
    const latestPrinters = await this.getLatestPrinterList(String(nodeLogin.node?.id || ''));
    this.connection.nodeEmail = userName;
    this.connection.nodePassword = password;
    this.connection.agentId = nodeLogin.node?.code || this.connection.agentId;
    this.connectionState.connected = true;
    this.connectionState.lastError = null;
    this.connectionState.lastCheckedAt = new Date().toISOString();
    await this.maybeEmitHeartbeat(nodeLogin.node?.id, latestPrinters);

    const token = this.createSession(userName, 'node');
    return {
      ok: true,
      token,
      user: { name: userName },
      mode: 'node',
      expiresInMs: this.dashboardSessionTtlMs,
    };
  }

  getSession(req: any) {
    const token = this.getToken(req);
    const session = this.requireSession(token);
    return {
      ok: true,
      user: {
        name: session.userName,
      },
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  logout(req: any) {
    const token = this.getToken(req);
    if (token) {
      this.sessions.delete(token);
    }

    return { ok: true };
  }

  getConnection(req: any) {
    this.requireSession(this.getToken(req));

    return {
      serverUrl: this.connection.serverUrl,
      agentId: this.connection.agentId,
      nodeEmail: this.connection.nodeEmail,
      nodePassword: '',
      defaultPrinterName: this.connection.defaultPrinterName,
      pendingJobsPath: this.connection.pendingJobsPath,
      eventsPath: this.connection.eventsPath,
      loginPath: this.connection.loginPath,
      connected: this.connectionState.connected,
      lastError: this.connectionState.lastError,
      lastCheckedAt: this.connectionState.lastCheckedAt,
    };
  }

  updateConnection(
    req: any,
    body: {
      serverUrl?: string;
      agentId?: string;
      nodeEmail?: string;
      nodePassword?: string;
      defaultPrinterName?: string;
      pendingJobsPath?: string;
      eventsPath?: string;
      loginPath?: string;
    },
  ) {
    this.requireSession(this.getToken(req));

    if (typeof body.serverUrl === 'string') this.connection.serverUrl = body.serverUrl.trim();
    if (typeof body.agentId === 'string') this.connection.agentId = body.agentId.trim();
    if (typeof body.nodeEmail === 'string') this.connection.nodeEmail = body.nodeEmail.trim();
    if (typeof body.nodePassword === 'string' && body.nodePassword.trim()) this.connection.nodePassword = body.nodePassword.trim();
    if (typeof body.defaultPrinterName === 'string') this.connection.defaultPrinterName = body.defaultPrinterName.trim();
    if (typeof body.pendingJobsPath === 'string' && body.pendingJobsPath.trim()) this.connection.pendingJobsPath = body.pendingJobsPath.trim();
    if (typeof body.eventsPath === 'string' && body.eventsPath.trim()) this.connection.eventsPath = body.eventsPath.trim();
    if (typeof body.loginPath === 'string' && body.loginPath.trim()) this.connection.loginPath = body.loginPath.trim();

    return this.getConnection(req);
  }

  async testConnection(req: any) {
    this.requireSession(this.getToken(req));

    if (!this.connection.nodeEmail || !this.connection.nodePassword) {
      this.connectionState.connected = false;
      this.connectionState.lastError = 'Missing node credentials';
      this.connectionState.lastCheckedAt = new Date().toISOString();
      return {
        ok: false,
        error: this.connectionState.lastError,
      };
    }

    try {
      const nodeLogin = await this.nodeService.login(this.connection.nodeEmail, this.connection.nodePassword);
      const latestPrinters = await this.getLatestPrinterList(String(nodeLogin.node?.id || ''));
      this.connectionState.connected = true;
      this.connectionState.lastError = null;
      this.connectionState.lastCheckedAt = new Date().toISOString();
      this.connection.agentId = nodeLogin.node?.code || this.connection.agentId;
      await this.maybeEmitHeartbeat(nodeLogin.node?.id, latestPrinters, true);
      return {
        ok: true,
        node: nodeLogin.node,
      };
    } catch (error) {
      this.connectionState.connected = false;
      this.connectionState.lastError = error instanceof Error ? error.message : 'Connection failed';
      this.connectionState.lastCheckedAt = new Date().toISOString();
      return {
        ok: false,
        error: this.connectionState.lastError,
      };
    }
  }

  async getDashboard(req: any) {
    this.requireSession(this.getToken(req));

    const node = await this.resolveNodeContext();
    if (!node) {
      return this.emptyDashboard();
    }

    const [kiosk, queueJobs, recentJobs, totalJobs, successfulJobs, failedJobs, revenueAgg, pagesAgg, paidAgg, auditLogs, notifications] = await Promise.all([
      this.prisma.kiosk.findFirst({
        where: { node_id: node.id },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.printJob.findMany({
        where: { node_id: node.id, status: 'PAID' },
        orderBy: { createdAt: 'asc' },
        take: 20,
      }),
      this.prisma.printJob.findMany({
        where: { node_id: node.id },
        orderBy: { updatedAt: 'desc' },
        take: 30,
      }),
      this.prisma.printJob.count({ where: { node_id: node.id } }),
      this.prisma.printJob.count({ where: { node_id: node.id, status: 'PRINTED' } }),
      this.prisma.printJob.count({ where: { node_id: node.id, status: 'FAILED' } }),
      this.prisma.printJob.aggregate({ where: { node_id: node.id }, _sum: { payable_amount: true } }),
      this.prisma.printJob.aggregate({ where: { node_id: node.id }, _sum: { page_count: true } }),
      this.prisma.payment.aggregate({
        where: {
          job: { node_id: node.id },
          status: { in: ['PAID', 'SUCCESS', 'CAPTURED'] },
        },
        _sum: { amount: true },
      }),
      this.prisma.auditLog.findMany({
        where: { node_id: node.id },
        orderBy: { timestamp: 'desc' },
        take: 30,
      }),
      this.prisma.kioskNotification.findMany({
        where: { node_id: node.id },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
    ]);

    const heartbeatPrinters = Array.isArray(kiosk?.printer_list) ? (kiosk.printer_list as unknown[]) : [];
    await this.maybeEmitHeartbeat(node.id, heartbeatPrinters);

    const expectedRevenue = this.toNumber(revenueAgg._sum.payable_amount);
    const paidRevenue = this.toNumber(paidAgg._sum.amount);

    const printerList = this.extractPrinters(kiosk?.printer_list);

    return {
      kiosk: {
        name: kiosk?.location || node.name || this.connection.agentId,
        agentId: this.connection.agentId || node.code,
      },
      health: {
        ok: true,
        serverConnected: this.connectionState.connected,
        queuePaused: false,
      },
      metrics: {
        totalJobs,
        successfulJobs,
        failedJobs,
        totalRevenue: expectedRevenue,
        totalPages: Math.max(0, Number(pagesAgg._sum.page_count || 0)),
      },
      queue: {
        jobs: queueJobs.map((job) => ({
          id: job.job_id,
          jobId: job.job_id,
          userName: job.user_name || 'Unknown',
          documentName: job.document_name || 'Document',
          copies: job.copies,
        })),
      },
      printers: printerList,
      jobs: recentJobs.map((job) => ({
        jobId: job.job_id,
        userName: job.user_name || 'Unknown',
        owner: job.user_name || 'Unknown',
        documentName: job.document_name || 'Document',
        status: job.status,
        printerName: job.assigned_printer || this.connection.defaultPrinterName || 'Auto',
      })),
      sla: {},
      diagnostics: {},
      reconciliation: {
        expected: expectedRevenue,
        paid: paidRevenue,
        delta: Number((paidRevenue - expectedRevenue).toFixed(2)),
      },
      notifications: notifications.map((item) => ({
        id: item.id,
        type: item.type,
        severity: item.severity,
        message: item.message,
        acknowledged: item.acknowledged,
        createdAt: item.created_at.toISOString(),
      })),
      auditLogs: auditLogs.map((entry) => ({
        time: entry.timestamp.toISOString(),
        actor: entry.actor || entry.node_id || 'system',
        action: entry.event,
      })),
    };
  }

  async getLogs(req: any) {
    this.requireSession(this.getToken(req));
    const node = await this.resolveNodeContext();

    if (!node) {
      return { logs: [] };
    }

    const logs = await this.prisma.kioskSystemLog.findMany({
      where: { node_id: node.id },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    return {
      logs: logs.map((entry) => ({
        time: entry.created_at.toISOString(),
        level: entry.level,
        message: entry.message,
      })),
    };
  }

  private emptyDashboard() {
    return {
      kiosk: {
        name: this.connection.agentId || 'Cloud Kiosk',
        agentId: this.connection.agentId || 'cloud-node',
      },
      health: {
        ok: true,
        serverConnected: false,
        queuePaused: false,
      },
      metrics: {
        totalJobs: 0,
        successfulJobs: 0,
        failedJobs: 0,
        totalRevenue: 0,
        totalPages: 0,
      },
      queue: { jobs: [] },
      printers: [],
      jobs: [],
      sla: {},
      diagnostics: {},
      reconciliation: {
        expected: 0,
        paid: 0,
        delta: 0,
      },
      notifications: [],
      auditLogs: [],
    };
  }

  private extractPrinters(rawPrinterList: unknown) {
    const list = Array.isArray(rawPrinterList) ? rawPrinterList : [];
    return list.map((printer: any) => {
      const healthScore = this.toNumber(printer?.health_score ?? printer?.healthScore ?? 100);
      const ink = this.toNumber(printer?.ink_level ?? printer?.inkLevel ?? 100);
      const online = Boolean(printer?.online ?? printer?.is_online ?? true);
      return {
        name: String(printer?.name || printer?.printer_name || 'Printer'),
        printerStatus: online ? 'ONLINE' : 'OFFLINE',
        inkLevel: Math.max(0, Math.min(100, Math.round(ink))),
        healthScore: Math.max(0, Math.min(100, Math.round(healthScore))),
        icon: online ? 'online-printer' : 'offline-printer',
      };
    });
  }

  private async resolveNodeContext(): Promise<NodeContext | null> {
    if (!this.connection.nodeEmail || !this.connection.nodePassword) {
      return null;
    }

    try {
      const nodeLogin = await this.nodeService.login(this.connection.nodeEmail, this.connection.nodePassword);
      this.connectionState.connected = true;
      this.connectionState.lastError = null;
      this.connectionState.lastCheckedAt = new Date().toISOString();
      return {
        id: String(nodeLogin.node?.id || ''),
        name: String(nodeLogin.node?.name || ''),
        code: String(nodeLogin.node?.code || ''),
      };
    } catch (error) {
      this.connectionState.connected = false;
      this.connectionState.lastError = error instanceof Error ? error.message : 'Unable to resolve node context';
      this.connectionState.lastCheckedAt = new Date().toISOString();
      return null;
    }
  }

  private createSession(userName: string, mode: 'local' | 'node') {
    const token = randomUUID();
    this.sessions.set(token, {
      userName,
      mode,
      expiresAt: Date.now() + this.dashboardSessionTtlMs,
    });
    return token;
  }

  private getToken(req: any) {
    const authHeader = String(req?.headers?.authorization || '').trim();
    if (authHeader.toLowerCase().startsWith('bearer ')) {
      return authHeader.slice(7).trim();
    }

    const headerToken = String(req?.headers?.['x-session-token'] || '').trim();
    return headerToken || null;
  }

  private requireSession(token: string | null) {
    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const session = this.sessions.get(token);
    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      throw new UnauthorizedException('Session expired');
    }

    session.expiresAt = Date.now() + this.dashboardSessionTtlMs;
    this.sessions.set(token, session);
    return session;
  }

  private toNumber(value: unknown) {
    if (value === null || value === undefined) {
      return 0;
    }

    const num = Number(value);
    return Number.isFinite(num) ? Number(num.toFixed(2)) : 0;
  }

  private async getLatestPrinterList(nodeId: string): Promise<unknown[]> {
    const id = String(nodeId || '').trim();
    if (!id) {
      return [];
    }

    const kiosk = await this.prisma.kiosk.findFirst({
      where: { node_id: id },
      orderBy: { updatedAt: 'desc' },
      select: { printer_list: true },
    });

    return Array.isArray(kiosk?.printer_list) ? (kiosk.printer_list as unknown[]) : [];
  }

  private evaluatePrinterReadiness(printers: unknown[]) {
    const list = Array.isArray(printers) ? printers : [];
    let hasOnlinePrinter = false;
    let minInk: number | null = null;

    for (const item of list) {
      const printer = item as any;
      const onlineFlag = printer?.online ?? printer?.is_online;
      const statusText = String(printer?.printerStatus || printer?.status || '').toUpperCase();
      const online = typeof onlineFlag === 'boolean' ? onlineFlag : statusText.includes('ONLINE');
      if (online) {
        hasOnlinePrinter = true;
      }

      // Detect virtual/PDF printers for testing purposes
      const printerName = String(printer?.name || '').toLowerCase();
      const isVirtualPrinter =
        printerName.includes('pdf') ||
        printerName.includes('xps') ||
        printerName.includes('onenote') ||
        printerName.includes('fax') ||
        printerName.includes('microsoft print to');

      const inkSamples: number[] = [];
      const directInkFields = [
        printer?.ink_level,
        printer?.inkLevel,
        printer?.ink_level_black,
        printer?.ink_level_cyan,
        printer?.ink_level_magenta,
        printer?.ink_level_yellow,
        printer?.toner_level,
      ];

      for (const raw of directInkFields) {
        const value = Number(raw);
        if (Number.isFinite(value)) {
          inkSamples.push(value);
        }
      }

      const consumables = Array.isArray(printer?.consumables) ? printer.consumables : [];
      for (const consumable of consumables) {
        const percent = Number(consumable?.percent);
        if (Number.isFinite(percent)) {
          inkSamples.push(percent);
        }
      }

      // For virtual printers, assume 100% ink (testing mode)
      if (isVirtualPrinter && inkSamples.length === 0) {
        inkSamples.push(100);
      }

      if (inkSamples.length > 0) {
        const printerMinInk = Math.min(...inkSamples);
        if (minInk === null || printerMinInk < minInk) {
          minInk = printerMinInk;
        }
      }
    }

    const lowInk = minInk !== null && minInk <= this.readinessMinInkPercent;
    return {
      hasOnlinePrinter,
      minInk,
      lowInk,
    };
  }

  private async maybeEmitHeartbeat(nodeId: unknown, printers: unknown[], force = false) {
    const id = String(nodeId || '').trim();
    if (!id) {
      return;
    }

    const now = Date.now();
    const lastSent = this.lastHeartbeatByNodeId.get(id) || 0;
    if (!force && now - lastSent < this.heartbeatIntervalMs) {
      return;
    }

    const printerList = Array.isArray(printers) ? printers : [];
    const timestampIso = new Date(now).toISOString();
    const sequenceNumber = (this.heartbeatSequenceByNodeId.get(id) || 0) + 1;
    this.heartbeatSequenceByNodeId.set(id, sequenceNumber);

    const printerReadiness = this.evaluatePrinterReadiness(printerList);

    const reasonsIfNotReady: string[] = [];
    if (!this.connectionState.connected) {
      reasonsIfNotReady.push(this.connectionState.lastError || 'not_connected');
    }
    if (!printerReadiness.hasOnlinePrinter) {
      reasonsIfNotReady.push('no_online_printer');
    }
    if (printerReadiness.lowInk) {
      reasonsIfNotReady.push('low_ink');
    }
    const ready = reasonsIfNotReady.length === 0;

    const heartbeatPayload = {
      type: 'HEARTBEAT',
      agentId: this.connection.agentId || 'kiosk-cloud',
      nodeId: id,
      timestamp: timestampIso,
      sequenceNumber,
      eventId: randomUUID(),
      liveness: {
        signal: true,
        uptime_seconds: Math.max(0, Math.floor(process.uptime())),
      },
      readiness: {
        ready,
        reasons_if_not_ready: reasonsIfNotReady,
      },
      auth: {
        authenticated: Boolean(this.connection.nodeEmail && this.connection.nodePassword),
        token_expires_in: this.heartbeatAuthTtlSeconds,
      },
    };

    try {
      const paperLevel = printerReadiness.lowInk ? 'LOW' : 'HIGH';
      await this.nodeService.updateHeartbeat(id, paperLevel, printerList);
      await this.nodeService.ingestAgentEvent(id, 'HEARTBEAT', heartbeatPayload, timestampIso);
      this.lastHeartbeatByNodeId.set(id, now);
      this.connectionState.connected = true;
      this.connectionState.lastError = null;
      this.connectionState.lastCheckedAt = new Date(now).toISOString();
    } catch (error) {
      this.connectionState.connected = false;
      this.connectionState.lastError = error instanceof Error ? error.message : 'Heartbeat failed';
      this.connectionState.lastCheckedAt = new Date(now).toISOString();
    }
  }
}
