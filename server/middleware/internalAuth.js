import { logInfo, logWarn } from '../utils/logger.js';

export function requireInternalAuth(req, res, next) {
  const expectedSecret = process.env.SCHEDULER_SHARED_SECRET;
  if (!expectedSecret) {
    logWarn('internalAuth', 'missing_secret_env', { requestId: req.requestId });
    return res.status(500).json({ message: 'Missing SCHEDULER_SHARED_SECRET in environment.' });
  }

  const providedSecret = req.headers['x-internal-key'];
  if (providedSecret !== expectedSecret) {
    logWarn('internalAuth', 'unauthorized', {
      requestId: req.requestId,
      hasProvidedSecret: Boolean(providedSecret),
    });
    return res.status(401).json({ message: 'Unauthorized' });
  }

  logInfo('internalAuth', 'authorized', { requestId: req.requestId });
  return next();
}
