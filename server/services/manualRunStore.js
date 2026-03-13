import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { DEFAULT_TTS_MODEL } from './gemini.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, '..', 'data');
const localDbPath = path.join(dataDir, 'runtime-db.json');

const manualRunsCollection = process.env.FIRESTORE_COLLECTION_MANUAL_RUNS || 'manual_runs';
const useFirestore = !process.env.DISABLE_FIRESTORE;

let firestore = null;

function getFirestore() {
  if (!useFirestore) {
    logWarn('manualRunStore', 'firestore.disabled_by_env');
    return null;
  }

  if (!firestore) {
    try {
      firestore = new Firestore({ ignoreUndefinedProperties: true });
      logInfo('manualRunStore', 'firestore.client_created', { manualRunsCollection });
    } catch (error) {
      logError('manualRunStore', 'firestore.client_create_failed', { error });
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
    await fs.writeFile(localDbPath, JSON.stringify({ schedules: [], runs: [], manualRuns: [] }, null, 2), 'utf8');
  }
}

async function readLocalDb() {
  await ensureLocalDb();
  const raw = await fs.readFile(localDbPath, 'utf8');
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload.manualRuns)) {
    payload.manualRuns = [];
  }
  return payload;
}

async function writeLocalDb(payload) {
  await ensureLocalDb();
  const nextPayload = {
    schedules: Array.isArray(payload.schedules) ? payload.schedules : [],
    runs: Array.isArray(payload.runs) ? payload.runs : [],
    manualRuns: Array.isArray(payload.manualRuns) ? payload.manualRuns : [],
  };
  await fs.writeFile(localDbPath, JSON.stringify(nextPayload, null, 2), 'utf8');
}

function normalizeToolOptions(toolOptions = {}, existing = {}) {
  return {
    enableGoogleSearch: toolOptions.enableGoogleSearch ?? existing.enableGoogleSearch ?? true,
    enableUrlContext: toolOptions.enableUrlContext ?? existing.enableUrlContext ?? false,
  };
}

function normalizeManualRun(input, existing = null) {
  const now = new Date().toISOString();
  const toolOptions = normalizeToolOptions(input.toolOptions || input, existing?.toolOptions || {});

  return {
    id: input.id || existing?.id || crypto.randomUUID(),
    prompt: String(input.prompt ?? existing?.prompt ?? '').trim(),
    status: input.status || existing?.status || 'queued',
    generatedText: input.generatedText ?? existing?.generatedText ?? '',
    groundingLinks: Array.isArray(input.groundingLinks) ? input.groundingLinks : (existing?.groundingLinks || []),
    ttsModel: String(input.ttsModel || existing?.ttsModel || DEFAULT_TTS_MODEL).trim() || DEFAULT_TTS_MODEL,
    toolOptions,
    audioPath: input.audioPath ?? existing?.audioPath ?? '',
    audioDownloadUrl: input.audioDownloadUrl ?? existing?.audioDownloadUrl ?? '',
    textPath: input.textPath ?? existing?.textPath ?? '',
    errorMessage: input.errorMessage ?? existing?.errorMessage ?? '',
    createdAt: input.createdAt || existing?.createdAt || now,
    updatedAt: now,
    finishedAt: input.finishedAt ?? existing?.finishedAt,
  };
}

export async function createManualRuns(entries = []) {
  const db = getFirestore();
  const now = new Date().toISOString();
  const payloads = entries.map((entry) =>
    normalizeManualRun({
      prompt: entry.prompt,
      status: 'queued',
      ttsModel: entry.ttsModel,
      toolOptions: entry.toolOptions,
      createdAt: now,
      updatedAt: now,
    })
  );

  if (db) {
    const batch = db.batch();
    payloads.forEach((run) => {
      batch.set(db.collection(manualRunsCollection).doc(run.id), run);
    });
    await batch.commit();
    logInfo('manualRunStore', 'createMany.firestore', { count: payloads.length });
    return payloads;
  }

  const local = await readLocalDb();
  local.manualRuns.push(...payloads);
  await writeLocalDb(local);
  logWarn('manualRunStore', 'createMany.local_fallback', { count: payloads.length });
  return payloads;
}

export async function listManualRuns(limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
  const db = getFirestore();

  if (db) {
    const snapshot = await db.collection(manualRunsCollection).orderBy('createdAt', 'desc').limit(safeLimit).get();
    logInfo('manualRunStore', 'list.firestore', { count: snapshot.size, limit: safeLimit });
    return snapshot.docs.map((doc) => doc.data());
  }

  const local = await readLocalDb();
  logWarn('manualRunStore', 'list.local_fallback', { count: local.manualRuns.length, limit: safeLimit });
  return local.manualRuns
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, safeLimit);
}

export async function getManualRun(id) {
  const db = getFirestore();

  if (db) {
    const doc = await db.collection(manualRunsCollection).doc(id).get();
    logInfo('manualRunStore', 'get.firestore', { id, exists: doc.exists });
    return doc.exists ? doc.data() : null;
  }

  const local = await readLocalDb();
  logWarn('manualRunStore', 'get.local_fallback', { id });
  return local.manualRuns.find((run) => run.id === id) || null;
}

export async function updateManualRun(id, patch) {
  const existing = await getManualRun(id);
  if (!existing) {
    return null;
  }

  const next = normalizeManualRun({ ...existing, ...patch, id }, existing);
  const db = getFirestore();

  if (db) {
    await db.collection(manualRunsCollection).doc(id).set(next);
    logInfo('manualRunStore', 'update.firestore', { id, status: next.status });
    return next;
  }

  const local = await readLocalDb();
  local.manualRuns = local.manualRuns.map((run) => (run.id === id ? next : run));
  await writeLocalDb(local);
  logWarn('manualRunStore', 'update.local_fallback', { id, status: next.status });
  return next;
}

export async function deleteManualRun(id) {
  const db = getFirestore();
  if (db) {
    const ref = db.collection(manualRunsCollection).doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      logInfo('manualRunStore', 'delete.firestore.missing', { id });
      return false;
    }
    await ref.delete();
    logInfo('manualRunStore', 'delete.firestore', { id });
    return true;
  }

  const local = await readLocalDb();
  const originalCount = local.manualRuns.length;
  local.manualRuns = local.manualRuns.filter((run) => run.id !== id);
  await writeLocalDb(local);
  logWarn('manualRunStore', 'delete.local_fallback', { id, deleted: local.manualRuns.length !== originalCount });
  return local.manualRuns.length !== originalCount;
}
