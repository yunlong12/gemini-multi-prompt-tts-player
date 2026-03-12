const DEFAULT_MAX_CHARS = 2600;

function splitIntoParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitIntoSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?。！？；;])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitHard(text, maxChars) {
  const parts = [];
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
}

function pushSegments(source, maxChars, target) {
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
}

export function splitTextForTTS(text, maxChars = DEFAULT_MAX_CHARS) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return [];
  }

  const rawChunks = [];
  pushSegments(normalized, maxChars, rawChunks);
  const chunks = rawChunks.filter(Boolean);
  const partCount = chunks.length || 1;

  return (chunks.length ? chunks : [normalized]).map((chunk, index) => ({
    text: chunk,
    partIndex: index + 1,
    partCount,
  }));
}
