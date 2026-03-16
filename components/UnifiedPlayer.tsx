import React, { useEffect, useRef, useState } from 'react';
import { Download, Link2, ListMusic, Pause, Play, PlayCircle, VolumeX } from 'lucide-react';
import { arrayBufferToBase64, audioBufferToWavBlob, base64ToUint8Array } from '../utils/audioUtils';
import { manualItemToPlayerItem, scheduledRunToPlayerItem } from '../utils/playerItems';
import { AudioPart, ItemStatus, PlayerItem, PlayerQueueSegment, PlayerUiState, ProcessItem, ScheduleRun } from '../types';
import { PersistedScheduledRun } from '../utils/storage';
import { formatPartLabel } from '../utils/ttsChunks';

type ScheduledAudioLoadState = 'idle' | 'queued' | 'downloading' | 'decoding' | 'cached' | 'error';
type Segment = PlayerQueueSegment;

interface UnifiedPlayerProps {
  items: ProcessItem[];
  runs: ScheduleRun[];
  playerUiState: PlayerUiState;
  setPlayerUiState: React.Dispatch<React.SetStateAction<PlayerUiState>>;
  persistedScheduledRuns: Record<string, PersistedScheduledRun>;
  setPersistedScheduledRuns: React.Dispatch<React.SetStateAction<Record<string, PersistedScheduledRun>>>;
  setItems: React.Dispatch<React.SetStateAction<ProcessItem[]>>;
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  addLog: (msg: string) => void;
  autoplayRequestId: string | null;
  onAutoplayRequestHandled: () => void;
  scheduledAudioBuffersById: Record<string, AudioBuffer>;
  scheduledAudioLoadStateById: Record<string, ScheduledAudioLoadState>;
  scheduledAudioErrorsById: Record<string, string>;
  loadManualRunAudio: (itemId: string) => Promise<AudioBuffer | null>;
  loadScheduledRunAudio: (runId: string) => Promise<AudioBuffer | null>;
}

const sourceLabel = (source: PlayerItem['source']) => (source === 'manual' ? 'Manual' : 'Scheduled');
const formatPlayerTimestamp = (timestamp: number) => new Date(timestamp).toLocaleString();
const formatTime = (seconds: number) => !seconds || Number.isNaN(seconds) ? '0:00' : `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const sortAudioParts = (audioParts: AudioPart[] | undefined) => [...(audioParts || [])].sort((a, b) => a.partIndex - b.partIndex);
const canPlayPlayerItem = (item: PlayerItem | null) => Boolean(item && (item.audioBuffer || item.audioUrl || item.audioParts?.some((part) => part.audioPath)) && item.status !== 'error');
const canResolveQueueSegment = (item: PlayerItem | undefined, segment: Segment) => {
  if (!item) {
    return false;
  }
  if (segment.legacy) {
    return canPlayPlayerItem(item);
  }
  return Boolean(item.audioParts?.some((part) => part.partIndex === segment.partIndex && part.audioPath));
};

export const UnifiedPlayer: React.FC<UnifiedPlayerProps> = ({
  items, runs, playerUiState, setPlayerUiState, persistedScheduledRuns, setPersistedScheduledRuns, setItems, setSelectedItemId, addLog, autoplayRequestId, onAutoplayRequestHandled,
  scheduledAudioBuffersById, scheduledAudioLoadStateById, scheduledAudioErrorsById, loadManualRunAudio, loadScheduledRunAudio,
}) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const segmentCacheRef = useRef<Record<string, AudioBuffer>>({});
  const queueRef = useRef<Segment[]>(playerUiState.queue);
  const queueIndexRef = useRef(playerUiState.queueIndex);
  const pauseOffsetRef = useRef(playerUiState.pauseOffset);
  const isPlayingSequenceRef = useRef(playerUiState.isPlayingSequence);

  const {
    checkedPlayerItemIds,
    selectedPlayerItemId,
    expandedAudioPartKeys,
    currentlyPlayingPlayerItemId,
    currentlyPlayingPartIndex,
    playerProgress,
    playerDuration,
    isPlayerPlaying,
    isPlayingSequence,
  } = playerUiState;

  const patchPlayerUiState = (patch: Partial<PlayerUiState>) =>
    setPlayerUiState((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    queueRef.current = playerUiState.queue;
    queueIndexRef.current = playerUiState.queueIndex;
    pauseOffsetRef.current = playerUiState.pauseOffset;
    isPlayingSequenceRef.current = playerUiState.isPlayingSequence;
  }, [playerUiState]);

  const clearManualPlaybackState = () => setItems((prev) => prev.map((item) => (item.status === ItemStatus.PLAYING ? { ...item, status: ItemStatus.READY } : item)));
  const setManualPlaybackState = (playerItemId: string | null) => {
    const manualId = playerItemId?.startsWith('manual:') ? playerItemId.slice('manual:'.length) : null;
    setItems((prev) => prev.map((item) => ((item.audioBuffer || item.audioParts?.length || item.status === ItemStatus.PLAYING)
      ? { ...item, status: item.id === manualId ? ItemStatus.PLAYING : item.status === ItemStatus.ERROR ? ItemStatus.ERROR : ItemStatus.READY }
      : item)));
  };

  const manualPlayerItems = items.map(manualItemToPlayerItem).filter(Boolean).map((item) => ({ ...(item as PlayerItem), status: currentlyPlayingPlayerItemId === (item as PlayerItem).id ? 'playing' : 'ready' }));
  const scheduledPlayerItems = runs.map(scheduledRunToPlayerItem).filter(Boolean).map((raw) => {
    const item = raw as PlayerItem;
    const persistedRun = persistedScheduledRuns[item.id.replace('scheduled:', '')];
    const loadState = scheduledAudioLoadStateById[item.id] || persistedRun?.cacheStatus || (scheduledAudioBuffersById[item.id] ? 'cached' : 'idle');
    return {
      ...item,
      promptText: persistedRun?.resolvedPrompt || item.promptText,
      bodyText: persistedRun?.generatedText || item.bodyText,
      groundingLinks: persistedRun?.groundingLinks || item.groundingLinks,
      audioParts: item.audioParts || persistedRun?.audioParts,
      audioBuffer: scheduledAudioBuffersById[item.id] || null,
      error: scheduledAudioErrorsById[item.id] || persistedRun?.cacheError || item.error,
      status: currentlyPlayingPlayerItemId === item.id ? 'playing' : loadState === 'error' ? 'error' : loadState === 'cached' ? 'cached' : loadState === 'queued' ? 'queued' : loadState === 'downloading' ? 'downloading' : loadState === 'decoding' ? 'decoding' : 'ready',
    } satisfies PlayerItem;
  });
  const playerItems = [...manualPlayerItems, ...scheduledPlayerItems].sort((a, b) => b.timestamp - a.timestamp);
  const selectedPlayerItem = selectedPlayerItemId ? playerItems.find((item) => item.id === selectedPlayerItemId) || null : null;
  const playerItemIdsSignature = playerItems.map((item) => item.id).join('|');

  useEffect(() => {
    const playerItemsById = new Map(playerItems.map((item) => [item.id, item]));
    setPlayerUiState((prev) => {
      const nextChecked = Object.fromEntries(
        playerItems.map((item) => [item.id, Object.prototype.hasOwnProperty.call(prev.checkedPlayerItemIds, item.id) ? prev.checkedPlayerItemIds[item.id] : false])
      );
      const validIds = new Set(playerItems.map((item) => item.id));
      const nextSelectedPlayerItemId = prev.selectedPlayerItemId && validIds.has(prev.selectedPlayerItemId) ? prev.selectedPlayerItemId : null;
      const nextExpandedAudioPartKeys = nextSelectedPlayerItemId
        ? Object.fromEntries(
            Object.entries(prev.expandedAudioPartKeys).filter(([key]) => key.startsWith(`${nextSelectedPlayerItemId}:`))
          )
        : {};
      const nextQueue = prev.queue.filter((segment) => canResolveQueueSegment(playerItemsById.get(segment.playerItemId), segment));
      const nextQueueIndex = nextQueue.length ? Math.min(prev.queueIndex, nextQueue.length - 1) : 0;
      const currentSegment = prev.queue[prev.queueIndex] || null;
      const currentSegmentStillResolvable = currentSegment
        ? canResolveQueueSegment(playerItemsById.get(currentSegment.playerItemId), currentSegment)
        : false;
      const nextCurrentlyPlayingPlayerItemId =
        prev.currentlyPlayingPlayerItemId && validIds.has(prev.currentlyPlayingPlayerItemId)
          ? prev.currentlyPlayingPlayerItemId
          : currentSegmentStillResolvable
            ? currentSegment?.playerItemId || null
            : null;
      const shouldKeepPlaybackSession =
        prev.isPlayerPlaying &&
        ((prev.currentlyPlayingPlayerItemId && validIds.has(prev.currentlyPlayingPlayerItemId)) || currentSegmentStillResolvable);

      return {
        ...prev,
        checkedPlayerItemIds: nextChecked,
        selectedPlayerItemId: nextSelectedPlayerItemId,
        expandedAudioPartKeys: nextExpandedAudioPartKeys,
        queue: nextQueue,
        queueIndex: nextQueueIndex,
        currentlyPlayingPlayerItemId: nextCurrentlyPlayingPlayerItemId,
        currentlyPlayingPartIndex: nextCurrentlyPlayingPlayerItemId ? prev.currentlyPlayingPartIndex : null,
        playerProgress: nextSelectedPlayerItemId ? prev.playerProgress : 0,
        playerDuration: nextSelectedPlayerItemId ? prev.playerDuration : 0,
        pauseOffset: nextSelectedPlayerItemId ? prev.pauseOffset : 0,
        isPlayingSequence: nextQueue.length > 1 ? prev.isPlayingSequence : false,
        isPlayerPlaying: shouldKeepPlaybackSession,
      };
    });
  }, [playerItemIdsSignature]);

  const getAudioContext = () => {
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    if (audioContextRef.current.state === 'suspended') void audioContextRef.current.resume();
    return audioContextRef.current;
  };
  const stopProgressTracking = () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  const stopCurrentSource = () => { if (!currentSourceRef.current) return; currentSourceRef.current.onended = null; try { currentSourceRef.current.stop(); } catch {} currentSourceRef.current = null; };
  const resetPlaybackFlags = () => {
    stopProgressTracking();
    stopCurrentSource();
    pauseOffsetRef.current = 0;
    queueRef.current = [];
    queueIndexRef.current = 0;
    isPlayingSequenceRef.current = false;
    patchPlayerUiState({
      playerProgress: 0,
      playerDuration: 0,
      pauseOffset: 0,
      isPlayerPlaying: false,
      isPlayingSequence: false,
      currentlyPlayingPlayerItemId: null,
      currentlyPlayingPartIndex: null,
      queue: [],
      queueIndex: 0,
    });
    clearManualPlaybackState();
  };
  const pausePlaybackForSession = () => {
    stopProgressTracking();
    stopCurrentSource();
    const preservedProgress = Math.min(playerProgress, playerDuration || playerProgress);
    pauseOffsetRef.current = preservedProgress;
    patchPlayerUiState({
      playerProgress: preservedProgress,
      pauseOffset: preservedProgress,
      isPlayerPlaying: false,
      currentlyPlayingPlayerItemId,
      currentlyPlayingPartIndex,
    });
    clearManualPlaybackState();
  };
  const startProgressTracking = (duration: number) => {
    const ctx = getAudioContext();
    const update = () => {
      const elapsed = ctx.currentTime - playStartRef.current;
      const clamped = Math.min(duration, elapsed);
      patchPlayerUiState({ playerProgress: clamped });
      if (clamped < duration && currentSourceRef.current) rafRef.current = requestAnimationFrame(update);
    };
    stopProgressTracking(); rafRef.current = requestAnimationFrame(update);
  };

  const buildSegmentsForItem = (item: PlayerItem): Segment[] => item.audioParts?.length
    ? sortAudioParts(item.audioParts).filter((part) => part.audioPath).map((part) => ({ key: `${item.id}:${part.partIndex}`, playerItemId: item.id, partIndex: part.partIndex, partCount: part.partCount, audioPath: part.audioPath, legacy: false }))
    : [{ key: `${item.id}:single`, playerItemId: item.id, legacy: true }];

  const buildPlayableSelection = () => {
    const checkedItems = playerItems.filter((item) => checkedPlayerItemIds[item.id] === true);
    const playableItems = checkedItems.filter((item) => canPlayPlayerItem(item));
    const skippedItems = checkedItems.filter((item) => !canPlayPlayerItem(item));
    const segments = playableItems.flatMap((item) => buildSegmentsForItem(item));
    return {
      checkedItems,
      playableItems,
      skippedItems,
      segments,
    };
  };

  const loadSegmentBuffer = async (item: PlayerItem, segment: Segment) => {
    if (segment.legacy) {
      if (item.source === 'manual') {
        return item.audioBuffer || loadManualRunAudio(item.id.replace('manual:', ''));
      }
      return loadScheduledRunAudio(item.id.replace('scheduled:', ''));
    }
    if (segmentCacheRef.current[segment.key]) return segmentCacheRef.current[segment.key];
    if (!segment.audioPath) return null;
    const part = item.audioParts?.find((entry) => entry.partIndex === segment.partIndex);
    if (part?.audioBase64) {
      const bytes = base64ToUint8Array(part.audioBase64);
      const decoded = await getAudioContext().decodeAudioData(bytes.buffer.slice(0));
      segmentCacheRef.current[segment.key] = decoded;
      return decoded;
    }
    addLog(`[Player] Loading ${item.source} audio part ${segment.partIndex}/${segment.partCount} for ${segment.playerItemId.slice(0, 12)}.`);
    const response = await fetch(`/api/artifacts/${encodeURIComponent(segment.audioPath)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const decoded = await getAudioContext().decodeAudioData(arrayBuffer.slice(0));
    const audioBase64 = arrayBufferToBase64(arrayBuffer);
    if (item.source === 'manual') {
      const itemId = item.id.slice('manual:'.length);
      setItems((prev) => prev.map((entry) => entry.id === itemId ? ({
        ...entry,
        audioParts: entry.audioParts?.map((audioPart) => audioPart.partIndex === segment.partIndex ? { ...audioPart, audioBase64 } : audioPart),
      }) : entry));
    } else {
      const runId = item.id.slice('scheduled:'.length);
      setPersistedScheduledRuns((prev) => ({
        ...prev,
        [runId]: {
          ...prev[runId],
          audioParts: prev[runId]?.audioParts?.map((audioPart) => audioPart.partIndex === segment.partIndex ? { ...audioPart, audioBase64 } : audioPart)
            || item.audioParts?.map((audioPart) => audioPart.partIndex === segment.partIndex ? { ...audioPart, audioBase64 } : audioPart),
        },
      }));
    }
    segmentCacheRef.current[segment.key] = decoded;
    return decoded;
  };

  const startPlayback = async (segment: Segment, startAt = 0, fromQueue = false) => {
    const item = playerItems.find((entry) => entry.id === segment.playerItemId);
    if (!item) return;
    let buffer: AudioBuffer | null = null;
    try { buffer = await loadSegmentBuffer(item, segment); } catch (error: any) { addLog(`[Audio] Failed to load audio: ${error?.message || error}`); }
    if (!buffer) {
      const nextIndex = queueIndexRef.current + 1;
      if (fromQueue && nextIndex < queueRef.current.length) {
        queueIndexRef.current = nextIndex;
        patchPlayerUiState({ queueIndex: nextIndex });
        void startPlayback(queueRef.current[nextIndex], 0, true);
      }
      return;
    }
    const ctx = getAudioContext();
    stopCurrentSource(); stopProgressTracking();
    const clampedStart = Math.max(0, Math.min(startAt, buffer.duration));
    pauseOffsetRef.current = clampedStart; playStartRef.current = ctx.currentTime - clampedStart;
    const source = ctx.createBufferSource(); source.buffer = buffer; source.connect(ctx.destination); currentSourceRef.current = source;
    patchPlayerUiState({
      selectedPlayerItemId: segment.playerItemId,
      currentlyPlayingPlayerItemId: segment.playerItemId,
      currentlyPlayingPartIndex: segment.partIndex || null,
      playerDuration: buffer.duration,
      playerProgress: clampedStart,
      pauseOffset: clampedStart,
      isPlayerPlaying: true,
      queueIndex: queueIndexRef.current,
    });
    if (item.source === 'manual') { setSelectedItemId(segment.playerItemId.slice('manual:'.length)); setManualPlaybackState(segment.playerItemId); } else { setSelectedItemId(null); clearManualPlaybackState(); }
    startProgressTracking(buffer.duration);
    source.onended = () => {
      stopProgressTracking(); clearManualPlaybackState(); currentSourceRef.current = null;
      const completedProgress = buffer!.duration || 0;
      pauseOffsetRef.current = 0;
      const nextIndex = queueIndexRef.current + 1;
      if ((fromQueue || isPlayingSequenceRef.current) && nextIndex < queueRef.current.length) {
        queueIndexRef.current = nextIndex;
        patchPlayerUiState({
          playerProgress: completedProgress,
          isPlayerPlaying: false,
          pauseOffset: 0,
          queueIndex: nextIndex,
        });
        void startPlayback(queueRef.current[nextIndex], 0, true);
        return;
      }
      queueRef.current = [];
      queueIndexRef.current = 0;
      isPlayingSequenceRef.current = false;
      patchPlayerUiState({
        playerProgress: completedProgress,
        playerDuration: buffer!.duration || 0,
        pauseOffset: 0,
        isPlayerPlaying: false,
        currentlyPlayingPlayerItemId: null,
        currentlyPlayingPartIndex: null,
        isPlayingSequence: false,
        queue: [],
        queueIndex: 0,
      });
    };
    source.start(0, clampedStart);
  };

  const startSelectedItemPlayback = async (startFromPartIndex?: number) => {
    const target = selectedPlayerItemId ? playerItems.find((item) => item.id === selectedPlayerItemId) : playerItems[0];
    if (!target) return;
    const segments = buildSegmentsForItem(target);
    if (!segments.length) return;
    const startIndex = startFromPartIndex != null ? Math.max(0, segments.findIndex((segment) => segment.partIndex === startFromPartIndex)) : 0;
    queueRef.current = segments;
    queueIndexRef.current = startIndex;
    isPlayingSequenceRef.current = segments.length > 1;
    patchPlayerUiState({
      queue: segments,
      queueIndex: startIndex,
      isPlayingSequence: segments.length > 1,
    });
    await startPlayback(segments[startIndex], pauseOffsetRef.current, true);
  };

  const handlePause = () => {
    pausePlaybackForSession();
  };
  const handleDownloadSelected = () => {
    if (!selectedPlayerItem || selectedPlayerItem.audioParts?.length) return;
    if (selectedPlayerItem.source === 'manual') {
      if (selectedPlayerItem.audioBuffer) {
        const url = URL.createObjectURL(audioBufferToWavBlob(selectedPlayerItem.audioBuffer)); const link = document.createElement('a'); link.href = url; link.download = `gemini-audio-${selectedPlayerItem.id.slice(0, 8)}.wav`; link.click(); URL.revokeObjectURL(url); return;
      }
      if (!selectedPlayerItem.downloadUrl) return;
      const link = document.createElement('a'); link.href = selectedPlayerItem.downloadUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.download = `${selectedPlayerItem.id.slice(0, 8)}.wav`; link.click(); return;
    }
    if (!selectedPlayerItem.downloadUrl) return;
    const link = document.createElement('a'); link.href = selectedPlayerItem.downloadUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.download = `${selectedPlayerItem.id.slice(0, 8)}.wav`; link.click();
  };

  useEffect(() => {
    if (!autoplayRequestId) return;
    const target = playerItems.find((item) => item.id === autoplayRequestId);
    if (target) {
      patchPlayerUiState({ selectedPlayerItemId: target.id, pauseOffset: 0 });
      pauseOffsetRef.current = 0;
      void startSelectedItemPlayback();
    }
    onAutoplayRequestHandled();
  }, [autoplayRequestId, playerItems]);

  useEffect(() => () => {
    stopProgressTracking();
    stopCurrentSource();
    clearManualPlaybackState();
  }, []);

  const playerGroups = playerItems.reduce<Array<{ key: string; label: string; items: PlayerItem[] }>>((groups, item) => {
    const key = new Date(item.timestamp).toLocaleDateString('sv-SE');
    const existing = groups[groups.length - 1];
    if (existing && existing.key === key) { existing.items.push(item); return groups; }
    groups.push({ key, label: new Date(item.timestamp).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }), items: [item] });
    return groups;
  }, []);
  const playAllSelection = buildPlayableSelection();
  const selectedPlayerCanPlay = canPlayPlayerItem(selectedPlayerItem);
  const handlePlayAllSelected = () => {
    const { checkedItems, playableItems, skippedItems, segments } = playAllSelection;
    if (!checkedItems.length) {
      addLog('[Audio] Play All Selected skipped: no checked items.');
      return;
    }
    if (!playableItems.length || !segments.length) {
      addLog(`[Audio] Play All Selected skipped: ${checkedItems.length} checked item(s), 0 playable.`);
      return;
    }
    addLog(
      `[Audio] Play All Selected requested: checked=${checkedItems.length}, playable=${playableItems.length}, segments=${segments.length}, skipped=${skippedItems.length}.`
    );
    queueRef.current = segments;
    queueIndexRef.current = 0;
    isPlayingSequenceRef.current = queueRef.current.length > 1;
    patchPlayerUiState({
      selectedPlayerItemId: segments[0]?.playerItemId || null,
      queue: segments,
      queueIndex: 0,
      isPlayingSequence: queueRef.current.length > 1,
      pauseOffset: 0,
    });
    pauseOffsetRef.current = 0;
    void startPlayback(queueRef.current[0], 0, true);
  };
  const toggleAudioPartExpanded = (partKey: string) => {
    setPlayerUiState((prev) => ({
      ...prev,
      expandedAudioPartKeys: {
        ...prev.expandedAudioPartKeys,
        [partKey]: !prev.expandedAudioPartKeys[partKey],
      },
    }));
  };

  return (
    <div className="mb-10 grid gap-4 xl:grid-cols-[minmax(0,320px),1fr]">
      <div className="rounded-[1.5rem] border border-slate-800 bg-slate-900 p-4 shadow-[0_20px_54px_-36px_rgba(15,23,42,0.95)]">
        <div className="mb-3 flex items-center gap-2 text-slate-300 font-semibold"><ListMusic size={18} /> Audio List</div>
        <button
          onClick={handlePlayAllSelected}
          disabled={!playAllSelection.playableItems.length}
          className={`mb-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-2 font-semibold ${
            playAllSelection.playableItems.length ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          }`}
        >
          <Play size={18} /> Play All Selected
        </button>
        {!playerItems.length && <p className="text-sm text-slate-500">No playable audio yet. Generate a manual result or run a schedule.</p>}
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1 xl:max-h-[520px]">
          {playerGroups.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2">
                <div className="text-sm font-semibold text-slate-200">{group.label}</div>
                <div className="text-xs text-slate-500">{group.items.length} item(s)</div>
              </div>
              {group.items.map((item) => (
                <div key={item.id} className={`rounded-xl border ${currentlyPlayingPlayerItemId === item.id ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100' : selectedPlayerItemId === item.id ? 'border-blue-500/60 bg-blue-500/10 text-blue-100' : 'border-slate-800 bg-slate-800/50 text-slate-300 hover:border-slate-700'}`}>
                  <label className="flex items-start gap-3 px-3 py-3 cursor-pointer">
                    <input type="checkbox" aria-label={`Select player item ${item.title}`} checked={checkedPlayerItemIds[item.id] ?? false} onChange={(e) => setPlayerUiState((prev) => ({ ...prev, checkedPlayerItemIds: { ...prev.checkedPlayerItemIds, [item.id]: e.target.checked } }))} className="mt-1 h-4 w-4 accent-emerald-500" />
                    <button type="button" onClick={() => { resetPlaybackFlags(); patchPlayerUiState({ selectedPlayerItemId: item.id }); void (item.source === 'scheduled' && !item.audioParts?.length ? loadScheduledRunAudio(item.id.replace('scheduled:', '')) : Promise.resolve()); }} className="flex-1 min-w-0 text-left">
                      <div className="flex items-start justify-between gap-2 mb-1"><span className="text-sm font-semibold line-clamp-2">{item.title}</span><span className={`shrink-0 text-[10px] uppercase tracking-wide px-2 py-1 rounded-full ${item.source === 'manual' ? 'bg-blue-950/40 text-blue-300 border border-blue-900/40' : 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/40'}`}>{sourceLabel(item.source)}</span></div>
                      <div className="text-xs text-slate-500">{formatPlayerTimestamp(item.timestamp)}</div>
                      {item.audioParts?.length ? <div className="text-xs mt-1 text-slate-400">{item.audioParts.length} part(s)</div> : null}
                      {item.source === 'scheduled' && item.status !== 'playing' && item.status !== 'ready' && !item.audioParts?.length ? <div className={`text-xs mt-1 ${item.status === 'error' ? 'text-red-300' : item.status === 'cached' ? 'text-emerald-300' : item.status === 'downloading' || item.status === 'decoding' ? 'text-amber-300' : 'text-slate-400'}`}>{item.status === 'error' ? item.error || 'Audio unavailable' : item.status === 'cached' ? 'Cached locally' : item.status === 'downloading' ? 'Downloading audio...' : item.status === 'decoding' ? 'Decoding audio...' : item.status === 'queued' ? 'Queued' : ''}</div> : null}
                    </button>
                  </label>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-[1.5rem] border border-slate-800 bg-slate-900 p-4 shadow-[0_20px_54px_-36px_rgba(15,23,42,0.95)] sm:p-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Now Selected</p>
          <h3 className="text-lg font-semibold text-white break-words">{selectedPlayerItem ? (selectedPlayerItem.promptText || selectedPlayerItem.title) : 'Nothing selected'}</h3>
          {selectedPlayerItem ? <div className="text-sm text-slate-400 mt-2">{sourceLabel(selectedPlayerItem.source)} | {formatPlayerTimestamp(selectedPlayerItem.timestamp)}{currentlyPlayingPartIndex ? ` | ${formatPartLabel(currentlyPlayingPartIndex, selectedPlayerItem.audioParts?.length || currentlyPlayingPartIndex)}` : ''}</div> : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <button onClick={isPlayerPlaying ? handlePause : () => { void startSelectedItemPlayback(); }} disabled={!selectedPlayerCanPlay} className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-4 py-2 font-semibold ${selectedPlayerCanPlay ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}>{isPlayerPlaying ? <><Pause size={18} /> Pause</> : <><PlayCircle size={18} /> Play</>}</button>
          <button onClick={resetPlaybackFlags} className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-300 hover:bg-slate-700"><VolumeX size={18} /> Stop</button>
          <button onClick={handleDownloadSelected} disabled={!selectedPlayerItem || !selectedPlayerCanPlay || Boolean(selectedPlayerItem.audioParts?.length)} className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl px-4 py-2 font-semibold ${selectedPlayerItem && selectedPlayerCanPlay && !selectedPlayerItem.audioParts?.length ? 'bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700' : 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'}`}><Download size={18} /> Download</button>
        </div>

        {selectedPlayerItem && !isPlayerPlaying && playerProgress > 0 && (
          <div className="rounded-md border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
            Playback paused at {formatTime(playerProgress)}
            {currentlyPlayingPartIndex ? ` • ${formatPartLabel(currentlyPlayingPartIndex, selectedPlayerItem.audioParts?.length || currentlyPlayingPartIndex)}` : ''}
          </div>
        )}

        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1"><span>{formatTime(playerProgress)}</span><span>{formatTime(playerDuration)}</span></div>
          <input type="range" min={0} max={playerDuration || 1} step={0.1} value={Math.min(playerProgress, playerDuration || 0)} onChange={(e) => { const value = Math.max(0, Math.min(Number(e.target.value), playerDuration || 0)); pauseOffsetRef.current = value; patchPlayerUiState({ playerProgress: value, pauseOffset: value }); const segment = queueRef.current[queueIndexRef.current]; if (isPlayerPlaying && segment) void startPlayback(segment, value, queueRef.current.length > 1); }} disabled={!selectedPlayerCanPlay} className="w-full accent-emerald-500" />
        </div>

        {selectedPlayerItem ? (
          <div className="space-y-4">
            {selectedPlayerItem.groundingLinks?.length > 0 ? <div className="flex flex-wrap gap-2">{selectedPlayerItem.groundingLinks.slice(0, 8).map((link, index) => <a key={`${selectedPlayerItem.id}-${index}`} href={link.uri} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-300 bg-blue-950/20 border border-blue-900/30 rounded px-2 py-1"><Link2 size={12} className="inline mr-1" />{link.title}</a>)}</div> : null}
            <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-3"><div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Generated Text</div><div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-300">{selectedPlayerItem.bodyText || 'No generated text available.'}</div></div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3"><div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Prompt</div><div className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-400">{selectedPlayerItem.promptText || 'No prompt available.'}</div></div>
            {selectedPlayerItem.audioParts?.length ? (
              <div className="bg-slate-800/50 border border-slate-700 rounded-md p-3 sm:p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Audio Parts</div>
                  <div className="text-[11px] text-slate-500">{selectedPlayerItem.audioParts.length} segment(s)</div>
                </div>
                {sortAudioParts(selectedPlayerItem.audioParts).map((part) => {
                  const partKey = `${selectedPlayerItem.id}:${part.partIndex}`;
                  const isExpanded = Boolean(expandedAudioPartKeys[partKey]);
                  const previewText = part.text || 'No part text available.';
                  const shouldClamp = previewText.length > 220;

                  return (
                    <div
                      key={`${selectedPlayerItem.id}-${part.partIndex}`}
                      className="rounded-2xl border border-slate-700/90 bg-gradient-to-br from-slate-950/90 to-slate-900/60 p-3 sm:p-4 shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]"
                    >
                      <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="inline-flex items-center rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
                              {formatPartLabel(part.partIndex, part.partCount)}
                            </div>
                            <div className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                              Sequential playback segment
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto sm:min-w-[240px]">
                            <button
                              type="button"
                              onClick={() => { patchPlayerUiState({ selectedPlayerItemId: selectedPlayerItem.id, pauseOffset: 0 }); pauseOffsetRef.current = 0; void startSelectedItemPlayback(part.partIndex); }}
                              className="w-full px-3 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-950/40"
                            >
                              Play Here
                            </button>
                            {part.audioPath ? (
                              <a
                                href={`/api/artifacts/${encodeURIComponent(part.audioPath)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-full inline-flex items-center justify-center px-3 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 border border-slate-700 text-slate-100 hover:bg-slate-700"
                              >
                                Download
                              </a>
                            ) : (
                              <div className="w-full inline-flex items-center justify-center px-3 py-2.5 rounded-xl text-sm font-semibold bg-slate-900/70 border border-slate-800 text-slate-500">
                                No file
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 px-3 py-3">
                          <div
                            className={`text-[13px] sm:text-xs text-slate-300 break-words leading-6 sm:leading-5 whitespace-pre-wrap ${
                              !isExpanded && shouldClamp ? 'line-clamp-5 sm:line-clamp-4' : ''
                            }`}
                          >
                            {previewText}
                          </div>
                          {shouldClamp ? (
                            <button
                              type="button"
                              onClick={() => toggleAudioPartExpanded(partKey)}
                              className="mt-3 inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300 hover:text-cyan-200"
                            >
                              {isExpanded ? 'Collapse' : 'Expand'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : <div className="text-sm text-slate-400 bg-slate-800/70 border border-slate-700 rounded-md p-3 min-h-[96px]">Select an item to see its text and prompt.</div>}
      </div>
    </div>
  );
};
