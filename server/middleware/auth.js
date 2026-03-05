import crypto from 'node:crypto';
import { logInfo, logWarn } from '../utils/logger.js';

const SESSION_TTL_MS = Number(process.env.ADMIN_SESSION_TTL_MS || 24 * 60 * 60 * 1000);
const sessions = new Map();

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(token);
    }
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

  cleanupExpiredSessions();

  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(token, { expiresAt });
  logInfo('auth', 'createSession.success', { expiresAt: new Date(expiresAt).toISOString() });

  return {
    token,
    expiresAt: new Date(expiresAt).toISOString(),
  };
}

export function requireAuth(req, res, next) {
  cleanupExpiredSessions();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const session = sessions.get(token);

  if (!session || session.expiresAt <= Date.now()) {
    if (token) {
      sessions.delete(token);
    }
    logWarn('auth', 'requireAuth.unauthorized', {
      requestId: req.requestId,
      hasToken: Boolean(token),
    });
    return res.status(401).json({ message: 'Unauthorized' });
  }

  logInfo('auth', 'requireAuth.authorized', { requestId: req.requestId });
  return next();
}
