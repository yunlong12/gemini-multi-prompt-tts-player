import { ItemStatus, PlayerItem, ProcessItem, ScheduleRun } from '../types';
import { formatPartLabel } from './ttsChunks';

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
  if ((!item.audioBuffer && !item.audioPath && !item.audioDownloadUrl && !item.audioParts?.length) || item.status === ItemStatus.ERROR) {
    return null;
  }

  const partLabel = !item.audioParts?.length ? formatPartLabel(item.partIndex, item.partCount) : '';
  const audioUrl = item.audioDownloadUrl || (item.audioPath ? `/api/artifacts/${encodeURIComponent(item.audioPath)}` : undefined);

  return {
    id: `manual:${item.id}`,
    source: 'manual',
    title: shorten(partLabel ? `${item.prompt} (${partLabel})` : item.prompt),
    timestamp: item.timestamp,
    audioParts: item.audioParts,
    partIndex: item.partIndex,
    partCount: item.partCount,
    partGroupId: item.partGroupId,
    status: 'ready',
    promptText: item.prompt,
    bodyText: item.answer || '',
    groundingLinks: item.groundingLinks || [],
    audioBuffer: item.audioBuffer,
    audioUrl,
    downloadUrl: audioUrl,
    localAudioBase64: item.audioBase64,
    error: item.error,
    ttsModel: item.ttsModel,
  };
};

export const scheduledRunToPlayerItem = (run: ScheduleRun): PlayerItem | null => {
  if (run.status !== 'success' || (!run.audioPath && !run.audioParts?.length)) {
    return null;
  }

  const audioUrl = run.audioPath ? `/api/artifacts/${encodeURIComponent(run.audioPath)}` : undefined;
  const partLabel = !run.audioParts?.length ? formatPartLabel(run.partIndex, run.partCount) : '';

  return {
    id: `scheduled:${run.id}`,
    source: 'scheduled',
    title: shorten(partLabel ? `${run.resolvedPrompt || run.generatedText || run.id} (${partLabel})` : (run.resolvedPrompt || run.generatedText || run.id)),
    timestamp: new Date(run.startedAt).getTime(),
    audioParts: run.audioParts,
    partIndex: run.partIndex,
    partCount: run.partCount,
    partGroupId: run.partGroupId,
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
