function createLogger(emitLog) {
  function write(level, message, extra) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      extra: extra || null
    };

    if (emitLog) {
      emitLog(entry);
    }

    const consoleMethod = level === 'error' ? console.error : console.log;
    consoleMethod(`[${entry.timestamp}] [${level.toUpperCase()}] ${message}`);
  }

  return {
    info: (message, extra) => write('info', message, extra),
    warn: (message, extra) => write('warn', message, extra),
    error: (message, extra) => write('error', message, extra)
  };
}

module.exports = { createLogger };
