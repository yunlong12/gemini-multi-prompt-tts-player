import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { DEFAULT_TTS_MODEL } from './gemini.js';
import { computeNextRunAt, getDefaultTimezone } from '../utils/time.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const localDbPath = path.join(dataDir, 'runtime-db.json');

const schedulesCollection = process.env.FIRESTORE_COLLECTION_SCHEDULES || 'schedules';
const runsCollection = process.env.FIRESTORE_COLLECTION_RUNS || 'schedule_runs';
// In Cloud Run, GOOGLE_CLOUD_PROJECT may be absent in some revisions.
// Prefer Firestore by default and fall back to local JSON only when client init/use fails
// or when explicitly disabled for local debugging.
const useFirestore = !process.env.DISABLE_FIRESTORE;

let firestore = null;

export function getFirestore() {
  if (!useFirestore) {
    logWarn('scheduleStore', 'firestore.disabled_by_env');
    return null;
  }

  if (!firestore) {
    try {
      firestore = new Firestore({ ignoreUndefinedProperties: true });
      logInfo('scheduleStore', 'firestore.client_created', {
        schedulesCollection,
        runsCollection,
      });
    } catch (_error) {
      logError('scheduleStore', 'firestore.client_create_failed', { error: _error });
      firestore = null;
    }
  }

  return firestore;
}

async function ensureLocalDb() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(localDbPath);
  } catch {
    await fs.writeFile(localDbPath, JSON.stringify({ schedules: [], runs: [] }, null, 2), 'utf8');
  }
}

async function readLocalDb() {
  await ensureLocalDb();
  const raw = await fs.readFile(localDbPath, 'utf8');
  return JSON.parse(raw);
}

async function writeLocalDb(payload) {
  await ensureLocalDb();
  await fs.writeFile(localDbPath, JSON.stringify(payload, null, 2), 'utf8');
}

function sanitizeScheduleInput(input, existing = null) {
  const now = new Date();
  const base = existing || {};
  const frequency = input.frequency || base.frequency || 'daily';
  const timezone = input.timezone || base.timezone || getDefaultTimezone();
  const timeOfDay = input.timeOfDay || base.timeOfDay || '08:00';
  const ttsModel = input.ttsModel || base.ttsModel || DEFAULT_TTS_MODEL;
  const enabled = input.enabled ?? base.enabled ?? true;
  const outputPrefix = String(input.outputPrefix || base.outputPrefix || 'daily-briefings').trim() || 'daily-briefings';

  if (!String(input.name || base.name || '').trim()) {
    throw new Error('Schedule name is required.');
  }

  if (!String(input.promptTemplate || base.promptTemplate || '').trim()) {
    throw new Error('Prompt template is required.');
  }

  if (!['daily', 'weekly', 'custom_interval'].includes(frequency)) {
    throw new Error('Unsupported frequency.');
  }

  const schedule = {
    ...base,
    name: String(input.name ?? base.name).trim(),
    promptTemplate: String(input.promptTemplate ?? base.promptTemplate).trim(),
    enabled: Boolean(enabled),
    timezone,
    frequency,
    timeOfDay,
    daysOfWeek: Array.isArray(input.daysOfWeek)
      ? input.daysOfWeek.map((day) => Number(day)).filter((day) => day >= 0 && day <= 6)
      : (Array.isArray(base.daysOfWeek) ? base.daysOfWeek : []),
    intervalMinutes:
      input.intervalMinutes != null
        ? Math.max(1, Number(input.intervalMinutes))
        : (base.intervalMinutes != null ? Math.max(1, Number(base.intervalMinutes)) : undefined),
    ttsModel,
    outputPrefix,
    updatedAt: now.toISOString(),
  };

  if (schedule.frequency === 'weekly' && schedule.daysOfWeek.length === 0) {
    throw new Error('Weekly schedules require at least one day of week.');
  }

  if (schedule.frequency === 'custom_interval' && !schedule.intervalMinutes) {
    throw new Error('Custom interval schedules require intervalMinutes.');
  }

  return schedule;
}

function withDerivedSchedule(schedule, existing = null) {
  const nowIso = new Date().toISOString();
  const nextRunAt = schedule.nextRunAt || computeNextRunAt({ ...existing, ...schedule }, new Date());

  return {
    id: schedule.id || existing?.id || crypto.randomUUID(),
    createdAt: schedule.createdAt || existing?.createdAt || nowIso,
    lastRunAt: schedule.lastRunAt || existing?.lastRunAt,
    nextRunAt,
    lastStatus: schedule.lastStatus || existing?.lastStatus || 'idle',
    lastError: schedule.lastError || existing?.lastError || '',
    lockUntil: schedule.lockUntil || existing?.lockUntil || null,
    ...schedule,
  };
}

export async function listSchedules() {
  const db = getFirestore();
  if (db) {
    const snapshot = await db.collection(schedulesCollection).orderBy('updatedAt', 'desc').get();
    logInfo('scheduleStore', 'listSchedules.firestore', { count: snapshot.size });
    return snapshot.docs.map((doc) => doc.data());
  }

  const payload = await readLocalDb();
  logWarn('scheduleStore', 'listSchedules.local_fallback', { count: payload.schedules.length });
  return payload.schedules.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function getSchedule(id) {
  const db = getFirestore();
  if (db) {
    const doc = await db.collection(schedulesCollection).doc(id).get();
    logInfo('scheduleStore', 'getSchedule.firestore', { id, exists: doc.exists });
    return doc.exists ? doc.data() : null;
  }

  const payload = await readLocalDb();
  logWarn('scheduleStore', 'getSchedule.local_fallback', { id });
  return payload.schedules.find((schedule) => schedule.id === id) || null;
}

export async function createSchedule(input) {
  const schedule = withDerivedSchedule(sanitizeScheduleInput(input));
  const db = getFirestore();

  if (db) {
    await db.collection(schedulesCollection).doc(schedule.id).set(schedule);
    logInfo('scheduleStore', 'createSchedule.firestore', {
      id: schedule.id,
      name: schedule.name,
      nextRunAt: schedule.nextRunAt,
    });
    return schedule;
  }

  const payload = await readLocalDb();
  payload.schedules.push(schedule);
  await writeLocalDb(payload);
  logWarn('scheduleStore', 'createSchedule.local_fallback', { id: schedule.id, name: schedule.name });
  return schedule;
}

export async function updateSchedule(id, patch) {
  const existing = await getSchedule(id);
  if (!existing) {
    return null;
  }

  const merged = withDerivedSchedule(
    {
      ...sanitizeScheduleInput(patch, existing),
      id,
      createdAt: existing.createdAt,
      lastRunAt: existing.lastRunAt,
      nextRunAt: patch.recomputeNextRunAt === false ? existing.nextRunAt : computeNextRunAt({ ...existing, ...patch }, new Date()),
      lastStatus: existing.lastStatus,
      lastError: existing.lastError,
      lockUntil: existing.lockUntil,
    },
    existing
  );
  const db = getFirestore();

  if (db) {
    await db.collection(schedulesCollection).doc(id).set(merged);
    logInfo('scheduleStore', 'updateSchedule.firestore', { id, nextRunAt: merged.nextRunAt });
    return merged;
  }

  const payload = await readLocalDb();
  payload.schedules = payload.schedules.map((schedule) => (schedule.id === id ? merged : schedule));
  await writeLocalDb(payload);
  logWarn('scheduleStore', 'updateSchedule.local_fallback', { id, nextRunAt: merged.nextRunAt });
  return merged;
}

export async function deleteSchedule(id) {
  const db = getFirestore();
  if (db) {
    await db.collection(schedulesCollection).doc(id).delete();
    logInfo('scheduleStore', 'deleteSchedule.firestore', { id });
    return true;
  }

  const payload = await readLocalDb();
  const originalCount = payload.schedules.length;
  payload.schedules = payload.schedules.filter((schedule) => schedule.id !== id);
  await writeLocalDb(payload);
  logWarn('scheduleStore', 'deleteSchedule.local_fallback', { id });
  return payload.schedules.length !== originalCount;
}

export async function findDueSchedules(now = new Date()) {
  const nowIso = now.toISOString();
  const db = getFirestore();

  if (db) {
    const snapshot = await db
      .collection(schedulesCollection)
      .where('enabled', '==', true)
      .where('nextRunAt', '<=', nowIso)
      .orderBy('nextRunAt', 'asc')
      .get();
    const due = snapshot.docs
      .map((doc) => doc.data())
      .filter((schedule) => !schedule.lockUntil || schedule.lockUntil <= nowIso);
    logInfo('scheduleStore', 'findDueSchedules.firestore', { nowIso, queried: snapshot.size, due: due.length });
    return due;
  }

  const payload = await readLocalDb();
  const due = payload.schedules
    .filter((schedule) => schedule.enabled && schedule.nextRunAt <= nowIso && (!schedule.lockUntil || schedule.lockUntil <= nowIso))
    .sort((a, b) => String(a.nextRunAt).localeCompare(String(b.nextRunAt)));
  logWarn('scheduleStore', 'findDueSchedules.local_fallback', { nowIso, due: due.length });
  return due;
}

export async function tryLockSchedule(id, lockUntil, runStartedAt) {
  const db = getFirestore();

  if (db) {
    const docRef = db.collection(schedulesCollection).doc(id);
    const result = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(docRef);
      if (!snapshot.exists) {
        return null;
      }

      const schedule = snapshot.data();
      if (schedule.lockUntil && schedule.lockUntil > runStartedAt) {
        return null;
      }

      const updated = {
        ...schedule,
        lockUntil,
        lastStatus: 'running',
        lastError: '',
        updatedAt: runStartedAt,
      };
      transaction.set(docRef, updated);
      return updated;
    });

    logInfo('scheduleStore', 'tryLockSchedule.firestore', { id, locked: Boolean(result), lockUntil, runStartedAt });
    return result;
  }

  const payload = await readLocalDb();
  let locked = null;
  payload.schedules = payload.schedules.map((schedule) => {
    if (schedule.id !== id) {
      return schedule;
    }

    if (schedule.lockUntil && schedule.lockUntil > runStartedAt) {
      return schedule;
    }

    locked = {
      ...schedule,
      lockUntil,
      lastStatus: 'running',
      lastError: '',
      updatedAt: runStartedAt,
    };
    return locked;
  });
  await writeLocalDb(payload);
  logWarn('scheduleStore', 'tryLockSchedule.local_fallback', { id, locked: Boolean(locked), lockUntil, runStartedAt });
  return locked;
}

export async function updateNextRun(id, nextRunAt, lastRunAt, patch = {}) {
  const existing = await getSchedule(id);
  if (!existing) {
    return null;
  }

  const updated = {
    ...existing,
    ...patch,
    lastRunAt,
    nextRunAt,
    updatedAt: new Date().toISOString(),
    lockUntil: null,
  };
  const db = getFirestore();

  if (db) {
    await db.collection(schedulesCollection).doc(id).set(updated);
    logInfo('scheduleStore', 'updateNextRun.firestore', { id, nextRunAt, lastRunAt, patch });
    return updated;
  }

  const payload = await readLocalDb();
  payload.schedules = payload.schedules.map((schedule) => (schedule.id === id ? updated : schedule));
  await writeLocalDb(payload);
  logWarn('scheduleStore', 'updateNextRun.local_fallback', { id, nextRunAt, lastRunAt, patch });
  return updated;
}

export async function recordRun(runRecord) {
  const payload = {
    id: runRecord.id || crypto.randomUUID(),
    ...runRecord,
  };
  const db = getFirestore();

  if (db) {
    await db.collection(runsCollection).doc(payload.id).set(payload);
    logInfo('scheduleStore', 'recordRun.firestore', {
      id: payload.id,
      scheduleId: payload.scheduleId,
      status: payload.status,
      triggeredBy: payload.triggeredBy,
    });
    return payload;
  }

  const dbPayload = await readLocalDb();
  dbPayload.runs.push(payload);
  await writeLocalDb(dbPayload);
  logWarn('scheduleStore', 'recordRun.local_fallback', {
    id: payload.id,
    scheduleId: payload.scheduleId,
    status: payload.status,
    triggeredBy: payload.triggeredBy,
  });
  return payload;
}

export async function listRuns(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const db = getFirestore();

  if (db) {
    const snapshot = await db.collection(runsCollection).orderBy('startedAt', 'desc').limit(safeLimit).get();
    logInfo('scheduleStore', 'listRuns.firestore', { count: snapshot.size, limit: safeLimit });
    return snapshot.docs.map((doc) => doc.data());
  }

  const payload = await readLocalDb();
  logWarn('scheduleStore', 'listRuns.local_fallback', { count: payload.runs.length, limit: safeLimit });
  return payload.runs
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, safeLimit);
}

export async function listRunsForSchedule(scheduleId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const db = getFirestore();

  if (db) {
    const snapshot = await db
      .collection(runsCollection)
      .where('scheduleId', '==', scheduleId)
      .orderBy('startedAt', 'desc')
      .limit(safeLimit)
      .get();
    logInfo('scheduleStore', 'listRunsForSchedule.firestore', { scheduleId, count: snapshot.size, limit: safeLimit });
    return snapshot.docs.map((doc) => doc.data());
  }

  const payload = await readLocalDb();
  logWarn('scheduleStore', 'listRunsForSchedule.local_fallback', { scheduleId, limit: safeLimit });
  return payload.runs
    .filter((run) => run.scheduleId === scheduleId)
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
    .slice(0, safeLimit);
}

export async function getRun(id) {
  const db = getFirestore();
  if (db) {
    const doc = await db.collection(runsCollection).doc(id).get();
    logInfo('scheduleStore', 'getRun.firestore', { id, exists: doc.exists });
    return doc.exists ? doc.data() : null;
  }

  const payload = await readLocalDb();
  logWarn('scheduleStore', 'getRun.local_fallback', { id });
  return payload.runs.find((run) => run.id === id) || null;
}
