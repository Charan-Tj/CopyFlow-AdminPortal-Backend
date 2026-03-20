import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { NodeService } from '../node/node.service';
import { PrismaService } from '../prisma/prisma.service';

type SessionRecord = {
  userName: string;
  mode: 'local' | 'node';
  expiresAt: number;
  node?: NodeContext;
};

type DashboardStatsRow = {
  total_jobs: bigint | number;
  successful_jobs: bigint | number;
  failed_jobs: bigint | number;
  total_revenue: Prisma.Decimal | number | string | null;
  total_pages: bigint | number | null;
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
  private readonly dashboardPassword =
    process.env.KIOSK_DASHBOARD_PASSWORD || 'admin123';
  private readonly dashboardSessionTtlMs = Number(
    process.env.DASHBOARD_SESSION_TTL_MS || 8 * 60 * 60 * 1000,
  );
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly dashboardCacheTtlMs = Number(
    process.env.KIOSK_DASHBOARD_CACHE_MS || 2000,
  );
  private readonly dashboardCache = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();
  private readonly heartbeatIntervalMs = Number(
    process.env.KIOSK_BRIDGE_HEARTBEAT_MS || 15000,
  );
  private readonly heartbeatAuthTtlSeconds = Number(
    process.env.KIOSK_BRIDGE_TOKEN_TTL_SECONDS || 1800,
  );
  private readonly readinessMinInkPercent = Number(
    process.env.KIOSK_BRIDGE_MIN_INK_LEVEL || process.env.MIN_INK_LEVEL || 10,
  );
  private readonly lastHeartbeatByNodeId = new Map<string, number>();
  private readonly heartbeatSequenceByNodeId = new Map<string, number>();

  private readonly connection: ConnectionConfig = {
    serverUrl:
      process.env.KIOSK_DEFAULT_SERVER_URL || process.env.SERVER_URL || '',
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
  private connectedNodeContext: NodeContext | null = null;

  constructor(
    private readonly nodeService: NodeService,
    private readonly prisma: PrismaService,
  ) {}

  private inferSenderSource(
    phoneNumber: string | null | undefined,
  ): 'WhatsApp' | 'Telegram' | 'Website' | 'Unknown' {
    const raw = String(phoneNumber || '')
      .trim()
      .toLowerCase();

    if (!raw) {
      return 'Website';
    }

    if (
      raw.startsWith('whatsapp:') ||
      raw.startsWith('wa:') ||
      raw.startsWith('+')
    ) {
      return 'WhatsApp';
    }

    if (raw.startsWith('telegram:') || /^\d{8,}$/.test(raw)) {
      return 'Telegram';
    }

    if (
      raw.startsWith('web:') ||
      raw.startsWith('site:') ||
      raw.startsWith('portal:')
    ) {
      return 'Website';
    }

    return 'Unknown';
  }

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

    if (
      userName === this.dashboardUser &&
      password === this.dashboardPassword
    ) {
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
    const latestPrinters = await this.getLatestPrinterList(
      String(nodeLogin.node?.id || ''),
    );
    this.connection.nodeEmail = userName;
    this.connection.nodePassword = password;
    this.connection.agentId = nodeLogin.node?.code || this.connection.agentId;
    this.connectionState.connected = true;
    this.connectionState.lastError = null;
    this.connectionState.lastCheckedAt = new Date().toISOString();
    await this.maybeEmitHeartbeat(nodeLogin.node?.id, latestPrinters);

    const nodeContext: NodeContext = {
      id: String(nodeLogin.node?.id || ''),
      name: String(nodeLogin.node?.name || ''),
      code: String(nodeLogin.node?.code || ''),
    };
    this.connectedNodeContext = nodeContext;
    const token = this.createSession(userName, 'node', nodeContext);
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

    this.dashboardCache.clear();
    this.connectedNodeContext = null;

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

    if (typeof body.serverUrl === 'string')
      this.connection.serverUrl = body.serverUrl.trim();
    if (typeof body.agentId === 'string')
      this.connection.agentId = body.agentId.trim();
    if (typeof body.nodeEmail === 'string')
      this.connection.nodeEmail = body.nodeEmail.trim();
    if (typeof body.nodePassword === 'string' && body.nodePassword.trim())
      this.connection.nodePassword = body.nodePassword.trim();
    if (typeof body.defaultPrinterName === 'string')
      this.connection.defaultPrinterName = body.defaultPrinterName.trim();
    if (typeof body.pendingJobsPath === 'string' && body.pendingJobsPath.trim())
      this.connection.pendingJobsPath = body.pendingJobsPath.trim();
    if (typeof body.eventsPath === 'string' && body.eventsPath.trim())
      this.connection.eventsPath = body.eventsPath.trim();
    if (typeof body.loginPath === 'string' && body.loginPath.trim())
      this.connection.loginPath = body.loginPath.trim();

    this.dashboardCache.clear();
    this.connectedNodeContext = null;

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
      const nodeLogin = await this.nodeService.login(
        this.connection.nodeEmail,
        this.connection.nodePassword,
      );
      const latestPrinters = await this.getLatestPrinterList(
        String(nodeLogin.node?.id || ''),
      );
      this.connectionState.connected = true;
      this.connectionState.lastError = null;
      this.connectionState.lastCheckedAt = new Date().toISOString();
      this.connection.agentId = nodeLogin.node?.code || this.connection.agentId;
      this.connectedNodeContext = {
        id: String(nodeLogin.node?.id || ''),
        name: String(nodeLogin.node?.name || ''),
        code: String(nodeLogin.node?.code || ''),
      };
      await this.maybeEmitHeartbeat(nodeLogin.node?.id, latestPrinters, true);
      return {
        ok: true,
        node: nodeLogin.node,
      };
    } catch (error) {
      this.connectionState.connected = false;
      this.connectionState.lastError =
        error instanceof Error ? error.message : 'Connection failed';
      this.connectionState.lastCheckedAt = new Date().toISOString();
      return {
        ok: false,
        error: this.connectionState.lastError,
      };
    }
  }

  async getDashboard(req: any) {
    const session = this.requireSession(this.getToken(req));

    const node = await this.resolveNodeContext(session);
    if (!node) {
      return this.emptyDashboard();
    }

    const rawJobsLimit = parseInt(req.query?.jobsLimit || '30', 10);
    const rawJobsOffset = parseInt(req.query?.jobsOffset || '0', 10);
    const jobsLimit = Math.min(100, Math.max(1, Number.isFinite(rawJobsLimit) ? rawJobsLimit : 30));
    const jobsOffset = Math.max(0, Number.isFinite(rawJobsOffset) ? rawJobsOffset : 0);

    const dashboardCacheKey = `${node.id}:${jobsLimit}:${jobsOffset}`;
    const cached = this.dashboardCache.get(dashboardCacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const [kiosk, queueJobs] = await Promise.all([
      this.prisma.kiosk.findFirst({
        where: { node_id: node.id },
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.printJob.findMany({
        where: { node_id: node.id, status: 'PAID' },
        orderBy: { createdAt: 'asc' },
        take: 20,
      }),
    ]);

    const [recentJobs, statsRows, paidAgg] = await Promise.all([
      this.prisma.printJob.findMany({
        where: { node_id: node.id },
        orderBy: { updatedAt: 'desc' },
        take: jobsLimit,
        skip: jobsOffset,
      }),
      this.prisma.$queryRaw<DashboardStatsRow[]>`
        SELECT
          COUNT(*)::bigint AS total_jobs,
          COUNT(*) FILTER (WHERE status = 'PRINTED')::bigint AS successful_jobs,
          COUNT(*) FILTER (WHERE status = 'FAILED')::bigint AS failed_jobs,
          COALESCE(SUM(payable_amount), 0)::numeric AS total_revenue,
          COALESCE(SUM(page_count), 0)::bigint AS total_pages
        FROM "PrintJob"
        WHERE node_id = ${node.id}
      `,
      this.prisma.payment.aggregate({
        where: {
          job: { node_id: node.id },
          status: { in: ['PAID', 'SUCCESS', 'CAPTURED'] },
        },
        _sum: { amount: true },
      }),
    ]);

    // Removed auditLogs and notifications to reduce latency
    // as they are not currently displayed in the streamlined Kiosk UI

    const stats = statsRows[0] || {
      total_jobs: 0,
      successful_jobs: 0,
      failed_jobs: 0,
      total_revenue: 0,
      total_pages: 0,
    };

    const totalJobs = Number(stats.total_jobs || 0);
    const successfulJobs = Number(stats.successful_jobs || 0);
    const failedJobs = Number(stats.failed_jobs || 0);
    const expectedRevenue = this.toNumber(stats.total_revenue);
    const totalPages = Number(stats.total_pages || 0);
    const paidRevenue = this.toNumber(paidAgg._sum.amount);

    const printerList = this.extractPrinters(kiosk?.printer_list);

    const dashboard = {
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
        totalPages: Math.max(0, totalPages),
      },
      queue: {
        jobs: queueJobs.map((job) => ({
          id: job.job_id,
          jobId: job.job_id,
          userName: job.user_name || job.phone_number || 'Unknown',
          sender: job.phone_number || null,
          source: this.inferSenderSource(job.phone_number),
          documentName:
            job.document_name ||
            this.extractDocumentName(job.file_urls) ||
            'Document',
          copies: job.copies,
          pages: job.page_count,
          sides: job.sides,
          color: job.color_mode === 'COLOR',
          amount: this.toNumber(job.payable_amount),
          status: job.status,
          printerName:
            job.assigned_printer ||
            this.connection.defaultPrinterName ||
            'Auto',
          createdAt: job.createdAt.toISOString(),
          phoneNumber: job.phone_number || null,
        })),
      },
      printers: printerList,
      jobs: recentJobs.map((job) => ({
        jobId: job.job_id,
        userName: job.user_name || job.phone_number || 'Unknown',
        owner: job.user_name || job.phone_number || 'Unknown',
        sender: job.phone_number || null,
        source: this.inferSenderSource(job.phone_number),
        phoneNumber: job.phone_number || null,
        documentName:
          job.document_name ||
          this.extractDocumentName(job.file_urls) ||
          'Document',
        status: job.status,
        printerName:
          job.assigned_printer || this.connection.defaultPrinterName || 'Auto',
        pages: job.page_count,
        copies: job.copies,
        sides: job.sides,
        color: job.color_mode === 'COLOR',
        amount: this.toNumber(job.payable_amount),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      })),
      sla: {},
      diagnostics: {},
      reconciliation: {
        expected: expectedRevenue,
        paid: paidRevenue,
        delta: Number((paidRevenue - expectedRevenue).toFixed(2)),
      },
      notifications: [],
      auditLogs: [],
    };

    this.dashboardCache.set(dashboardCacheKey, {
      value: dashboard,
      expiresAt: now + this.dashboardCacheTtlMs,
    });

    return dashboard;
  }

  async getLogs(req: any) {
    const session = this.requireSession(this.getToken(req));
    const node = await this.resolveNodeContext(session);

    if (!node) {
      return { logs: [] };
    }

    const limit = Math.min(100, parseInt(req.query?.limit || '10', 10));
    const offset = parseInt(req.query?.offset || '0', 10);

    const logs = await this.prisma.kioskSystemLog.findMany({
      where: { node_id: node.id },
      orderBy: { created_at: 'desc' },
      take: limit,
      skip: offset,
    });

    return {
      logs: logs.map((entry) => ({
        time: entry.created_at.toISOString(),
        level: entry.level,
        message: entry.message,
      })),
      page: {
        hasMore: logs.length === limit,
        nextOffset: offset + logs.length,
      },
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
    // Handle new summary format
    if (rawPrinterList && typeof rawPrinterList === 'object' && !Array.isArray(rawPrinterList)) {
      const summary = rawPrinterList as any;
      if (typeof summary.totalPrinters === 'number') {
        const onlinePrinters = summary.onlinePrinters || 0;
        const totalPrinters = summary.totalPrinters || 0;
        const offlinePrinters = totalPrinters - onlinePrinters;
        const minInkLevel = summary.minInkLevel !== null && summary.minInkLevel !== undefined
          ? Math.round(summary.minInkLevel)
          : null;

        const printers = [];

        // Create summary entries for online and offline printers
        if (onlinePrinters > 0) {
          printers.push({
            name: onlinePrinters === 1 ? 'Printer' : `${onlinePrinters} Printers`,
            printerStatus: 'ONLINE',
            inkLevel: minInkLevel !== null ? minInkLevel : 100,
            healthScore: 100,
            icon: 'online-printer',
          });
        }

        if (offlinePrinters > 0) {
          printers.push({
            name: offlinePrinters === 1 ? 'Offline Printer' : `${offlinePrinters} Offline Printers`,
            printerStatus: 'OFFLINE',
            inkLevel: 0,
            healthScore: 0,
            icon: 'offline-printer',
          });
        }

        return printers;
      }
    }

    // Handle old array format
    const list = Array.isArray(rawPrinterList) ? rawPrinterList : [];
    return list.map((printer: any) => {
      const healthScore = this.toNumber(
        printer?.health_score ?? printer?.healthScore ?? 100,
      );
      const ink = this.toNumber(printer?.ink_level ?? printer?.inkLevel ?? 100);

      let online = true;
      if (printer?.is_online !== undefined) {
        online = Boolean(printer.is_online);
      } else if (printer?.online !== undefined) {
        online = Boolean(printer.online);
      } else if (printer?.workOffline !== undefined) {
        online = !printer.workOffline;
      } else if (
        printer?.printerStatus !== undefined &&
        printer?.printerStatus === 128
      ) {
        // According to windows printer status, sometimes 128 means offline/error depending on drivers
        // But workOffline is better.
      }

      return {
        name: String(printer?.name || printer?.printer_name || 'Printer'),
        printerStatus: online ? 'ONLINE' : 'OFFLINE',
        inkLevel: Math.max(0, Math.min(100, Math.round(ink))),
        healthScore: Math.max(0, Math.min(100, Math.round(healthScore))),
        icon: online ? 'online-printer' : 'offline-printer',
      };
    });
  }

  private async resolveNodeContext(
    session?: SessionRecord,
  ): Promise<NodeContext | null> {
    if (session?.mode === 'node' && session.node?.id) {
      return session.node;
    }

    if (this.connectedNodeContext?.id) {
      return this.connectedNodeContext;
    }

    return null;
  }

  private createSession(
    userName: string,
    mode: 'local' | 'node',
    node?: NodeContext,
  ) {
    const token = randomUUID();
    this.sessions.set(token, {
      userName,
      mode,
      expiresAt: Date.now() + this.dashboardSessionTtlMs,
      node,
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

    return Array.isArray(kiosk?.printer_list)
      ? (kiosk.printer_list as unknown[])
      : [];
  }

  private extractDocumentName(fileUrls: unknown): string | null {
    const list = Array.isArray(fileUrls) ? fileUrls : [];
    if (list.length === 0) {
      return null;
    }

    const first = list[0];
    const rawUrl =
      typeof first === 'string' ? first : String(first?.url || '').trim();
    if (!rawUrl) {
      return null;
    }

    const sanitized = rawUrl.split('?')[0].trim();
    const chunks = sanitized.split('/').filter(Boolean);
    const filename = chunks[chunks.length - 1];
    return filename || null;
  }

  private evaluatePrinterReadiness(printers: unknown[]) {
    const list = Array.isArray(printers) ? printers : [];
    let hasOnlinePrinter = false;
    let minInk: number | null = null;

    for (const item of list) {
      const printer = item as any;
      const onlineFlag = printer?.online ?? printer?.is_online;
      const statusText = String(
        printer?.printerStatus || printer?.status || '',
      ).toUpperCase();
      const online =
        typeof onlineFlag === 'boolean'
          ? onlineFlag
          : statusText.includes('ONLINE');
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

      const consumables = Array.isArray(printer?.consumables)
        ? printer.consumables
        : [];
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

  private async maybeEmitHeartbeat(
    nodeId: unknown,
    printers: unknown[],
    force = false,
  ) {
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
        authenticated: Boolean(
          this.connection.nodeEmail && this.connection.nodePassword,
        ),
        token_expires_in: this.heartbeatAuthTtlSeconds,
      },
    };

    try {
      const paperLevel = printerReadiness.lowInk ? 'LOW' : 'HIGH';
      await this.nodeService.updateHeartbeat(id, paperLevel, printerList);
      await this.nodeService.ingestAgentEvent(
        id,
        'HEARTBEAT',
        heartbeatPayload,
        timestampIso,
      );
      this.lastHeartbeatByNodeId.set(id, now);
      this.connectionState.connected = true;
      this.connectionState.lastError = null;
      this.connectionState.lastCheckedAt = new Date(now).toISOString();
    } catch (error) {
      this.connectionState.connected = false;
      this.connectionState.lastError =
        error instanceof Error ? error.message : 'Heartbeat failed';
      this.connectionState.lastCheckedAt = new Date(now).toISOString();
    }
  }
}
