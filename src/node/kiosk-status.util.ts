type KioskLike = {
  pi_id: string;
  runtime_status?: string | null;
  paper_level?: string | null;
  last_heartbeat?: Date | string | null;
  printer_list?: unknown;
};

export type KioskStatusSnapshot = {
  kioskId: string | null;
  runtimeStatus: string;
  paperLevel: string;
  isOnline: boolean;
  isPrintingReady: boolean;
  reason: string;
  heartbeatAgeMs: number | null;
  totalPrinters: number;
  onlinePrinters: number;
};

const DEFAULT_ONLINE_WINDOW_MS = Number(process.env.KIOSK_ONLINE_WINDOW_MS || 120000);
const EXEMPT_TEST_KIOSKS = String(process.env.EXEMPT_TEST_KIOSKS || 'TEST01')
  .split(',')
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);

function parseHeartbeatMs(lastHeartbeat?: Date | string | null): number | null {
  if (!lastHeartbeat) {
    return null;
  }

  const value = new Date(lastHeartbeat).getTime();
  return Number.isNaN(value) ? null : value;
}

function countPrinters(printerList: unknown): { total: number; online: number } {
  // Handle new summary format
  if (printerList && typeof printerList === 'object' && !Array.isArray(printerList)) {
    const summary = printerList as Record<string, unknown>;
    if (typeof summary.totalPrinters === 'number' && typeof summary.onlinePrinters === 'number') {
      return {
        total: summary.totalPrinters,
        online: summary.onlinePrinters
      };
    }
  }

  // Handle old array format
  if (!Array.isArray(printerList)) {
    return { total: 0, online: 0 };
  }

  let online = 0;
  for (const entry of printerList) {
    const printer = (entry || {}) as Record<string, unknown>;
    const workOffline = Boolean(printer.workOffline);
    const statusText = String(printer.status || printer.printerStatus || '').toUpperCase();
    const isExplicitOffline = statusText === 'OFFLINE';
    if (!workOffline && !isExplicitOffline) {
      online += 1;
    }
  }

  return {
    total: printerList.length,
    online
  };
}

export function evaluateKioskStatus(
  kiosk: KioskLike | null,
  onlineWindowMs = DEFAULT_ONLINE_WINDOW_MS,
  nodeCode?: string | null
): KioskStatusSnapshot {
  const normalizedNodeCode = String(nodeCode || '').trim().toUpperCase();
  const isExemptTestKiosk = normalizedNodeCode.length > 0 && EXEMPT_TEST_KIOSKS.includes(normalizedNodeCode);

  if (isExemptTestKiosk) {
    const runtimeStatus = String(kiosk?.runtime_status || 'ONLINE').toUpperCase();
    const paperLevel = String(kiosk?.paper_level || 'HIGH').toUpperCase();
    const heartbeatMs = parseHeartbeatMs(kiosk?.last_heartbeat);
    const heartbeatAgeMs = heartbeatMs === null ? null : Date.now() - heartbeatMs;
    const { total, online } = countPrinters(kiosk?.printer_list);

    return {
      kioskId: kiosk?.pi_id || null,
      runtimeStatus,
      paperLevel,
      isOnline: true,
      isPrintingReady: true,
      reason: 'READY (test kiosk exemption)',
      heartbeatAgeMs,
      totalPrinters: total,
      onlinePrinters: online
    };
  }

  if (!kiosk) {
    return {
      kioskId: null,
      runtimeStatus: 'OFFLINE',
      paperLevel: 'UNKNOWN',
      isOnline: false,
      isPrintingReady: false,
      reason: 'No kiosk registered for node',
      heartbeatAgeMs: null,
      totalPrinters: 0,
      onlinePrinters: 0
    };
  }

  const runtimeStatus = String(kiosk.runtime_status || 'OFFLINE').toUpperCase();
  const paperLevel = String(kiosk.paper_level || 'UNKNOWN').toUpperCase();
  const heartbeatMs = parseHeartbeatMs(kiosk.last_heartbeat);
  const heartbeatAgeMs = heartbeatMs === null ? null : Date.now() - heartbeatMs;
  const { total, online } = countPrinters(kiosk.printer_list);

  const heartbeatFresh = heartbeatAgeMs !== null && heartbeatAgeMs <= onlineWindowMs;
  const isOnline = runtimeStatus !== 'OFFLINE' && heartbeatFresh;
  const paperOk = paperLevel !== 'LOW';
  const printersOk = online > 0;
  const isPrintingReady = isOnline && paperOk && printersOk;

  let reason = 'READY';
  if (!heartbeatFresh) {
    reason = 'No recent kiosk heartbeat';
  } else if (runtimeStatus === 'OFFLINE') {
    reason = 'Kiosk runtime status is OFFLINE';
  } else if (!paperOk) {
    reason = 'Kiosk paper/supplies level is LOW';
  } else if (!printersOk) {
    reason = 'No online printers reported by kiosk';
  }

  return {
    kioskId: kiosk.pi_id,
    runtimeStatus,
    paperLevel,
    isOnline,
    isPrintingReady,
    reason,
    heartbeatAgeMs,
    totalPrinters: total,
    onlinePrinters: online
  };
}

export function deriveRuntimeStatus(paperLevel: string, printers: unknown): 'ONLINE' | 'DEGRADED' {
  const normalizedPaperLevel = String(paperLevel || 'HIGH').toUpperCase();
  const { online } = countPrinters(printers);

  if (normalizedPaperLevel === 'LOW' || online <= 0) {
    return 'DEGRADED';
  }

  return 'ONLINE';
}
