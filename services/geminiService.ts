import { GeminiToolOptions, GroundingUrl } from "../types";

interface TextResult {
  text: string;
  groundingLinks: GroundingUrl[];
}

type LogFn = (msg: string) => void;
type RetryContext = {
  contextLabel?: string;
  maxAttempts?: number;
};

const TOTAL_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 1000;

const toApiError = (
  message: string,
  status?: number,
  extras?: Record<string, unknown>
): Error & Record<string, unknown> => {
  const error = new Error(message);
  if (typeof status === 'number') {
    (error as Error & { status?: number }).status = status;
  }
  return Object.assign(error, extras || {});
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanTextForTTS = (text: string): string => {
  if (!text) return "";
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
};

const parseApiPayload = async (response: Response) => {
  const rawText = await response.text();
  if (!rawText) {
    return null;
  }

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
};

const retryRequest = async <T>(
  operation: () => Promise<T>,
  options: {
    stage: 'Text' | 'TTS';
    log: LogFn;
    maxAttempts?: number;
    contextLabel?: string;
    finalMessage: (cause: string, totalAttempts: number) => string;
  }
): Promise<T> => {
  const maxAttempts = Math.max(1, options.maxAttempts ?? TOTAL_ATTEMPTS);
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const contextSuffix = options.contextLabel ? ` (${options.contextLabel})` : '';
    options.log(`[${options.stage}] Attempt ${attempt}/${maxAttempts}${contextSuffix}.`);
    try {
      const result = await operation();
      if (attempt > 1) {
        options.log(`[${options.stage}] Attempt ${attempt}/${maxAttempts}${contextSuffix} succeeded.`);
      }
      return result;
    } catch (error: any) {
      lastError = error;
      const message = error?.message || 'Unknown error';
      if (attempt >= maxAttempts) {
        const finalMessage = options.finalMessage(message, maxAttempts);
        options.log(`[${options.stage}] Failed after ${maxAttempts} attempts${contextSuffix}: ${message}`);
        throw toApiError(finalMessage, error?.status, { alreadyLogged: true });
      }

      const delayMs = BASE_RETRY_DELAY_MS * (2 ** (attempt - 1));
      options.log(
        `[${options.stage}] Attempt ${attempt}/${maxAttempts}${contextSuffix} failed: ${message}. Retrying in ${Math.round(delayMs / 1000)}s...`
      );
      await wait(delayMs);
    }
  }

  const fallbackMessage = lastError?.message || 'Unknown error';
  throw toApiError(options.finalMessage(fallbackMessage, maxAttempts), lastError?.status, { alreadyLogged: true });
};

export const generateTextAnswer = async (
  prompt: string,
  toolOptions: GeminiToolOptions,
  log: LogFn,
  retryContext: RetryContext = {}
): Promise<TextResult> => {
  try {
    log(`[Text] Initializing request for prompt: "${prompt.substring(0, 30)}..."`);
    const data = await retryRequest(async () => {
      log(`[Text] Calling backend /api/text...`);
      const response = await fetch('/api/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...toolOptions }),
      });

      const payload = await parseApiPayload(response);
      if (!response.ok) {
        const message = typeof payload === 'string' ? payload : payload?.message;
        throw toApiError(message || `HTTP ${response.status}`, response.status);
      }
      return payload;
    }, {
      stage: 'Text',
      log,
      maxAttempts: retryContext.maxAttempts,
      contextLabel: retryContext.contextLabel,
      finalMessage: (cause, totalAttempts) => `Text generation failed after ${totalAttempts} attempts: ${cause}`,
    });

    const text = typeof data === 'object' && data?.text ? data.text : "No response generated.";
    const groundingLinks = typeof data === 'object' && Array.isArray(data?.groundingLinks) ? data.groundingLinks : [];
    log(`[Text] Response received. Text length: ${text.length} chars.`);

    return { text, groundingLinks };
  } catch (error: any) {
    if (!error?.alreadyLogged) {
      log(`[Text] Error: ${error.message}`);
    }
    console.error("Text Gen Error:", error);
    throw toApiError(error.message || "Failed to generate text", error?.status);
  }
};

export const generateSpeech = async (
  text: string,
  model: string,
  log: LogFn,
  retryContext: RetryContext = {}
): Promise<string> => {
  try {
    log(`[TTS] Preparing speech generation for text length: ${text.length}`);
    const cleanedText = cleanTextForTTS(text);
    log(`[TTS] Cleaned text length: ${cleanedText.length}. Sample: "${cleanedText.substring(0, 30)}..."`);

    const data = await retryRequest(async () => {
      log(`[TTS] Calling backend /api/tts (${model})...`);
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanedText, model }),
      });
      const payload = await parseApiPayload(response);
      if (!response.ok) {
        const message = typeof payload === 'string' ? payload : payload?.message;
        throw toApiError(message ? `TTS request failed: ${message}` : `HTTP ${response.status}`, response.status);
      }
      return payload;
    }, {
      stage: 'TTS',
      log,
      maxAttempts: retryContext.maxAttempts,
      contextLabel: retryContext.contextLabel,
      finalMessage: (cause, totalAttempts) =>
        retryContext.contextLabel
          ? `TTS failed for ${retryContext.contextLabel} after ${totalAttempts} attempts: ${cause}`
          : `TTS failed after ${totalAttempts} attempts: ${cause}`,
    });

    const audioData = typeof data === 'object' ? data?.audioBase64 : undefined;
    if (!audioData) {
      log(`[TTS] Error: audioBase64 is missing or empty.`);
      throw new Error("No audio data received from backend");
    }

    log(`[TTS] Success! Received audio data. Base64 length: ${audioData.length}`);
    return audioData;
  } catch (error: any) {
    if (!error?.alreadyLogged) {
      log(`[TTS] Critical Error: ${error.message}`);
    }
    console.error("TTS Gen Error:", error);
    
    if (error.message?.includes('500')) {
         throw toApiError("TTS Service Error (500). Text may be too complex or model is overloaded.", error?.status, { alreadyLogged: Boolean(error?.alreadyLogged) });
     }
    throw toApiError(error.message || "Failed to generate speech", error?.status, { alreadyLogged: Boolean(error?.alreadyLogged) });
  }
};
