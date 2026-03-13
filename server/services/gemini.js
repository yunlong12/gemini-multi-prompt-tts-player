import { GoogleGenAI, Modality } from '@google/genai';
import { logError, logInfo, logWarn } from '../utils/logger.js';
import { splitTextForTTS } from '../utils/ttsChunks.js';

const TEXT_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const MAX_TTS_TEXT_LENGTH = Number(process.env.MAX_TTS_TEXT_LENGTH || 4000);
const DEFAULT_TOOL_OPTIONS = {
  enableGoogleSearch: true,
  enableUrlContext: false,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const aiClientsByKey = new Map();

function getConfiguredApiKeys() {
  const multiKeyValue = String(process.env.GEMINI_API_KEYS || '').trim();
  const singleKeyValue = String(process.env.GEMINI_API_KEY || '').trim();
  const keys = (multiKeyValue
    ? multiKeyValue.split(',').map((value) => value.trim()).filter(Boolean)
    : [singleKeyValue].filter(Boolean));

  if (!keys.length) {
    throw new Error('Missing GEMINI_API_KEY or GEMINI_API_KEYS in environment.');
  }

  return Array.from(new Set(keys));
}

function getAIForKey(apiKey, keyIndex) {
  if (!aiClientsByKey.has(apiKey)) {
    aiClientsByKey.set(apiKey, new GoogleGenAI({ apiKey }));
    logInfo('gemini', 'client.created', { keyIndex });
  }

  return aiClientsByKey.get(apiKey);
}

function isRetryableGeminiError(error) {
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || error?.error?.code || 0);
  return (
    status === 429 ||
    status === 503 ||
    message.includes('429') ||
    message.includes('503') ||
    message.includes('overloaded') ||
    message.includes('quota')
  );
}

async function runWithKeyFailover(operationFactory, context = {}) {
  const keys = getConfiguredApiKeys();
  const { scope = 'unknown', model = 'unknown', requestMeta = {}, retryOptions } = context;
  let lastError = null;

  for (let index = 0; index < keys.length; index += 1) {
    const keyNumber = index + 1;
    const totalKeys = keys.length;
    const ai = getAIForKey(keys[index], keyNumber);

    logInfo('gemini', 'key.attempt.start', {
      scope,
      model,
      keyIndex: keyNumber,
      totalKeys,
      ...requestMeta,
    });

    try {
      const result = await retryWithBackoff(() => operationFactory(ai), retryOptions);
      logInfo('gemini', 'key.attempt.success', {
        scope,
        model,
        keyIndex: keyNumber,
        totalKeys,
        ...requestMeta,
      });
      return result;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableGeminiError(error);
      const hasFallback = index < keys.length - 1;

      logWarn('gemini', retryable && hasFallback ? 'key.switch' : 'key.attempt.failed', {
        scope,
        model,
        keyIndex: keyNumber,
        totalKeys,
        retryable,
        willSwitch: Boolean(retryable && hasFallback),
        error,
        ...requestMeta,
      });

      if (!retryable || !hasFallback) {
        break;
      }
    }
  }

  logError('gemini', 'key.exhausted', {
    scope,
    model,
    totalKeys: getConfiguredApiKeys().length,
    error: lastError,
    ...requestMeta,
  });
  throw lastError;
}

export async function retryWithBackoff(operation, retries = 3, delay = 1000) {
  const retryConfig =
    typeof retries === 'object'
      ? {
          totalAttempts: Math.max(1, retries.totalAttempts ?? 4),
          delayMs: retries.delayMs ?? 1000,
          onAttemptStart: retries.onAttemptStart,
          onAttemptSuccess: retries.onAttemptSuccess,
          onAttemptFailure: retries.onAttemptFailure,
        }
      : {
          totalAttempts: Math.max(1, retries + 1),
          delayMs: delay,
        };

  for (let attempt = 1; attempt <= retryConfig.totalAttempts; attempt += 1) {
    retryConfig.onAttemptStart?.({ attempt, totalAttempts: retryConfig.totalAttempts });
    try {
      const result = await operation();
      retryConfig.onAttemptSuccess?.({ attempt, totalAttempts: retryConfig.totalAttempts });
      return result;
    } catch (error) {
      const msg = String(error?.message || '');
      const status = error?.status || error?.error?.code;
      const isRetryable =
        status === 503 ||
        status === 429 ||
        msg.includes('503') ||
        msg.includes('429') ||
        msg.toLowerCase().includes('overloaded');
      const hasAttemptsLeft = attempt < retryConfig.totalAttempts;
      const delayMs = retryConfig.delayMs * (2 ** (attempt - 1));

      retryConfig.onAttemptFailure?.({
        attempt,
        totalAttempts: retryConfig.totalAttempts,
        delayMs,
        error,
        willRetry: Boolean(isRetryable && hasAttemptsLeft),
      });

      if (isRetryable && hasAttemptsLeft) {
        logWarn('gemini', 'retry.backoff', { attempt, totalAttempts: retryConfig.totalAttempts, delayMs, error });
        await wait(delayMs);
        continue;
      }

      logError('gemini', 'retry.give_up', {
        attempt,
        totalAttempts: retryConfig.totalAttempts,
        retryable: isRetryable,
        error,
      });
      throw error;
    }
  }
}

export function cleanTextForTTS(text) {
  if (!text) return '';

  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*>\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToolOptions(toolOptions = {}) {
  return {
    enableGoogleSearch: toolOptions.enableGoogleSearch ?? DEFAULT_TOOL_OPTIONS.enableGoogleSearch,
    enableUrlContext: toolOptions.enableUrlContext ?? DEFAULT_TOOL_OPTIONS.enableUrlContext,
  };
}

function buildGeminiTools(toolOptions = {}) {
  const normalized = normalizeToolOptions(toolOptions);
  const tools = [];

  if (normalized.enableUrlContext) {
    tools.push({ urlContext: {} });
  }
  if (normalized.enableGoogleSearch) {
    tools.push({ googleSearch: {} });
  }

  return tools;
}

export async function generateGroundedText(prompt, toolOptions = {}, runtimeOptions = {}) {
  const normalizedToolOptions = normalizeToolOptions(toolOptions);
  const tools = buildGeminiTools(normalizedToolOptions);
  logInfo('gemini.text', 'request.start', { promptLength: prompt.length, model: TEXT_MODEL, ...normalizedToolOptions });
  const response = await runWithKeyFailover(
    (ai) =>
      ai.models.generateContent({
        model: TEXT_MODEL,
        contents: prompt,
        config: tools.length > 0 ? { tools } : undefined,
      }),
    {
      scope: 'text',
      model: TEXT_MODEL,
      retryOptions: runtimeOptions.retryOptions,
      requestMeta: {
        promptLength: prompt.length,
        enableGoogleSearch: normalizedToolOptions.enableGoogleSearch,
        enableUrlContext: normalizedToolOptions.enableUrlContext,
      },
    }
  );

  const text = String(response.text || '').trim();
  if (!text) {
    logError('gemini.text', 'request.empty_text', {
      promptLength: prompt.length,
      model: TEXT_MODEL,
      ...normalizedToolOptions,
    });
    throw new Error('Empty text response from model');
  }
  const groundingLinks = [];
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;

  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (chunk?.web?.uri && chunk?.web?.title) {
        groundingLinks.push({ uri: chunk.web.uri, title: chunk.web.title });
      }
    }
  }

  logInfo('gemini.text', 'request.success', {
    textLength: text.length,
    links: groundingLinks.length,
  });
  return { text, groundingLinks };
}

export async function generateSpeechBase64(text, model = DEFAULT_TTS_MODEL, runtimeOptions = {}) {
  const cleanedText = cleanTextForTTS(text);
  const boundedText =
    cleanedText.length > MAX_TTS_TEXT_LENGTH
      ? splitTextForTTS(cleanedText, MAX_TTS_TEXT_LENGTH)[0]?.text || cleanedText.slice(0, MAX_TTS_TEXT_LENGTH)
      : cleanedText;
  const promptWithStyle = `Read aloud very slowly in a warm and friendly tone: ${boundedText}`;
  logInfo('gemini.tts', 'request.start', {
    inputLength: text.length,
    cleanedLength: cleanedText.length,
    boundedLength: boundedText.length,
    model,
  });

  let response;
  try {
    response = await runWithKeyFailover(
      (ai) =>
        ai.models.generateContent({
          model,
          contents: [{ parts: [{ text: promptWithStyle }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Zephyr' },
              },
            },
          },
        }),
      {
        scope: 'tts',
        model,
        retryOptions: runtimeOptions.retryOptions,
        requestMeta: {
          inputLength: text.length,
          cleanedLength: cleanedText.length,
          boundedLength: boundedText.length,
        },
      }
    );
  } catch (error) {
    logError('gemini.tts', 'request.error', {
      model,
      inputLength: text.length,
      cleanedLength: cleanedText.length,
      boundedLength: boundedText.length,
      error,
    });
    throw error;
  }

  const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioBase64) {
    logError('gemini.tts', 'request.no_audio_data');
    throw new Error('No audio data received from Gemini');
  }

  logInfo('gemini.tts', 'request.success', {
    audioBase64Length: audioBase64.length,
  });
  return audioBase64;
}

export { DEFAULT_TTS_MODEL };
