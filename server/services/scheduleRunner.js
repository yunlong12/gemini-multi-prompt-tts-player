import crypto from 'node:crypto';
import { generateGroundedText, generateSpeechBase64 } from './gemini.js';
import { pcmBase64ToWavBuffer } from '../utils/pcmToWav.js';
import { computeNextRunAt, interpolatePromptTemplate } from '../utils/time.js';
import { recordRun, tryLockSchedule, updateNextRun } from './scheduleStore.js';
import { saveAudio, saveTextArtifact } from './resultStore.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const LOCK_WINDOW_MS = 15 * 60 * 1000;

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
  logInfo('scheduleRunner', 'execute.lock_acquired', {
    scheduleId: schedule.id,
    runId,
    resolvedPromptLength: resolvedPrompt.length,
  });

  try {
    const { text, groundingLinks } = await generateGroundedText(resolvedPrompt);
    logInfo('scheduleRunner', 'text.generated', {
      scheduleId: schedule.id,
      runId,
      textLength: text.length,
      links: groundingLinks.length,
    });
    const audioBase64 = await generateSpeechBase64(text, schedule.ttsModel);
    logInfo('scheduleRunner', 'audio.generated', {
      scheduleId: schedule.id,
      runId,
      audioBase64Length: audioBase64.length,
      model: schedule.ttsModel,
    });
    const wavBuffer = pcmBase64ToWavBuffer(audioBase64);
    logInfo('scheduleRunner', 'audio.wav_ready', {
      scheduleId: schedule.id,
      runId,
      wavBytes: wavBuffer.length,
    });
    const audioInfo = await saveAudio({
      scheduleId: schedule.id,
      runId,
      startedAt,
      outputPrefix: schedule.outputPrefix,
      wavBuffer,
    });
    logInfo('scheduleRunner', 'audio.saved', {
      scheduleId: schedule.id,
      runId,
      audioPath: audioInfo.audioPath,
    });
    const textInfo = await saveTextArtifact({
      scheduleId: schedule.id,
      runId,
      startedAt,
      outputPrefix: schedule.outputPrefix,
      payload: {
        scheduleId: schedule.id,
        runId,
        startedAt,
        finishedAt: new Date().toISOString(),
        resolvedPrompt,
        generatedText: text,
        groundingLinks,
        ttsModel: schedule.ttsModel,
        audioPath: audioInfo.audioPath,
      },
    });
    logInfo('scheduleRunner', 'text.saved', {
      scheduleId: schedule.id,
      runId,
      textPath: textInfo.textPath,
    });
    const finishedAt = new Date().toISOString();
    const run = await recordRun({
      id: runId,
      scheduleId: schedule.id,
      startedAt,
      finishedAt,
      status: 'success',
      triggeredBy,
      resolvedPrompt,
      generatedText: text,
      groundingLinks,
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
      runId,
      finishedAt,
      status: run.status,
    });

    return run;
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
