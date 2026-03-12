import crypto from 'node:crypto';
import { generateGroundedText, generateSpeechBase64 } from './gemini.js';
import { pcmBase64ToWavBuffer } from '../utils/pcmToWav.js';
import { computeNextRunAt, interpolatePromptTemplate } from '../utils/time.js';
import { recordRun, tryLockSchedule, updateNextRun } from './scheduleStore.js';
import { saveAudio, saveTextArtifact } from './resultStore.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { splitTextForTTS } from '../utils/ttsChunks.js';

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const TOTAL_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;
const DEFAULT_TOOL_OPTIONS = {
  enableGoogleSearch: true,
  enableUrlContext: false,
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithAttemptLogging(operation, context) {
  const {
    operationType,
    scheduleId,
    runId,
    partIndex,
    partCount,
  } = context;

  for (let attempt = 1; attempt <= TOTAL_ATTEMPTS; attempt += 1) {
    logInfo('scheduleRunner', `${operationType}.attempt.start`, {
      scheduleId,
      runId,
      attempt,
      totalAttempts: TOTAL_ATTEMPTS,
      partIndex,
      partCount,
    });
    try {
      const result = await operation();
      logInfo('scheduleRunner', `${operationType}.attempt.success`, {
        scheduleId,
        runId,
        attempt,
        totalAttempts: TOTAL_ATTEMPTS,
        partIndex,
        partCount,
      });
      return result;
    } catch (error) {
      const message = error?.message || 'Unknown error';
      if (attempt >= TOTAL_ATTEMPTS) {
        logError('scheduleRunner', `${operationType}.attempt.give_up`, {
          scheduleId,
          runId,
          attempt,
          totalAttempts: TOTAL_ATTEMPTS,
          partIndex,
          partCount,
          error,
        });
        if (operationType === 'text') {
          throw new Error(`Text generation failed after ${TOTAL_ATTEMPTS} attempts: ${message}`);
        }
        throw new Error(`TTS failed for Part ${partIndex}/${partCount} after ${TOTAL_ATTEMPTS} attempts: ${message}`);
      }

      const delayMs = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1));
      logWarn('scheduleRunner', `${operationType}.attempt.retry`, {
        scheduleId,
        runId,
        attempt,
        totalAttempts: TOTAL_ATTEMPTS,
        delayMs,
        partIndex,
        partCount,
        error,
      });
      await wait(delayMs);
    }
  }
}

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
    const { text, groundingLinks } = await runWithAttemptLogging(
      () =>
        generateGroundedText(resolvedPrompt, toolOptions, {
          retryOptions: { totalAttempts: 1 },
        }),
      {
        operationType: 'text',
        scheduleId: schedule.id,
        runId,
      }
    );
    logInfo('scheduleRunner', 'text.generated', {
      scheduleId: schedule.id,
      runId,
      textLength: text.length,
      links: groundingLinks.length,
    });
    const ttsChunks = splitTextForTTS(text);
    const partGroupId = ttsChunks.length > 1 ? crypto.randomUUID() : runId;
    const recordedRuns = [];

    for (const chunk of ttsChunks) {
      const chunkRunId = chunk.partCount > 1 ? `${partGroupId}-part-${String(chunk.partIndex).padStart(2, '0')}` : runId;
      logInfo('scheduleRunner', 'audio.part.start', {
        scheduleId: schedule.id,
        runId: chunkRunId,
        partIndex: chunk.partIndex,
        partCount: chunk.partCount,
        chunkLength: chunk.text.length,
      });
      try {
        const audioBase64 = await runWithAttemptLogging(
          () =>
            generateSpeechBase64(chunk.text, schedule.ttsModel, {
              retryOptions: { totalAttempts: 1 },
            }),
          {
            operationType: 'audio',
            scheduleId: schedule.id,
            runId: chunkRunId,
            partIndex: chunk.partIndex,
            partCount: chunk.partCount,
          }
        );
        logInfo('scheduleRunner', 'audio.generated', {
          scheduleId: schedule.id,
          runId: chunkRunId,
          partIndex: chunk.partIndex,
          partCount: chunk.partCount,
          audioBase64Length: audioBase64.length,
          model: schedule.ttsModel,
        });
        const wavBuffer = pcmBase64ToWavBuffer(audioBase64);
        logInfo('scheduleRunner', 'audio.wav_ready', {
          scheduleId: schedule.id,
          runId: chunkRunId,
          partIndex: chunk.partIndex,
          partCount: chunk.partCount,
          wavBytes: wavBuffer.length,
        });
        const audioInfo = await saveAudio({
          scheduleId: schedule.id,
          runId: chunkRunId,
          startedAt,
          outputPrefix: schedule.outputPrefix,
          wavBuffer,
        });
        const finishedAt = new Date().toISOString();
        const textInfo = await saveTextArtifact({
          scheduleId: schedule.id,
          runId: chunkRunId,
          startedAt,
          outputPrefix: schedule.outputPrefix,
          payload: {
            scheduleId: schedule.id,
            runId: chunkRunId,
            startedAt,
            finishedAt,
            resolvedPrompt,
            generatedText: chunk.text,
            groundingLinks,
            ttsModel: schedule.ttsModel,
            toolOptions,
            partIndex: chunk.partIndex,
            partCount: chunk.partCount,
            partGroupId,
            audioPath: audioInfo.audioPath,
          },
        });
        const run = await recordRun({
          id: chunkRunId,
          scheduleId: schedule.id,
          startedAt,
          finishedAt,
          status: 'success',
          triggeredBy,
          resolvedPrompt,
          generatedText: chunk.text,
          groundingLinks,
          audioPath: audioInfo.audioPath,
          textPath: textInfo.textPath,
          audioDownloadUrl: audioInfo.audioDownloadUrl,
          errorMessage: '',
          partIndex: chunk.partIndex,
          partCount: chunk.partCount,
          partGroupId,
        });
        recordedRuns.push(run);
      } catch (partError) {
        const finishedAt = new Date().toISOString();
        const errorMessage = partError?.message || 'Schedule execution failed';
        await recordRun({
          id: chunkRunId,
          scheduleId: schedule.id,
          startedAt,
          finishedAt,
          status: 'error',
          triggeredBy,
          resolvedPrompt,
          generatedText: chunk.text,
          groundingLinks,
          audioPath: '',
          textPath: '',
          audioDownloadUrl: '',
          errorMessage,
          partIndex: chunk.partIndex,
          partCount: chunk.partCount,
          partGroupId,
        });
        if (partError && typeof partError === 'object') {
          partError.runAlreadyRecorded = true;
        }
        throw partError;
      }
    }

    const finishedAt = new Date().toISOString();
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
      runCount: recordedRuns.length,
    });

    return recordedRuns[0] || null;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errorMessage = error?.message || 'Schedule execution failed';
    logError('scheduleRunner', 'execute.error', {
      scheduleId: schedule.id,
      runId,
      finishedAt,
      error,
    });

    if (!error?.runAlreadyRecorded) {
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
    }

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
