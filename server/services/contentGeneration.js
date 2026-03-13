import { generateGroundedText, generateSpeechBase64 } from './gemini.js';
import { mergePcmBase64ToWavBuffer } from '../utils/pcmToWav.js';
import { splitTextForTTS } from '../utils/ttsChunks.js';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const TOTAL_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;
const DEFAULT_TTS_CHUNK_CONCURRENCY = 2;
const MAX_TTS_CHUNK_CONCURRENCY = 4;
const DEFAULT_TOOL_OPTIONS = {
  enableGoogleSearch: true,
  enableUrlContext: false,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getTtsChunkConcurrency() {
  const rawValue = Number(process.env.TTS_CHUNK_CONCURRENCY || DEFAULT_TTS_CHUNK_CONCURRENCY);
  if (!Number.isFinite(rawValue)) {
    return DEFAULT_TTS_CHUNK_CONCURRENCY;
  }

  return Math.max(1, Math.min(MAX_TTS_CHUNK_CONCURRENCY, Math.floor(rawValue)));
}

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

async function generateAudioChunksInParallel({ ttsChunks, ttsModel, ownerType, ownerId, runId }) {
  const concurrency = getTtsChunkConcurrency();
  const audioChunks = new Array(ttsChunks.length);
  let nextIndex = 0;

  logInfo('contentGeneration', 'audio.parallel.start', {
    ownerType,
    ownerId,
    runId,
    chunkCount: ttsChunks.length,
    concurrency,
  });

  const worker = async (workerIndex) => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= ttsChunks.length) {
        return;
      }

      const chunk = ttsChunks[currentIndex];
      logInfo('contentGeneration', 'audio.part.start', {
        ownerType,
        ownerId,
        runId,
        partIndex: chunk.partIndex,
        partCount: chunk.partCount,
        chunkLength: chunk.text.length,
        workerIndex,
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

      audioChunks[currentIndex] = audioBase64;
      logInfo('contentGeneration', 'audio.part.buffered', {
        ownerType,
        ownerId,
        runId,
        partIndex: chunk.partIndex,
        partCount: chunk.partCount,
        bufferedParts: audioChunks.filter(Boolean).length,
        model: ttsModel,
        workerIndex,
      });
    }
  };

  const workerCount = Math.min(concurrency, ttsChunks.length);
  await Promise.all(Array.from({ length: workerCount }, (_, index) => worker(index + 1)));

  logInfo('contentGeneration', 'audio.parallel.complete', {
    ownerType,
    ownerId,
    runId,
    chunkCount: ttsChunks.length,
    concurrency: workerCount,
  });

  return audioChunks;
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

  const audioChunks = await generateAudioChunksInParallel({
    ttsChunks,
    ttsModel,
    ownerType,
    ownerId,
    runId,
  });

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
