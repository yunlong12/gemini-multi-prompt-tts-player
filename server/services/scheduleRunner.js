import crypto from 'node:crypto';
import { computeNextRunAt, interpolatePromptTemplate } from '../utils/time.js';
import { recordRun, tryLockSchedule, updateNextRun } from './scheduleStore.js';
import { saveAudio, saveTextArtifact } from './resultStore.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { generateRunArtifacts } from './contentGeneration.js';

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_TOOL_OPTIONS = {
  enableGoogleSearch: true,
  enableUrlContext: false,
};

export async function executeSchedule(schedule, options = {}) {
  const startedAt = new Date().toISOString();
  const triggeredBy = options.triggeredBy || 'scheduler';
  const lockUntil = new Date(Date.now() + LOCK_WINDOW_MS).toISOString();
  logInfo('scheduleRunner', 'execute.start', {
    scheduleId: schedule.id,
    name: schedule.name,
    triggeredBy,
    startedAt,
    lockUntil,
  });
  const lockedSchedule = await tryLockSchedule(schedule.id, lockUntil, startedAt);
  if (!lockedSchedule) {
    logWarn('scheduleRunner', 'execute.skipped_lock_not_acquired', {
      scheduleId: schedule.id,
      startedAt,
    });
    return null;
  }

  const runId = crypto.randomUUID();
  const resolvedPrompt = interpolatePromptTemplate(schedule.promptTemplate, new Date(startedAt), schedule.timezone);
  const toolOptions = {
    enableGoogleSearch: schedule.enableGoogleSearch ?? DEFAULT_TOOL_OPTIONS.enableGoogleSearch,
    enableUrlContext: schedule.enableUrlContext ?? DEFAULT_TOOL_OPTIONS.enableUrlContext,
  };
  logInfo('scheduleRunner', 'execute.lock_acquired', {
    scheduleId: schedule.id,
    runId,
    resolvedPromptLength: resolvedPrompt.length,
    ...toolOptions,
  });

  try {
    const artifacts = await generateRunArtifacts({
      ownerType: 'schedule',
      ownerId: schedule.id,
      runId,
      prompt: resolvedPrompt,
      ttsModel: schedule.ttsModel,
      toolOptions,
    });
    const audioInfo = await saveAudio({
      scheduleId: schedule.id,
      runId,
      startedAt,
      outputPrefix: schedule.outputPrefix,
      wavBuffer: artifacts.wavBuffer,
    });
    const finishedAt = new Date().toISOString();
    const textInfo = await saveTextArtifact({
      scheduleId: schedule.id,
      runId,
      startedAt,
      outputPrefix: schedule.outputPrefix,
      payload: {
        scheduleId: schedule.id,
        runId,
        startedAt,
        finishedAt,
        resolvedPrompt,
        generatedText: artifacts.text,
        groundingLinks: artifacts.groundingLinks,
        ttsModel: schedule.ttsModel,
        toolOptions: artifacts.toolOptions,
        chunkCount: artifacts.chunkCount,
        audioPath: audioInfo.audioPath,
      },
    });
    const recordedRun = await recordRun({
      id: runId,
      scheduleId: schedule.id,
      startedAt,
      finishedAt,
      status: 'success',
      triggeredBy,
      resolvedPrompt,
      generatedText: artifacts.text,
      groundingLinks: artifacts.groundingLinks,
      audioPath: audioInfo.audioPath,
      textPath: textInfo.textPath,
      audioDownloadUrl: audioInfo.audioDownloadUrl,
      errorMessage: '',
    });

    await updateNextRun(
      schedule.id,
      computeNextRunAt({ ...schedule, lastRunAt: finishedAt }, new Date(finishedAt)),
      finishedAt,
      {
        lastStatus: 'success',
        lastError: '',
      }
    );

    logInfo('scheduleRunner', 'execute.success', {
      scheduleId: schedule.id,
      runId: runId,
      finishedAt,
      runCount: 1,
    });

    return recordedRun;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errorMessage = error?.message || 'Schedule execution failed';
    logError('scheduleRunner', 'execute.error', {
      scheduleId: schedule.id,
      runId,
      finishedAt,
      error,
    });

    await recordRun({
      id: runId,
      scheduleId: schedule.id,
      startedAt,
      finishedAt,
      status: 'error',
      triggeredBy,
      resolvedPrompt,
      generatedText: '',
      groundingLinks: [],
      audioPath: '',
      textPath: '',
      audioDownloadUrl: '',
      errorMessage,
    });

    await updateNextRun(
      schedule.id,
      computeNextRunAt({ ...schedule, lastRunAt: finishedAt }, new Date(finishedAt)),
      finishedAt,
      {
        lastStatus: 'error',
        lastError: errorMessage,
      }
    );

    logWarn('scheduleRunner', 'execute.error_recorded', {
      scheduleId: schedule.id,
      runId,
      nextRunComputedFrom: finishedAt,
    });

    throw error;
  }
}
