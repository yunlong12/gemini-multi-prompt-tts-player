import crypto from 'node:crypto';
import { logInfo, logWarn } from '../utils/logger.js';

const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const COOKIE_NAME = 'gemini_admin_session';
const SESSION_VERSION = 1;

function getSigningSecret() {
  return String(process.env.ADMIN_SESSION_SECRET || process.env.APP_ADMIN_PASSWORD || '').trim();
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = String(input || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || '');
  if (!raw) return {};

  return raw
    .split(';')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .reduce((accumulator, chunk) => {
      const separatorIndex = chunk.indexOf('=');
      if (separatorIndex === -1) return accumulator;
      const key = chunk.slice(0, separatorIndex).trim();
      const value = chunk.slice(separatorIndex + 1).trim();
      accumulator[key] = decodeURIComponent(value);
      return accumulator;
    }, {});
}

function serializeCookie(name, value, maxAgeMs) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];

  if (maxAgeMs >= 0) {
    parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
    parts.push(`Expires=${new Date(Date.now() + maxAgeMs).toUTCString()}`);
  } else {
    parts.push('Max-Age=0');
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  }

  if (process.env.NODE_ENV !== 'development') {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function buildSessionCookie(expiresAtMs) {
  const secret = getSigningSecret();
  if (!secret) {
    throw new Error('Missing ADMIN_SESSION_SECRET or APP_ADMIN_PASSWORD in environment.');
  }

  const payload = JSON.stringify({
    v: SESSION_VERSION,
    exp: expiresAtMs,
  });
  const encodedPayload = base64UrlEncode(payload);
  const signature = signPayload(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function parseSessionCookie(cookieValue) {
  const secret = getSigningSecret();
  if (!secret || !cookieValue) return null;

  const [encodedPayload, signature] = String(cookieValue).split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSignature = signPayload(encodedPayload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    if (payload?.v !== SESSION_VERSION || !Number.isFinite(payload?.exp)) {
      return null;
    }
    if (payload.exp <= Date.now()) {
      return null;
    }
    return {
      expiresAt: new Date(payload.exp).toISOString(),
    };
  } catch {
    return null;
  }
}

export function createSession(password) {
  const expectedPassword = process.env.APP_ADMIN_PASSWORD;
  if (!expectedPassword) {
    throw new Error('Missing APP_ADMIN_PASSWORD in environment.');
  }

  if (password !== expectedPassword) {
    logWarn('auth', 'createSession.invalid_password');
    return null;
  }

  const expiresAtMs = Date.now() + SESSION_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const cookieValue = buildSessionCookie(expiresAtMs);
  logInfo('auth', 'createSession.success', { expiresAt });

  return {
    expiresAt,
    cookieValue,
  };
}

export function setSessionCookie(res, cookieValue) {
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAME, cookieValue, SESSION_TTL_MS));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAME, '', -1));
}

export function getSessionFromRequest(req) {
  const cookies = parseCookies(req);
  return parseSessionCookie(cookies[COOKIE_NAME]);
}

export function requireAuth(req, res, next) {
  const session = getSessionFromRequest(req);
  if (!session) {
    logWarn('auth', 'requireAuth.unauthorized', {
      requestId: req.requestId,
      hasCookie: Boolean(parseCookies(req)[COOKIE_NAME]),
    });
    return res.status(401).json({ message: 'Unauthorized' });
  }

  req.authSession = session;
  logInfo('auth', 'requireAuth.authorized', {
    requestId: req.requestId,
    expiresAt: session.expiresAt,
  });
  return next();
}
