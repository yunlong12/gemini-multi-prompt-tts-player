import { GoogleGenAI, Modality } from '@google/genai';
import { logError, logInfo, logWarn } from '../utils/logger.js';

const TEXT_MODEL = 'gemini-3-pro-preview';
const DEFAULT_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const MAX_TTS_TEXT_LENGTH = Number(process.env.MAX_TTS_TEXT_LENGTH || 4000);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let aiClient = null;

const getAI = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY in environment.');
  }

  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey });
    logInfo('gemini', 'client.created');
  }

  return aiClient;
};

export async function retryWithBackoff(operation, retries = 3, delay = 1000) {
  try {
    return await operation();
  } catch (error) {
    const msg = String(error?.message || '');
    const status = error?.status || error?.error?.code;
    const isRetryable =
      status === 503 ||
      status === 429 ||
      msg.includes('503') ||
      msg.includes('429') ||
      msg.toLowerCase().includes('overloaded');

    if (isRetryable && retries > 0) {
      logWarn('gemini', 'retry.backoff', { retriesLeft: retries, delayMs: delay, error });
      await wait(delay);
      return retryWithBackoff(operation, retries - 1, delay * 2);
    }
    logError('gemini', 'retry.give_up', { retriesLeft: retries, error });
    throw error;
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

export async function generateGroundedText(prompt) {
  logInfo('gemini.text', 'request.start', { promptLength: prompt.length, model: TEXT_MODEL });
  const ai = getAI();
  const response = await retryWithBackoff(() =>
    ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    })
  );

  const text = response.text || 'No response generated.';
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

export async function generateSpeechBase64(text, model = DEFAULT_TTS_MODEL) {
  const cleanedText = cleanTextForTTS(text);
  const boundedText =
    cleanedText.length > MAX_TTS_TEXT_LENGTH
      ? `${cleanedText.slice(0, MAX_TTS_TEXT_LENGTH)}...`
      : cleanedText;
  const promptWithStyle = `Read aloud very slowly in a warm and friendly tone: ${boundedText}`;
  logInfo('gemini.tts', 'request.start', {
    inputLength: text.length,
    cleanedLength: cleanedText.length,
    boundedLength: boundedText.length,
    model,
  });

  const ai = getAI();
  const response = await retryWithBackoff(() =>
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
    })
  );

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
