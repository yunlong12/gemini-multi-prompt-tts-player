import { GeminiToolOptions, GroundingUrl } from "../types";

interface TextResult {
  text: string;
  groundingLinks: GroundingUrl[];
}

type LogFn = (msg: string) => void;

const toApiError = (message: string, status?: number): Error => {
  const error = new Error(message);
  if (typeof status === 'number') {
    (error as Error & { status?: number }).status = status;
  }
  return error;
};

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

export const generateTextAnswer = async (
  prompt: string,
  toolOptions: GeminiToolOptions,
  log: LogFn
): Promise<TextResult> => {
  try {
    log(`[Text] Initializing request for prompt: "${prompt.substring(0, 30)}..."`);
    log(`[Text] Calling backend /api/text...`);
    const response = await fetch('/api/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, ...toolOptions }),
    });

    const data = await parseApiPayload(response);
    if (!response.ok) {
      const message = typeof data === 'string' ? data : data?.message;
      throw toApiError(message || `HTTP ${response.status}`, response.status);
    }

    const text = typeof data === 'object' && data?.text ? data.text : "No response generated.";
    const groundingLinks = typeof data === 'object' && Array.isArray(data?.groundingLinks) ? data.groundingLinks : [];
    log(`[Text] Response received. Text length: ${text.length} chars.`);

    return { text, groundingLinks };
  } catch (error: any) {
    log(`[Text] Error: ${error.message}`);
    console.error("Text Gen Error:", error);
    throw toApiError(error.message || "Failed to generate text", error?.status);
  }
};

export const generateSpeech = async (text: string, model: string, log: LogFn): Promise<string> => {
  try {
    log(`[TTS] Preparing speech generation for text length: ${text.length}`);
    const cleanedText = cleanTextForTTS(text);
    log(`[TTS] Cleaned text length: ${cleanedText.length}. Sample: "${cleanedText.substring(0, 30)}..."`);

    log(`[TTS] Calling backend /api/tts (${model})...`);
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleanedText, model }),
    });
    const data = await parseApiPayload(response);
    if (!response.ok) {
      const message = typeof data === 'string' ? data : data?.message;
      throw toApiError(message ? `TTS request failed: ${message}` : `HTTP ${response.status}`, response.status);
    }
    const audioData = typeof data === 'object' ? data?.audioBase64 : undefined;
    if (!audioData) {
      log(`[TTS] Error: audioBase64 is missing or empty.`);
      throw new Error("No audio data received from backend");
    }

    log(`[TTS] Success! Received audio data. Base64 length: ${audioData.length}`);
    return audioData;
  } catch (error: any) {
    log(`[TTS] Critical Error: ${error.message}`);
    console.error("TTS Gen Error:", error);
    
    if (error.message?.includes('500')) {
         throw toApiError("TTS Service Error (500). Text may be too complex or model is overloaded.", error?.status);
     }
    throw toApiError(error.message || "Failed to generate speech", error?.status);
  }
};
