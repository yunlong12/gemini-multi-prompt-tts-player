function nowIso() {
  return new Date().toISOString();
}

function toSafeValue(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value === undefined) return undefined;
  if (typeof value === 'bigint') return String(value);
  return value;
}

function write(level, scope, message, context = {}) {
  const payload = {
    ts: nowIso(),
    level,
    scope,
    message,
    ...Object.fromEntries(
      Object.entries(context).map(([key, value]) => [key, toSafeValue(value)])
    ),
  };

  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logInfo(scope, message, context = {}) {
  write('info', scope, message, context);
}

export function logWarn(scope, message, context = {}) {
  write('warn', scope, message, context);
}

export function logError(scope, message, context = {}) {
  write('error', scope, message, context);
}

export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  const requestId =
    req.headers['x-request-id'] ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  req.requestId = String(requestId);

  logInfo('http', 'request.start', {
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.headers['x-forwarded-for'] || req.ip,
    userAgent: req.headers['user-agent'],
  });

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    logInfo('http', 'request.finish', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    });
  });

  next();
}
