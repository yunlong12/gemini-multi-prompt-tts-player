import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearSessionCookie, createSession, getSessionFromRequest, requireAuth, setSessionCookie } from './middleware/auth.js';
import { requireTrustedOrigin } from './middleware/csrf.js';
import { requireInternalAuth } from './middleware/internalAuth.js';
import { createRateLimit } from './middleware/rateLimit.js';
import { DEFAULT_TTS_MODEL, generateGroundedText, generateSpeechBase64 } from './services/gemini.js';
import {
  createSchedule,
  deleteRun,
  deleteSchedule,
  findDueSchedules,
  getRun,
  getSchedule,
  listRuns,
  listRunsForSchedule,
  listSchedules,
  updateSchedule,
} from './services/scheduleStore.js';
import { deleteArtifact, readArtifact } from './services/resultStore.js';
import { executeSchedule } from './services/scheduleRunner.js';
import { getSchedulerConfig, updateSchedulerConfig } from './services/schedulerControl.js';
import { deleteManualRun, getManualRun, listManualRuns } from './services/manualRunStore.js';
import { enqueueManualRuns, isManualRunQueued } from './services/manualRunRunner.js';
import { logError, logInfo, logWarn, requestLogger } from './utils/logger.js';

dotenv.config({ path: '.env.local' });

process.on('uncaughtException', (error) => {
  logError('process', 'uncaught_exception', { error });
});

process.on('unhandledRejection', (reason) => {
  logError('process', 'unhandled_rejection', { reason });
});

const PORT = Number(process.env.PORT || 8787);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.resolve(__dirname, '..', 'dist');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

const loginRateLimit = createRateLimit({
  scope: 'auth.login',
  windowMs: Number(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS || 24 * 60 * 60 * 1000),
  maxRequests: Number(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || 100),
  message: 'Daily login limit reached: 100 attempts per day.',
});

const textRateLimit = createRateLimit({
  scope: 'api.text',
  windowMs: Number(process.env.TEXT_RATE_LIMIT_WINDOW_MS || 24 * 60 * 60 * 1000),
  maxRequests: Number(process.env.TEXT_RATE_LIMIT_MAX || 200),
  message: 'Daily text generation limit reached: 200 requests per day.',
});

const ttsRateLimit = createRateLimit({
  scope: 'api.tts',
  windowMs: Number(process.env.TTS_RATE_LIMIT_WINDOW_MS || 24 * 60 * 60 * 1000),
  maxRequests: Number(process.env.TTS_RATE_LIMIT_MAX || 200),
  message: 'Daily TTS limit reached: 200 requests per day.',
});

function getInternalBaseUrl(req) {
  const explicitBaseUrl =
    String(process.env.APP_BASE_URL || process.env.CLOUD_RUN_SERVICE_URL || '').trim();

  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/, '');
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = req.get('host');
  return `${protocol}://${host}`;
}

async function dispatchScheduleExecution(req, schedule, options = {}) {
  const baseUrl = getInternalBaseUrl(req);
  const internalSecret = process.env.SCHEDULER_SHARED_SECRET;
  const requestId = options.requestId || req.requestId;
  const dispatchUrl = `${baseUrl}/api/internal/execute-schedule/${encodeURIComponent(schedule.id)}`;

  if (!internalSecret) {
    throw new Error('Missing SCHEDULER_SHARED_SECRET in environment.');
  }

  logInfo('scheduler', 'dispatch.start', {
    requestId,
    scheduleId: schedule.id,
    dispatchUrl,
  });

  void fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Key': internalSecret,
      'X-Request-Id': `${requestId}:${schedule.id}`,
    },
    body: JSON.stringify({
      triggeredBy: options.triggeredBy || 'scheduler',
      parentRequestId: requestId,
      dispatchedAt: new Date().toISOString(),
    }),
  })
    .then(async (response) => {
      const responseText = await response.text();
      if (!response.ok) {
        logWarn('scheduler', 'dispatch.response_not_ok', {
          requestId,
          scheduleId: schedule.id,
          statusCode: response.status,
          body: responseText.slice(0, 500),
        });
        return;
      }

      logInfo('scheduler', 'dispatch.accepted', {
        requestId,
        scheduleId: schedule.id,
        statusCode: response.status,
      });
    })
    .catch((error) => {
      logError('scheduler', 'dispatch.error', {
        requestId,
        scheduleId: schedule.id,
        error,
      });
    });
}

app.get('/api/health', (_req, res) => {
  logInfo('api.health', 'health.check');
  res.json({ ok: true });
});

app.post('/api/text', requireAuth, requireTrustedOrigin, textRateLimit, async (req, res) => {
  try {
    const prompt = String(req.body?.prompt || '').trim();
    const enableGoogleSearch = req.body?.enableGoogleSearch ?? true;
    const enableUrlContext = req.body?.enableUrlContext ?? false;
    logInfo('api.text', 'generate.start', {
      requestId: req.requestId,
      promptLength: prompt.length,
      enableGoogleSearch: Boolean(enableGoogleSearch),
      enableUrlContext: Boolean(enableUrlContext),
    });
    if (!prompt) {
      return res.status(400).json({ message: 'prompt is required' });
    }

    const result = await generateGroundedText(
      prompt,
      {
        enableGoogleSearch: Boolean(enableGoogleSearch),
        enableUrlContext: Boolean(enableUrlContext),
      },
      {
        retryOptions: { totalAttempts: 1 },
      }
    );
    logInfo('api.text', 'generate.success', {
      requestId: req.requestId,
      textLength: result?.text?.length || 0,
      links: Array.isArray(result?.groundingLinks) ? result.groundingLinks.length : 0,
    });
    return res.json(result);
  } catch (error) {
    const message = error?.message || 'Failed to generate text';
    logError('api.text', 'generate.error', { requestId: req.requestId, error });
    return res.status(500).json({ message });
  }
});

app.post('/api/tts', requireAuth, requireTrustedOrigin, ttsRateLimit, async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const model = String(req.body?.model || DEFAULT_TTS_MODEL).trim() || DEFAULT_TTS_MODEL;
    logInfo('api.tts', 'generate.start', {
      requestId: req.requestId,
      textLength: text.length,
      model,
    });
    if (!text) {
      return res.status(400).json({ message: 'text is required' });
    }

    const audioBase64 = await generateSpeechBase64(text, model, {
      retryOptions: { totalAttempts: 1 },
    });
    logInfo('api.tts', 'generate.success', {
      requestId: req.requestId,
      audioBase64Length: audioBase64?.length || 0,
    });
    return res.json({ audioBase64 });
  } catch (error) {
    const message = error?.message || 'Failed to generate speech';
    logError('api.tts', 'generate.error', { requestId: req.requestId, error });
    return res.status(500).json({ message });
  }
});

app.post('/api/manual-runs', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const prompts = Array.isArray(req.body?.prompts)
      ? req.body.prompts.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const ttsModel = String(req.body?.ttsModel || DEFAULT_TTS_MODEL).trim() || DEFAULT_TTS_MODEL;
    const toolOptions = {
      enableGoogleSearch: req.body?.enableGoogleSearch ?? true,
      enableUrlContext: req.body?.enableUrlContext ?? false,
    };

    if (!prompts.length) {
      return res.status(400).json({ message: 'prompts are required' });
    }

    logInfo('api.manualRuns', 'create.start', {
      requestId: req.requestId,
      count: prompts.length,
      ttsModel,
      ...toolOptions,
    });

    const runs = await enqueueManualRuns(
      prompts.map((prompt) => ({
        prompt,
        ttsModel,
        toolOptions,
      }))
    );

    logInfo('api.manualRuns', 'create.success', {
      requestId: req.requestId,
      count: runs.length,
      runIds: runs.map((run) => run.id),
    });
    return res.status(201).json({ runs });
  } catch (error) {
    logError('api.manualRuns', 'create.error', { requestId: req.requestId, error });
    return res.status(500).json({ message: error?.message || 'Failed to create manual runs' });
  }
});

app.get('/api/manual-runs', requireAuth, async (req, res) => {
  try {
    const runs = await listManualRuns(req.query.limit);
    logInfo('api.manualRuns', 'list.success', { requestId: req.requestId, count: runs.length, limit: req.query.limit || 50 });
    return res.json({ runs });
  } catch (error) {
    logError('api.manualRuns', 'list.error', { requestId: req.requestId, error });
    return res.status(500).json({ message: error?.message || 'Failed to list manual runs' });
  }
});

app.get('/api/manual-runs/:id', requireAuth, async (req, res) => {
  try {
    const run = await getManualRun(req.params.id);
    if (!run) {
      return res.status(404).json({ message: 'Manual run not found' });
    }

    logInfo('api.manualRuns', 'get.success', {
      requestId: req.requestId,
      runId: run.id,
      status: run.status,
      queued: await isManualRunQueued(run.id),
    });
    return res.json({ run });
  } catch (error) {
    logError('api.manualRuns', 'get.error', { requestId: req.requestId, runId: req.params.id, error });
    return res.status(500).json({ message: error?.message || 'Failed to get manual run' });
  }
});

app.delete('/api/manual-runs/:id', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const run = await getManualRun(req.params.id);
    if (!run) {
      return res.status(404).json({ message: 'Manual run not found' });
    }

    const artifactErrors = [];
    for (const artifactPath of [run.audioPath, run.textPath].filter(Boolean)) {
      try {
        await deleteArtifact(artifactPath);
      } catch (error) {
        artifactErrors.push({
          artifactPath,
          message: error?.message || 'Failed to delete artifact',
        });
      }
    }

    const deleted = await deleteManualRun(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Manual run not found' });
    }

    if (artifactErrors.length > 0) {
      logWarn('api.manualRuns', 'delete.partial_artifact_failure', {
        requestId: req.requestId,
        runId: req.params.id,
        artifactErrors,
      });
    }

    logInfo('api.manualRuns', 'delete.success', {
      requestId: req.requestId,
      runId: req.params.id,
      artifactErrors,
    });
    return res.status(204).send();
  } catch (error) {
    logError('api.manualRuns', 'delete.error', { requestId: req.requestId, runId: req.params.id, error });
    return res.status(500).json({ message: error?.message || 'Failed to delete manual run' });
  }
});

app.post('/api/auth/login', requireTrustedOrigin, loginRateLimit, (req, res) => {
  try {
    const password = String(req.body?.password || '');
    logInfo('api.auth', 'login.attempt', { requestId: req.requestId, passwordLength: password.length });
    const session = createSession(password);
    if (!session) {
      logWarn('api.auth', 'login.invalid', { requestId: req.requestId });
      return res.status(401).json({ message: 'Invalid password' });
    }

    setSessionCookie(res, session.cookieValue);
    logInfo('api.auth', 'login.success', { requestId: req.requestId, expiresAt: session.expiresAt });
    return res.json({ expiresAt: session.expiresAt });
  } catch (error) {
    const message = error?.message || 'Failed to create session';
    logError('api.auth', 'login.error', { requestId: req.requestId, error });
    return res.status(500).json({ message });
  }
});

app.get('/api/auth/session', (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      logWarn('api.auth', 'session.missing', { requestId: req.requestId });
      return res.status(401).json({ message: 'Unauthorized' });
    }

    logInfo('api.auth', 'session.valid', {
      requestId: req.requestId,
      expiresAt: session.expiresAt,
    });
    return res.json({ expiresAt: session.expiresAt });
  } catch (error) {
    logError('api.auth', 'session.error', { requestId: req.requestId, error });
    return res.status(500).json({ message: error?.message || 'Failed to get session' });
  }
});

app.post('/api/auth/logout', requireTrustedOrigin, (req, res) => {
  clearSessionCookie(res);
  logInfo('api.auth', 'logout.success', { requestId: req.requestId });
  return res.status(204).send();
});

app.get('/api/schedules', requireAuth, async (_req, res) => {
  try {
    const schedules = await listSchedules();
    logInfo('api.schedules', 'list.success', { requestId: _req.requestId, count: schedules.length });
    return res.json({ schedules });
  } catch (error) {
    logError('api.schedules', 'list.error', { requestId: _req.requestId, error });
    return res.status(500).json({ message: error?.message || 'Failed to list schedules' });
  }
});

app.post('/api/schedules', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const schedule = await createSchedule(req.body || {});
    logInfo('api.schedules', 'create.success', {
      requestId: req.requestId,
      scheduleId: schedule.id,
      name: schedule.name,
      nextRunAt: schedule.nextRunAt,
    });
    return res.status(201).json({ schedule });
  } catch (error) {
    logError('api.schedules', 'create.error', { requestId: req.requestId, error });
    return res.status(400).json({ message: error?.message || 'Failed to create schedule' });
  }
});

app.put('/api/schedules/:id', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const schedule = await updateSchedule(req.params.id, req.body || {});
    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    logInfo('api.schedules', 'update.success', {
      requestId: req.requestId,
      scheduleId: schedule.id,
      nextRunAt: schedule.nextRunAt,
    });
    return res.json({ schedule });
  } catch (error) {
    logError('api.schedules', 'update.error', { requestId: req.requestId, scheduleId: req.params.id, error });
    return res.status(400).json({ message: error?.message || 'Failed to update schedule' });
  }
});

app.delete('/api/schedules/:id', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const deleted = await deleteSchedule(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    logInfo('api.schedules', 'delete.success', { requestId: req.requestId, scheduleId: req.params.id });
    return res.status(204).send();
  } catch (error) {
    logError('api.schedules', 'delete.error', { requestId: req.requestId, scheduleId: req.params.id, error });
    return res.status(500).json({ message: error?.message || 'Failed to delete schedule' });
  }
});

app.post('/api/schedules/:id/run-now', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const schedule = await getSchedule(req.params.id);
    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    const run = await executeSchedule(schedule, { triggeredBy: 'manual' });
    logInfo('api.schedules', 'run_now.success', {
      requestId: req.requestId,
      scheduleId: schedule.id,
      runId: run?.id,
      status: run?.status,
    });
    return res.json({ run });
  } catch (error) {
    logError('api.schedules', 'run_now.error', { requestId: req.requestId, scheduleId: req.params.id, error });
    return res.status(500).json({ message: error?.message || 'Failed to execute schedule' });
  }
});

app.get('/api/runs', requireAuth, async (req, res) => {
  try {
    const runs = await listRuns(req.query.limit);
    logInfo('api.runs', 'list.success', { requestId: req.requestId, count: runs.length, limit: req.query.limit || 50 });
    return res.json({ runs });
  } catch (error) {
    logError('api.runs', 'list.error', { requestId: req.requestId, error });
    return res.status(500).json({ message: error?.message || 'Failed to list runs' });
  }
});

app.get('/api/schedules/:id/runs', requireAuth, async (req, res) => {
  try {
    const runs = await listRunsForSchedule(req.params.id, req.query.limit);
    logInfo('api.runs', 'list_for_schedule.success', { requestId: req.requestId, scheduleId: req.params.id, count: runs.length });
    return res.json({ runs });
  } catch (error) {
    logError('api.runs', 'list_for_schedule.error', { requestId: req.requestId, scheduleId: req.params.id, error });
    return res.status(500).json({ message: error?.message || 'Failed to list runs' });
  }
});

app.get('/api/runs/:id', requireAuth, async (req, res) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) {
      return res.status(404).json({ message: 'Run not found' });
    }

    logInfo('api.runs', 'get.success', { requestId: req.requestId, runId: req.params.id, status: run.status });
    return res.json({ run });
  } catch (error) {
    logError('api.runs', 'get.error', { requestId: req.requestId, runId: req.params.id, error });
    return res.status(500).json({ message: error?.message || 'Failed to get run' });
  }
});

app.delete('/api/runs/:id', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const run = await getRun(req.params.id);
    if (!run) {
      return res.status(404).json({ message: 'Run not found' });
    }

    const artifactErrors = [];

    for (const artifactPath of [run.audioPath, run.textPath].filter(Boolean)) {
      try {
        await deleteArtifact(artifactPath);
      } catch (error) {
        artifactErrors.push({
          artifactPath,
          message: error?.message || 'Failed to delete artifact',
        });
      }
    }

    const deleted = await deleteRun(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Run not found' });
    }

    if (artifactErrors.length > 0) {
      logWarn('api.runs', 'delete.partial_artifact_failure', {
        requestId: req.requestId,
        runId: req.params.id,
        artifactErrors,
      });
    }

    logInfo('api.runs', 'delete.success', {
      requestId: req.requestId,
      runId: req.params.id,
      audioPath: run.audioPath || null,
      textPath: run.textPath || null,
      artifactErrors,
    });
    return res.status(204).send();
  } catch (error) {
    logError('api.runs', 'delete.error', { requestId: req.requestId, runId: req.params.id, error });
    return res.status(500).json({ message: error?.message || 'Failed to delete run' });
  }
});

app.get('/api/scheduler/config', requireAuth, async (_req, res) => {
  try {
    const config = await getSchedulerConfig();
    logInfo('api.scheduler', 'config.get.success', { requestId: _req.requestId, schedule: config.schedule, timeZone: config.timeZone });
    return res.json({ config });
  } catch (error) {
    logError('api.scheduler', 'config.get.error', { requestId: _req.requestId, error });
    return res.status(500).json({ message: error?.message || 'Failed to get scheduler config' });
  }
});

app.put('/api/scheduler/config', requireAuth, requireTrustedOrigin, async (req, res) => {
  try {
    const config = await updateSchedulerConfig(req.body || {});
    logInfo('api.scheduler', 'config.update.success', {
      requestId: req.requestId,
      schedule: config.schedule,
      timeZone: config.timeZone,
    });
    return res.json({ config });
  } catch (error) {
    logError('api.scheduler', 'config.update.error', { requestId: req.requestId, error, payload: req.body || {} });
    return res.status(400).json({ message: error?.message || 'Failed to update scheduler config' });
  }
});

app.get(/^\/api\/artifacts\/(.+)$/, requireAuth, async (req, res) => {
  try {
    const artifactPath = decodeURIComponent(req.params[0] || '');
    logInfo('api.artifacts', 'read.start', { requestId: req.requestId, artifactPath });
    const buffer = await readArtifact(artifactPath);
    if (artifactPath.endsWith('.wav')) {
      res.setHeader('Content-Type', 'audio/wav');
    } else if (artifactPath.endsWith('.json')) {
      res.setHeader('Content-Type', 'application/json');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    logInfo('api.artifacts', 'read.success', { requestId: req.requestId, artifactPath, bytes: buffer.length });
    return res.send(buffer);
  } catch (error) {
    logError('api.artifacts', 'read.error', { requestId: req.requestId, artifactPath: req.params[0], error });
    return res.status(404).json({ message: error?.message || 'Artifact not found' });
  }
});

app.post('/api/internal/run-due-schedules', requireInternalAuth, async (_req, res) => {
  try {
    const dueSchedules = await findDueSchedules(new Date());
    const results = [];
    logInfo('scheduler', 'due_check.start', { requestId: _req.requestId, dueCount: dueSchedules.length });

    for (const schedule of dueSchedules) {
      try {
        await dispatchScheduleExecution(_req, schedule, {
          requestId: _req.requestId,
          triggeredBy: 'scheduler',
        });
        results.push({ scheduleId: schedule.id, status: 'dispatched' });
      } catch (error) {
        logError('scheduler', 'dispatch.failed', { requestId: _req.requestId, scheduleId: schedule.id, error });
        results.push({
          scheduleId: schedule.id,
          status: 'dispatch_error',
          message: error?.message || 'Failed to dispatch schedule',
        });
      }
    }

    logInfo('scheduler', 'due_check.finish', { requestId: _req.requestId, dueCount: dueSchedules.length, results });
    return res.json({
      checkedAt: new Date().toISOString(),
      dueCount: dueSchedules.length,
      results,
    });
  } catch (error) {
    logError('scheduler', 'due_check.error', { requestId: _req.requestId, error });
    return res.status(500).json({ message: error?.message || 'Failed to run due schedules' });
  }
});

app.post('/api/internal/execute-schedule/:id', requireInternalAuth, async (req, res) => {
  try {
    const schedule = await getSchedule(req.params.id);
    if (!schedule) {
      logWarn('scheduler', 'execute_single.not_found', {
        requestId: req.requestId,
        scheduleId: req.params.id,
      });
      return res.status(404).json({ message: 'Schedule not found' });
    }

    logInfo('scheduler', 'execute_single.start', {
      requestId: req.requestId,
      scheduleId: schedule.id,
      triggeredBy: req.body?.triggeredBy || 'scheduler',
      parentRequestId: req.body?.parentRequestId || null,
    });

    const run = await executeSchedule(schedule, {
      triggeredBy: req.body?.triggeredBy || 'scheduler',
    });

    if (!run) {
      logWarn('scheduler', 'execute_single.skipped', {
        requestId: req.requestId,
        scheduleId: schedule.id,
      });
      return res.status(202).json({
        scheduleId: schedule.id,
        status: 'skipped',
      });
    }

    logInfo('scheduler', 'execute_single.success', {
      requestId: req.requestId,
      scheduleId: schedule.id,
      runId: run.id,
      status: run.status,
    });

    return res.status(202).json({
      scheduleId: schedule.id,
      runId: run.id,
      status: run.status,
    });
  } catch (error) {
    logError('scheduler', 'execute_single.error', {
      requestId: req.requestId,
      scheduleId: req.params.id,
      error,
    });
    return res.status(500).json({ message: error?.message || 'Failed to execute schedule' });
  }
});

app.use(
  express.static(distPath, {
    setHeaders: (res, filePath) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.endsWith('/index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return;
      }

      if (normalizedPath.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }

      res.setHeader('Cache-Control', 'public, max-age=3600');
    },
  })
);
app.get(/^(?!\/api)(?!.*\.[a-zA-Z0-9]+$).*/, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  logInfo('server', 'startup', {
    port: PORT,
    defaultTz: process.env.APP_DEFAULT_TIMEZONE || 'Europe/Paris',
    firestoreCollectionSchedules: process.env.FIRESTORE_COLLECTION_SCHEDULES || 'schedules',
    firestoreCollectionRuns: process.env.FIRESTORE_COLLECTION_RUNS || 'schedule_runs',
    schedulerLocation: process.env.CLOUD_SCHEDULER_LOCATION || process.env.REGION || 'us-central1',
    schedulerJobName: process.env.CLOUD_SCHEDULER_JOB_NAME || 'schedule-runner',
  });
});
