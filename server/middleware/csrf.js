import { logWarn } from '../utils/logger.js';

function parseOriginHeader(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  try {
    return new URL(raw).origin;
  } catch {
    return '';
  }
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = String(req.get('host') || '').trim();
  if (!host) {
    return '';
  }
  return `${protocol}://${host}`;
}

function getAllowedOrigins(req) {
  const explicitOrigins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => parseOriginHeader(value))
    .filter(Boolean);

  const configuredBaseUrls = [
    process.env.APP_BASE_URL,
    process.env.CLOUD_RUN_SERVICE_URL,
  ]
    .map((value) => parseOriginHeader(value))
    .filter(Boolean);

  const requestOrigin = getRequestOrigin(req);

  return new Set([
    ...explicitOrigins,
    ...configuredBaseUrls,
    requestOrigin,
  ].filter(Boolean));
}

function getSourceOrigin(req) {
  const originHeader = parseOriginHeader(req.headers.origin);
  if (originHeader) {
    return originHeader;
  }

  const refererHeader = String(req.headers.referer || '').trim();
  if (!refererHeader) {
    return '';
  }

  try {
    return new URL(refererHeader).origin;
  } catch {
    return '';
  }
}

export function requireTrustedOrigin(req, res, next) {
  const sourceOrigin = getSourceOrigin(req);
  const allowedOrigins = getAllowedOrigins(req);

  if (!sourceOrigin) {
    logWarn('csrf', 'missing_origin', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
    });
    return res.status(403).json({ message: 'Cross-site request blocked.' });
  }

  if (!allowedOrigins.has(sourceOrigin)) {
    logWarn('csrf', 'origin_not_allowed', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      sourceOrigin,
      allowedOrigins: Array.from(allowedOrigins),
    });
    return res.status(403).json({ message: 'Cross-site request blocked.' });
  }

  return next();
}
