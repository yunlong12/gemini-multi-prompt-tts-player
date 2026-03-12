export interface TtsChunk {
  text: string;
  partIndex: number;
  partCount: number;
}

const DEFAULT_MAX_CHARS = 2600;

const splitIntoParagraphs = (text: string) =>
  String(text || '')
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

const splitIntoSentences = (text: string) =>
  String(text || '')
    .split(/(?<=[.!?。！？；;])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

const splitHard = (text: string, maxChars: number) => {
  const parts: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf(' ', maxChars);
    if (splitAt < Math.floor(maxChars * 0.5)) {
      splitAt = maxChars;
    }
    parts.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    parts.push(remaining);
  }

  return parts.filter(Boolean);
};

const pushSegments = (source: string, maxChars: number, target: string[]) => {
  const paragraphs = splitIntoParagraphs(source);
  const units = paragraphs.length > 1 ? paragraphs : splitIntoSentences(source);
  const segments = units.length > 0 ? units : [source];

  let current = '';
  for (const segment of segments) {
    if (!segment) {
      continue;
    }

    if (segment.length > maxChars) {
      if (current) {
        target.push(current.trim());
        current = '';
      }
      splitHard(segment, maxChars).forEach((part) => target.push(part));
      continue;
    }

    const candidate = current ? `${current} ${segment}` : segment;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    if (current) {
      target.push(current.trim());
    }
    current = segment;
  }

  if (current) {
    target.push(current.trim());
  }
};

export const splitTextForTTS = (text: string, maxChars = DEFAULT_MAX_CHARS): TtsChunk[] => {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const rawChunks: string[] = [];
  pushSegments(normalized, maxChars, rawChunks);
  const uniqueChunks = rawChunks.filter(Boolean);
  const partCount = uniqueChunks.length || 1;

  return (uniqueChunks.length ? uniqueChunks : [normalized]).map((chunk, index) => ({
    text: chunk,
    partIndex: index + 1,
    partCount,
  }));
};

export const formatPartLabel = (partIndex?: number, partCount?: number) =>
  partIndex && partCount && partCount > 1 ? `Part ${partIndex}/${partCount}` : '';
