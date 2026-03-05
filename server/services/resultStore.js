import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from '@google-cloud/storage';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localResultDir = path.resolve(__dirname, '..', 'data', 'results');
const bucketName = process.env.GCS_BUCKET_NAME || '';
const useCloudStorage = Boolean(bucketName) && !process.env.DISABLE_GCS;

let storage = null;

function getStorage() {
  if (!useCloudStorage) {
    return null;
  }

  if (!storage) {
    try {
      storage = new Storage();
      logInfo('resultStore', 'gcs.client_created', { bucketName });
    } catch (_error) {
      logError('resultStore', 'gcs.client_create_failed', { error: _error });
      storage = null;
    }
  }

  return storage;
}

function datePartsFromIso(isoString) {
  const date = new Date(isoString);
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, '0'),
    day: String(date.getUTCDate()).padStart(2, '0'),
  };
}

function buildObjectPath({ scheduleId, runId, startedAt, outputPrefix, extension }) {
  const dateParts = datePartsFromIso(startedAt);
  return `${outputPrefix}/${scheduleId}/${dateParts.year}/${dateParts.month}/${dateParts.day}/${runId}.${extension}`;
}

async function ensureLocalResultDir(objectPath) {
  const fullPath = path.join(localResultDir, objectPath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  return fullPath;
}

export async function saveAudio({ scheduleId, runId, startedAt, outputPrefix, wavBuffer }) {
  const objectPath = buildObjectPath({
    scheduleId,
    runId,
    startedAt,
    outputPrefix,
    extension: 'wav',
  });
  const cloudStorage = getStorage();

  if (cloudStorage) {
    const bucket = cloudStorage.bucket(bucketName);
    const file = bucket.file(objectPath);
    await file.save(wavBuffer, {
      contentType: 'audio/wav',
      resumable: false,
    });
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000,
    });
    logInfo('resultStore', 'saveAudio.gcs', { scheduleId, runId, objectPath, bytes: wavBuffer.length });
    return { audioPath: objectPath, audioDownloadUrl: signedUrl };
  }

  const filePath = await ensureLocalResultDir(objectPath);
  await fs.writeFile(filePath, wavBuffer);
  logWarn('resultStore', 'saveAudio.local_fallback', { scheduleId, runId, objectPath, bytes: wavBuffer.length });
  return {
    audioPath: objectPath,
    audioDownloadUrl: `/api/artifacts/${encodeURIComponent(objectPath)}`,
  };
}

export async function saveTextArtifact({ scheduleId, runId, startedAt, outputPrefix, payload }) {
  const objectPath = buildObjectPath({
    scheduleId,
    runId,
    startedAt,
    outputPrefix,
    extension: 'json',
  });
  const body = JSON.stringify(payload, null, 2);
  const cloudStorage = getStorage();

  if (cloudStorage) {
    const bucket = cloudStorage.bucket(bucketName);
    const file = bucket.file(objectPath);
    await file.save(body, {
      contentType: 'application/json',
      resumable: false,
    });
    logInfo('resultStore', 'saveText.gcs', { scheduleId, runId, objectPath, bytes: Buffer.byteLength(body) });
    return { textPath: objectPath };
  }

  const filePath = await ensureLocalResultDir(objectPath);
  await fs.writeFile(filePath, body, 'utf8');
  logWarn('resultStore', 'saveText.local_fallback', { scheduleId, runId, objectPath, bytes: Buffer.byteLength(body) });
  return { textPath: objectPath };
}

export async function readArtifact(objectPath) {
  const safePath = String(objectPath || '').replace(/^\.+/, '');
  const cloudStorage = getStorage();

  if (cloudStorage) {
    const bucket = cloudStorage.bucket(bucketName);
    const [buffer] = await bucket.file(safePath).download();
    logInfo('resultStore', 'readArtifact.gcs', { objectPath, bytes: buffer.length });
    return buffer;
  }

  const buffer = await fs.readFile(path.join(localResultDir, safePath));
  logWarn('resultStore', 'readArtifact.local_fallback', { objectPath: safePath, bytes: buffer.length });
  return buffer;
}
