import { ItemStatus, PlayerItem, ProcessItem, ScheduleRun } from '../types';

const shorten = (value: string, max = 72) => {
  const text = String(value || '').trim();
  if (!text) {
    return 'Untitled';
  }
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
};

export const manualItemToPlayerItem = (item: ProcessItem): PlayerItem | null => {
  if (!item.audioBuffer || item.status === ItemStatus.ERROR) {
    return null;
  }

  return {
    id: `manual:${item.id}`,
    source: 'manual',
    title: shorten(item.prompt),
    timestamp: item.timestamp,
    status: 'ready',
    promptText: item.prompt,
    bodyText: item.answer || '',
    groundingLinks: item.groundingLinks || [],
    audioBuffer: item.audioBuffer,
    localAudioBase64: item.audioBase64,
    error: item.error,
    ttsModel: item.ttsModel,
  };
};

export const scheduledRunToPlayerItem = (run: ScheduleRun): PlayerItem | null => {
  if (run.status !== 'success' || !run.audioPath) {
    return null;
  }

  const audioUrl = `/api/artifacts/${encodeURIComponent(run.audioPath)}`;

  return {
    id: `scheduled:${run.id}`,
    source: 'scheduled',
    title: shorten(run.resolvedPrompt || run.generatedText || run.id),
    timestamp: new Date(run.startedAt).getTime(),
    status: 'ready',
    promptText: run.resolvedPrompt || '',
    bodyText: run.generatedText || run.errorMessage || '',
    groundingLinks: run.groundingLinks || [],
    audioBuffer: null,
    audioUrl,
    downloadUrl: audioUrl,
    error: run.errorMessage,
  };
};
