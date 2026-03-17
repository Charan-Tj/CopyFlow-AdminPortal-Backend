const snmp = require('net-snmp');

const SUPPLY_DESC_OID = '1.3.6.1.2.1.43.11.1.1.6.1';
const SUPPLY_MAX_OID = '1.3.6.1.2.1.43.11.1.1.8.1';
const SUPPLY_LEVEL_OID = '1.3.6.1.2.1.43.11.1.1.9.1';

function extractPrinterHost(printer) {
  const explicitHost = printer.host || printer.ip || null;
  if (explicitHost) {
    return explicitHost;
  }

  const port = String(printer.portName || '');
  const match = port.match(/(\d{1,3}(?:\.\d{1,3}){3})/);
  return match ? match[1] : null;
}

function walkOid(session, oid) {
  return new Promise((resolve, reject) => {
    const rows = [];
    session.subtree(
      oid,
      (varbind) => {
        if (!snmp.isVarbindError(varbind)) {
          rows.push(varbind);
        }
      },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(rows);
      }
    );
  });
}

function toIndex(oid) {
  const parts = String(oid).split('.');
  return parts[parts.length - 1];
}

function toConsumables(descRows, maxRows, levelRows) {
  const maxMap = new Map(maxRows.map((row) => [toIndex(row.oid), Number(row.value)]));
  const levelMap = new Map(levelRows.map((row) => [toIndex(row.oid), Number(row.value)]));

  return descRows
    .map((row) => {
      const index = toIndex(row.oid);
      const description = String(row.value || '').trim();
      const max = maxMap.get(index);
      const level = levelMap.get(index);
      if (!Number.isFinite(max) || !Number.isFinite(level) || max <= 0) {
        return null;
      }

      const percent = Math.max(0, Math.min(100, Math.round((level / max) * 100)));
      return {
        index,
        description,
        level,
        max,
        percent
      };
    })
    .filter(Boolean);
}

async function queryPrinterConsumables(printer, options = {}) {
  if (!options.enabled) {
    return null;
  }

  const host = extractPrinterHost(printer);
  if (!host) {
    return null;
  }

  const session = snmp.createSession(host, options.community || 'public', {
    timeout: Number(options.timeoutMs || 2000),
    version: snmp.Version2c,
    retries: 0
  });

  try {
    const [descRows, maxRows, levelRows] = await Promise.all([
      walkOid(session, SUPPLY_DESC_OID),
      walkOid(session, SUPPLY_MAX_OID),
      walkOid(session, SUPPLY_LEVEL_OID)
    ]);

    const consumables = toConsumables(descRows, maxRows, levelRows);
    return {
      host,
      consumables,
      sampledAt: new Date().toISOString()
    };
  } finally {
    session.close();
  }
}

module.exports = {
  queryPrinterConsumables
};
