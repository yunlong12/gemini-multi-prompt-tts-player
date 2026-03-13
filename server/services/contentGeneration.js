import { generateGroundedText, generateSpeechBase64 } from './gemini.js';
import { mergePcmBase64ToWavBuffer } from '../utils/pcmToWav.js';
import { splitTextForTTS } from '../utils/ttsChunks.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const TOTAL_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;
const DEFAULT_TOOL_OPTIONS = {
  enableGoogleSearch: true,
  enableUrlContext: false,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runWithAttemptLogging(operation, context) {
  const { operationType, ownerType, ownerId, runId, partIndex, partCount } = context;

  for (let attempt = 1; attempt <= TOTAL_ATTEMPTS; attempt += 1) {
    logInfo('contentGeneration', `${operationType}.attempt.start`, {
      ownerType,
      ownerId,
      runId,
      attempt,
      totalAttempts: TOTAL_ATTEMPTS,
      partIndex,
      partCount,
    });
    try {
      const result = await operation();
      logInfo('contentGeneration', `${operationType}.attempt.success`, {
        ownerType,
        ownerId,
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
        logError('contentGeneration', `${operationType}.attempt.give_up`, {
          ownerType,
          ownerId,
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
      logWarn('contentGeneration', `${operationType}.attempt.retry`, {
        ownerType,
        ownerId,
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

export async function generateRunArtifacts({
  ownerType,
  ownerId,
  runId,
  prompt,
  ttsModel,
  toolOptions = {},
  onTextReady,
}) {
  const normalizedToolOptions = {
    enableGoogleSearch: toolOptions.enableGoogleSearch ?? DEFAULT_TOOL_OPTIONS.enableGoogleSearch,
    enableUrlContext: toolOptions.enableUrlContext ?? DEFAULT_TOOL_OPTIONS.enableUrlContext,
  };

  const { text, groundingLinks } = await runWithAttemptLogging(
    () =>
      generateGroundedText(prompt, normalizedToolOptions, {
        retryOptions: { totalAttempts: 1 },
      }),
    {
      operationType: 'text',
      ownerType,
      ownerId,
      runId,
    }
  );

  logInfo('contentGeneration', 'text.generated', {
    ownerType,
    ownerId,
    runId,
    textLength: text.length,
    links: groundingLinks.length,
  });

  if (onTextReady) {
    await onTextReady({ text, groundingLinks, toolOptions: normalizedToolOptions });
  }

  const ttsChunks = splitTextForTTS(text);
  logInfo('contentGeneration', 'audio.chunking.complete', {
    ownerType,
    ownerId,
    runId,
    chunkCount: ttsChunks.length,
  });

  const audioChunks = [];
  for (const chunk of ttsChunks) {
    logInfo('contentGeneration', 'audio.part.start', {
      ownerType,
      ownerId,
      runId,
      partIndex: chunk.partIndex,
      partCount: chunk.partCount,
      chunkLength: chunk.text.length,
    });
    const audioBase64 = await runWithAttemptLogging(
      () =>
        generateSpeechBase64(chunk.text, ttsModel, {
          retryOptions: { totalAttempts: 1 },
        }),
      {
        operationType: 'audio',
        ownerType,
        ownerId,
        runId,
        partIndex: chunk.partIndex,
        partCount: chunk.partCount,
      }
    );

    audioChunks.push(audioBase64);
    logInfo('contentGeneration', 'audio.part.buffered', {
      ownerType,
      ownerId,
      runId,
      partIndex: chunk.partIndex,
      partCount: chunk.partCount,
      bufferedParts: audioChunks.length,
      model: ttsModel,
    });
  }

  const wavBuffer = mergePcmBase64ToWavBuffer(audioChunks);
  logInfo('contentGeneration', 'audio.merge.success', {
    ownerType,
    ownerId,
    runId,
    wavBytes: wavBuffer.length,
  });

  return {
    text,
    groundingLinks,
    wavBuffer,
    chunkCount: ttsChunks.length,
    toolOptions: normalizedToolOptions,
  };
}
