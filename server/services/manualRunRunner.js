import { saveAudio, saveTextArtifact } from './resultStore.js';
import { createManualRuns, getManualRun, updateManualRun } from './manualRunStore.js';
import { generateRunArtifacts } from './contentGeneration.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const DEFAULT_OUTPUT_PREFIX = 'manual-runs';
const queuedRunIds = [];
const queuedRunIdSet = new Set();
let workerActive = false;

async function appendProgressLog(runId, message) {
  const run = await getManualRun(runId);
  if (!run) {
    return null;
  }

  const progressLogs = Array.isArray(run.progressLogs) ? run.progressLogs : [];
  return updateManualRun(runId, {
    progressLogs: [
      ...progressLogs,
      {
        ts: new Date().toISOString(),
        message,
      },
    ],
  });
}

async function processRun(runId) {
  const run = await getManualRun(runId);
  if (!run) {
    logWarn('manualRunRunner', 'run.missing', { runId });
    return null;
  }

  if (run.status === 'success' || run.status === 'error') {
    logInfo('manualRunRunner', 'run.skip_terminal', { runId, status: run.status });
    return run;
  }

  logInfo('manualRunRunner', 'run.start', { runId, promptLength: run.prompt.length, model: run.ttsModel });

  try {
    await updateManualRun(runId, {
      status: 'generating_text',
      errorMessage: '',
      finishedAt: null,
      progressLogs: [
        {
          ts: new Date().toISOString(),
          message: 'Manual run started.',
        },
      ],
    });

    const artifacts = await generateRunArtifacts({
      ownerType: 'manual_run',
      ownerId: runId,
      runId,
      prompt: run.prompt,
      ttsModel: run.ttsModel,
      toolOptions: run.toolOptions,
      onTextReady: async ({ text, groundingLinks }) => {
        await updateManualRun(runId, {
          status: 'generating_audio',
          generatedText: text,
          groundingLinks,
          errorMessage: '',
        });
      },
      onProgress: async ({ message }) => {
        await appendProgressLog(runId, message);
      },
    });

    const startedAt = run.createdAt || new Date().toISOString();
    await appendProgressLog(runId, `Uploading ${artifacts.audioParts.length} audio part(s).`);
    const audioParts = [];
    for (const part of artifacts.audioParts) {
      await appendProgressLog(runId, `Uploading Part ${part.partIndex}/${part.partCount}.`);
      const audioInfo = await saveAudio({
        scheduleId: 'manual',
        runId,
        startedAt,
        outputPrefix: DEFAULT_OUTPUT_PREFIX,
        wavBuffer: part.wavBuffer,
        partIndex: part.partIndex,
      });
      audioParts.push({
        partIndex: part.partIndex,
        partCount: part.partCount,
        text: part.text,
        audioPath: audioInfo.audioPath,
        audioDownloadUrl: audioInfo.audioDownloadUrl,
      });
      await updateManualRun(runId, {
        generatedText: artifacts.text,
        groundingLinks: artifacts.groundingLinks,
        audioParts: [...audioParts],
        errorMessage: '',
      });
    }
    await updateManualRun(runId, {
      generatedText: artifacts.text,
      groundingLinks: artifacts.groundingLinks,
      audioPath: '',
      audioDownloadUrl: '',
      audioParts,
      errorMessage: '',
    });
    const finishedAt = new Date().toISOString();
    await appendProgressLog(runId, 'Saving transcript artifact.');
    const textInfo = await saveTextArtifact({
      scheduleId: 'manual',
      runId,
      startedAt,
      outputPrefix: DEFAULT_OUTPUT_PREFIX,
      payload: {
        runId,
        prompt: run.prompt,
        generatedText: artifacts.text,
        groundingLinks: artifacts.groundingLinks,
        ttsModel: run.ttsModel,
        toolOptions: artifacts.toolOptions,
        chunkCount: artifacts.chunkCount,
        audioPath: '',
        audioParts,
        createdAt: run.createdAt,
        finishedAt,
      },
    });
    await appendProgressLog(runId, 'Manual run completed successfully.');

    const updated = await updateManualRun(runId, {
      status: 'success',
      generatedText: artifacts.text,
      groundingLinks: artifacts.groundingLinks,
      audioPath: '',
      audioDownloadUrl: '',
      audioParts,
      textPath: textInfo.textPath,
      errorMessage: '',
      finishedAt,
    });

    logInfo('manualRunRunner', 'run.success', {
      runId,
      audioPartCount: audioParts.length,
      firstAudioPath: audioParts[0]?.audioPath || null,
      textPath: textInfo.textPath,
    });
    return updated;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error?.message || 'Manual run failed';
    const updated = await updateManualRun(runId, {
      status: 'error',
      errorMessage: message,
      finishedAt,
    });
    await appendProgressLog(runId, `Manual run failed: ${message}`);
    logError('manualRunRunner', 'run.error', { runId, error });
    return updated;
  }
}

async function startWorker() {
  if (workerActive) {
    return;
  }

  workerActive = true;
  logInfo('manualRunRunner', 'worker.start', { queued: queuedRunIds.length });
  try {
    while (queuedRunIds.length > 0) {
      const runId = queuedRunIds.shift();
      if (!runId) {
        continue;
      }
      queuedRunIdSet.delete(runId);
      await processRun(runId);
    }
  } finally {
    workerActive = false;
    logInfo('manualRunRunner', 'worker.stop', { queued: queuedRunIds.length });
  }
}

export async function enqueueManualRuns(entries = []) {
  const runs = await createManualRuns(entries);
  for (const run of runs) {
    if (queuedRunIdSet.has(run.id)) {
      continue;
    }
    queuedRunIds.push(run.id);
    queuedRunIdSet.add(run.id);
  }
  void startWorker();
  return runs;
}

export async function isManualRunQueued(runId) {
  const run = await getManualRun(runId);
  if (!run) {
    return false;
  }
  return queuedRunIdSet.has(runId) || run.status === 'queued' || run.status === 'generating_text' || run.status === 'generating_audio';
}
