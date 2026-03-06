import { logError, logInfo, logWarn } from '../utils/logger.js';
import { getFirestore } from '../services/scheduleStore.js';

const localBuckets = new Map();
const rateLimitCollection = process.env.FIRESTORE_COLLECTION_RATE_LIMITS || 'rate_limits';

function getClientIp(req) {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').trim();
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function getUtcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getDayWindow(now = new Date()) {
  const dayKey = getUtcDayKey(now);
  const windowStart = `${dayKey}T00:00:00.000Z`;
  const nextDay = new Date(`${dayKey}T00:00:00.000Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  return {
    dayKey,
    windowStart,
    windowEnd: nextDay.toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((nextDay.getTime() - now.getTime()) / 1000)),
  };
}

async function incrementFirestoreBucket({ scope, maxRequests, req }) {
  const db = getFirestore();
  if (!db) {
    return null;
  }

  const now = new Date();
  const { dayKey, windowStart, windowEnd, retryAfterSeconds } = getDayWindow(now);
  const docId = `${scope}:${dayKey}`;
  const docRef = db.collection(rateLimitCollection).doc(docId);
  const clientIp = getClientIp(req);

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(docRef);

    if (!snapshot.exists) {
      transaction.set(docRef, {
        scope,
        dayKey,
        count: 1,
        maxRequests,
        windowStart,
        windowEnd,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        lastRequestAt: now.toISOString(),
      });

      return {
        allowed: true,
        count: 1,
        retryAfterSeconds,
        storage: 'firestore',
        clientIp,
      };
    }

    const data = snapshot.data() || {};
    const currentCount = Number(data.count || 0);

    if (currentCount >= maxRequests) {
      return {
        allowed: false,
        count: currentCount,
        retryAfterSeconds,
        storage: 'firestore',
        clientIp,
      };
    }

    const nextCount = currentCount + 1;
    transaction.set(
      docRef,
      {
        scope,
        dayKey,
        count: nextCount,
        maxRequests,
        windowStart,
        windowEnd,
        updatedAt: now.toISOString(),
        lastRequestAt: now.toISOString(),
      },
      { merge: true }
    );

    return {
      allowed: true,
      count: nextCount,
      retryAfterSeconds,
      storage: 'firestore',
      clientIp,
    };
  });
}

function incrementLocalBucket({ scope, maxRequests, req }) {
  const now = new Date();
  const { dayKey, retryAfterSeconds } = getDayWindow(now);
  const bucketKey = `${scope}:${dayKey}`;
  const existingCount = Number(localBuckets.get(bucketKey) || 0);
  const nextCount = existingCount + 1;
  const allowed = existingCount < maxRequests;

  if (allowed) {
    localBuckets.set(bucketKey, nextCount);
  }

  return {
    allowed,
    count: allowed ? nextCount : existingCount,
    retryAfterSeconds,
    storage: 'memory_fallback',
    clientIp: getClientIp(req),
  };
}

export function createRateLimit({
  scope,
  windowMs,
  maxRequests,
  message,
}) {
  if (!scope) {
    throw new Error('Rate limit scope is required.');
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error(`Invalid windowMs for ${scope}.`);
  }
  if (!Number.isFinite(maxRequests) || maxRequests <= 0) {
    throw new Error(`Invalid maxRequests for ${scope}.`);
  }

  if (windowMs !== 24 * 60 * 60 * 1000) {
    logWarn('rateLimit', 'non_daily_window_configured', { scope, windowMs });
  }

  return async function rateLimitMiddleware(req, res, next) {
    try {
      let result = await incrementFirestoreBucket({ scope, maxRequests, req });
      if (!result) {
        result = incrementLocalBucket({ scope, maxRequests, req });
        logWarn('rateLimit', 'firestore_unavailable_using_local_fallback', {
          requestId: req.requestId,
          scope,
          clientIp: result.clientIp,
        });
      }

      if (!result.allowed) {
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        logWarn('rateLimit', 'request.blocked', {
          requestId: req.requestId,
          scope,
          clientIp: result.clientIp,
          count: result.count,
          maxRequests,
          retryAfterSeconds: result.retryAfterSeconds,
          storage: result.storage,
        });
        return res.status(429).json({
          message: message || 'Too many requests. Please try again later.',
        });
      }

      logInfo('rateLimit', 'request.allowed', {
        requestId: req.requestId,
        scope,
        clientIp: result.clientIp,
        count: result.count,
        maxRequests,
        storage: result.storage,
      });
      return next();
    } catch (error) {
      logError('rateLimit', 'middleware.error', {
        requestId: req.requestId,
        scope,
        error,
      });
      return res.status(500).json({
        message: 'Rate limit check failed.',
      });
    }
  };
}
