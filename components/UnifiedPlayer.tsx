import React, { useEffect, useRef, useState } from 'react';
import { Download, Link2, ListMusic, Pause, Play, PlayCircle, VolumeX } from 'lucide-react';
import { audioBufferToWavBlob } from '../utils/audioUtils';
import { manualItemToPlayerItem, scheduledRunToPlayerItem } from '../utils/playerItems';
import { ItemStatus, PlayerItem, ProcessItem, ScheduleRun } from '../types';
import { PersistedScheduledRun } from '../utils/storage';
import { formatPartLabel } from '../utils/ttsChunks';
type ScheduledAudioLoadState = 'idle' | 'queued' | 'downloading' | 'decoding' | 'cached' | 'error';

interface UnifiedPlayerProps {
  items: ProcessItem[];
  runs: ScheduleRun[];
  persistedScheduledRuns: Record<string, PersistedScheduledRun>;
  setItems: React.Dispatch<React.SetStateAction<ProcessItem[]>>;
  setSelectedItemId: React.Dispatch<React.SetStateAction<string | null>>;
  addLog: (msg: string) => void;
  autoplayRequestId: string | null;
  onAutoplayRequestHandled: () => void;
  scheduledAudioBuffersById: Record<string, AudioBuffer>;
  scheduledAudioLoadStateById: Record<string, ScheduledAudioLoadState>;
  scheduledAudioErrorsById: Record<string, string>;
  loadScheduledRunAudio: (runId: string) => Promise<AudioBuffer | null>;
}

const sourceLabel = (source: PlayerItem['source']) => (source === 'manual' ? 'Manual' : 'Scheduled');
const formatPlayerTimestamp = (timestamp: number) => new Date(timestamp).toLocaleString();
const formatTime = (seconds: number) =>
  !seconds || Number.isNaN(seconds) ? '0:00' : `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

const scheduledStatusLabel = (status: ScheduledAudioLoadState) => {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'downloading':
      return 'Downloading audio...';
    case 'decoding':
      return 'Decoding audio...';
    case 'cached':
      return 'Cached locally';
    case 'error':
      return 'Failed';
    default:
      return '';
  }
};

const scheduledStatusTone = (status: ScheduledAudioLoadState) => {
  switch (status) {
    case 'queued':
      return 'text-slate-400';
    case 'downloading':
    case 'decoding':
      return 'text-amber-300';
    case 'cached':
      return 'text-emerald-300';
    case 'error':
      return 'text-red-300';
    default:
      return 'text-slate-500';
  }
};

export const UnifiedPlayer: React.FC<UnifiedPlayerProps> = ({
  items,
  runs,
  persistedScheduledRuns,
  setItems,
  setSelectedItemId,
  addLog,
  autoplayRequestId,
  onAutoplayRequestHandled,
  scheduledAudioBuffersById,
  scheduledAudioLoadStateById,
  scheduledAudioErrorsById,
  loadScheduledRunAudio,
}) => {
  const [selectedPlayerItemId, setSelectedPlayerItemId] = useState<string | null>(null);
  const [checkedPlayerItemIds, setCheckedPlayerItemIds] = useState<Record<string, boolean>>({});
  const [currentlyPlayingPlayerItemId, setCurrentlyPlayingPlayerItemId] = useState<string | null>(null);
  const [playerProgress, setPlayerProgress] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [isPlayerPlaying, setIsPlayerPlaying] = useState(false);
  const [isPlayingSequence, setIsPlayingSequence] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playStartRef = useRef(0);
  const pauseOffsetRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const sequenceQueueRef = useRef<string[]>([]);
  const sequenceIndexRef = useRef(0);
  const groupCheckboxRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const getLocalDateKey = (timestamp: number) => {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatDateLabel = (timestamp: number) =>
    new Date(timestamp).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  const clearManualPlaybackState = () => {
    setItems((prev) => prev.map((item) => (item.status === ItemStatus.PLAYING ? { ...item, status: ItemStatus.READY } : item)));
  };

  const setManualPlaybackState = (playerItemId: string | null) => {
    const manualId = playerItemId?.startsWith('manual:') ? playerItemId.slice('manual:'.length) : null;
    setItems((prev) =>
      prev.map((item) => {
        if (item.status === ItemStatus.PLAYING || item.audioBuffer) {
          return {
            ...item,
            status: item.id === manualId ? ItemStatus.PLAYING : item.status === ItemStatus.ERROR ? ItemStatus.ERROR : ItemStatus.READY,
          };
        }
        return item;
      })
    );
  };

  const manualPlayerItems = items
    .map((item) => manualItemToPlayerItem(item))
    .filter((item): item is PlayerItem => Boolean(item))
    .map((item) => ({
      ...item,
      status: currentlyPlayingPlayerItemId === item.id ? 'playing' : 'ready',
    }));

  const scheduledPlayerItems = runs
    .map((run) => scheduledRunToPlayerItem(run))
    .filter((item): item is PlayerItem => Boolean(item))
    .map((item) => {
      const persistedRun = persistedScheduledRuns[item.id.replace('scheduled:', '')];
      const loadState =
        scheduledAudioLoadStateById[item.id] ||
        persistedRun?.cacheStatus ||
        (scheduledAudioBuffersById[item.id] ? 'cached' : 'idle');
      return {
        ...item,
        promptText: persistedRun?.resolvedPrompt || item.promptText,
        bodyText: persistedRun?.generatedText || item.bodyText,
        groundingLinks: persistedRun?.groundingLinks || item.groundingLinks,
        audioBuffer: scheduledAudioBuffersById[item.id] || null,
        error: scheduledAudioErrorsById[item.id] || persistedRun?.cacheError || item.error,
        status:
          currentlyPlayingPlayerItemId === item.id
            ? 'playing'
            : loadState === 'error'
              ? 'error'
              : loadState === 'cached'
                ? 'cached'
                : loadState === 'queued'
                  ? 'queued'
                  : loadState === 'downloading'
                    ? 'downloading'
                    : loadState === 'decoding'
                      ? 'decoding'
                      : 'ready',
      };
    });

  const playerItems = [...manualPlayerItems, ...scheduledPlayerItems].sort((a, b) => b.timestamp - a.timestamp || (a.partIndex || 1) - (b.partIndex || 1));
  const selectedPlayerItem = selectedPlayerItemId ? playerItems.find((item) => item.id === selectedPlayerItemId) || null : null;
  const selectedPlayerTitle = selectedPlayerItem
    ? `${selectedPlayerItem.promptText || selectedPlayerItem.title}${formatPartLabel(selectedPlayerItem.partIndex, selectedPlayerItem.partCount) ? ` (${formatPartLabel(selectedPlayerItem.partIndex, selectedPlayerItem.partCount)})` : ''}`
    : 'Nothing selected';
  const selectedPlayerCanPlay = Boolean(
    selectedPlayerItem &&
      (selectedPlayerItem.source === 'manual' ? selectedPlayerItem.audioBuffer : selectedPlayerItem.audioUrl) &&
      selectedPlayerItem.status !== 'error'
  );

  useEffect(() => {
    setCheckedPlayerItemIds((prev) => {
      const next: Record<string, boolean> = {};
      for (const item of playerItems) {
        next[item.id] = prev[item.id] ?? true;
      }
      return next;
    });
  }, [playerItems]);

  const playerGroups = playerItems.reduce<Array<{
    key: string;
    label: string;
    timestamp: number;
    items: PlayerItem[];
  }>>((groups, item) => {
    const key = getLocalDateKey(item.timestamp);
    const existing = groups[groups.length - 1];
    if (existing && existing.key === key) {
      existing.items.push(item);
      return groups;
    }

    groups.push({
      key,
      label: formatDateLabel(item.timestamp),
      timestamp: item.timestamp,
      items: [item],
    });
    return groups;
  }, []);

  useEffect(() => {
    playerGroups.forEach((group) => {
      const checkbox = groupCheckboxRefs.current[group.key];
      if (!checkbox) {
        return;
      }
      const selectedCount = group.items.filter((item) => checkedPlayerItemIds[item.id] ?? true).length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < group.items.length;
    });
  }, [playerGroups, checkedPlayerItemIds]);

  useEffect(() => {
    if (selectedPlayerItemId && !playerItems.some((item) => item.id === selectedPlayerItemId)) {
      setSelectedPlayerItemId(null);
      setPlayerDuration(0);
      setPlayerProgress(0);
    }
  }, [playerItems, selectedPlayerItemId]);

  const selectedForPlayAll = playerItems.filter((item) => checkedPlayerItemIds[item.id]);

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      addLog('[Audio] Creating AudioContext (24kHz).');
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioContextRef.current.state === 'suspended') {
      addLog('[Audio] AudioContext suspended, resuming.');
      void audioContextRef.current.resume();
    }
    return audioContextRef.current;
  };

  const stopProgressTracking = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stopCurrentSource = () => {
    if (!currentSourceRef.current) return;
    addLog('[Audio] Stopping current playback source.');
    currentSourceRef.current.onended = null;
    try {
      currentSourceRef.current.stop();
    } catch {}
    currentSourceRef.current = null;
  };

  const resetPlaybackFlags = () => {
    addLog('[Audio] Resetting playback state and sequence state.');
    stopProgressTracking();
    stopCurrentSource();
    pauseOffsetRef.current = 0;
    setPlayerProgress(0);
    setPlayerDuration(0);
    setIsPlayerPlaying(false);
    setIsPlayingSequence(false);
    setCurrentlyPlayingPlayerItemId(null);
    sequenceQueueRef.current = [];
    sequenceIndexRef.current = 0;
    clearManualPlaybackState();
  };

  const startProgressTracking = (duration: number) => {
    const ctx = getAudioContext();
    const update = () => {
      const elapsed = ctx.currentTime - playStartRef.current;
      const clamped = Math.min(duration, elapsed);
      setPlayerProgress(clamped);
      if (clamped < duration && currentSourceRef.current) {
        rafRef.current = requestAnimationFrame(update);
      }
    };
    stopProgressTracking();
    rafRef.current = requestAnimationFrame(update);
  };

  const advanceSequence = () => {
    const nextIndex = sequenceIndexRef.current + 1;
    if (nextIndex < sequenceQueueRef.current.length) {
      addLog(`[Audio] Sequence continuing with index ${nextIndex + 1}/${sequenceQueueRef.current.length}.`);
      sequenceIndexRef.current = nextIndex;
      void startPlayback(sequenceQueueRef.current[nextIndex], 0, true);
      return;
    }
    addLog('[Audio] Sequence playback completed.');
    setIsPlayingSequence(false);
    sequenceQueueRef.current = [];
    sequenceIndexRef.current = 0;
  };

  const resolvePlayerBuffer = async (playerItem: PlayerItem) => {
    if (playerItem.source === 'manual') {
      return playerItem.audioBuffer;
    }
    return loadScheduledRunAudio(playerItem.id.replace('scheduled:', ''));
  };

  const selectPlayerItem = async (playerItem: PlayerItem) => {
    resetPlaybackFlags();
    setSelectedPlayerItemId(playerItem.id);
    if (playerItem.source === 'manual') {
      setSelectedItemId(playerItem.id.slice('manual:'.length));
      setPlayerDuration(playerItem.audioBuffer?.duration || 0);
      return;
    }

    setSelectedItemId(null);
    setPlayerDuration(0);
    const buffer = await loadScheduledRunAudio(playerItem.id.replace('scheduled:', ''));
    if (buffer) {
      setPlayerDuration(buffer.duration);
    }
  };

  const startPlayback = async (playerItemId: string, startAt = 0, fromSequence = false) => {
    const target = playerItems.find((item) => item.id === playerItemId);
    if (!target) {
      addLog(`[Audio] Playback skipped: item ${playerItemId.slice(0, 12)} not found.`);
      return;
    }

    const buffer = await resolvePlayerBuffer(target);
    if (!buffer) {
      addLog(`[Audio] Playback skipped: item ${playerItemId.slice(0, 12)} has no playable audio.`);
      if (fromSequence || isPlayingSequence) {
        advanceSequence();
      }
      return;
    }

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    stopCurrentSource();
    stopProgressTracking();

    const clampedStart = Math.max(0, Math.min(startAt, buffer.duration));
    addLog(`[Audio] Starting playback for item ${playerItemId.slice(0, 12)} at ${clampedStart.toFixed(2)}s (sequence=${fromSequence}).`);
    pauseOffsetRef.current = clampedStart;
    playStartRef.current = ctx.currentTime - clampedStart;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    currentSourceRef.current = source;
    setSelectedPlayerItemId(playerItemId);
    setCurrentlyPlayingPlayerItemId(playerItemId);
    setPlayerDuration(buffer.duration);
    setPlayerProgress(clampedStart);
    setIsPlayerPlaying(true);

    if (target.source === 'manual') {
      setSelectedItemId(playerItemId.slice('manual:'.length));
      setManualPlaybackState(playerItemId);
    } else {
      setSelectedItemId(null);
      clearManualPlaybackState();
    }

    startProgressTracking(buffer.duration);

    source.onended = () => {
      addLog(`[Audio] Playback ended for item ${playerItemId.slice(0, 12)}.`);
      stopProgressTracking();
      setPlayerProgress(buffer.duration || 0);
      setIsPlayerPlaying(false);
      setCurrentlyPlayingPlayerItemId(null);
      pauseOffsetRef.current = 0;
      clearManualPlaybackState();
      currentSourceRef.current = null;
      if (isPlayingSequence || fromSequence) {
        advanceSequence();
      }
    };

    source.start(0, clampedStart);
  };

  const handlePause = () => {
    stopProgressTracking();
    pauseOffsetRef.current = playerProgress;
    stopCurrentSource();
    setIsPlayerPlaying(false);
    setCurrentlyPlayingPlayerItemId(null);
    clearManualPlaybackState();
  };

  const handleDownloadSelected = () => {
    if (!selectedPlayerItem) return;
    if (selectedPlayerItem.source === 'manual') {
      if (!selectedPlayerItem.audioBuffer) return;
      const blob = audioBufferToWavBlob(selectedPlayerItem.audioBuffer);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gemini-audio-${selectedPlayerItem.id.slice(0, 8)}.wav`;
      link.click();
      URL.revokeObjectURL(url);
      return;
    }
    if (!selectedPlayerItem.downloadUrl) return;
    const link = document.createElement('a');
    link.href = selectedPlayerItem.downloadUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.download = `${selectedPlayerItem.id.slice(0, 8)}.wav`;
    link.click();
  };

  useEffect(() => {
    if (!autoplayRequestId) return;
    const target = playerItems.find((item) => item.id === autoplayRequestId);
    if (target) {
      void startPlayback(target.id, 0, false);
    }
    onAutoplayRequestHandled();
  }, [autoplayRequestId, playerItems]);

  return (
    <div className="grid md:grid-cols-[280px,1fr] gap-4 mb-10">
      <div className="bg-slate-900 rounded-lg border border-slate-800 p-4">
        <div className="flex items-center gap-2 text-slate-300 font-semibold mb-3">
          <ListMusic size={18} /> Audio List
        </div>
        {!playerItems.length && <p className="text-sm text-slate-500">No playable audio yet. Generate a manual result or run a schedule.</p>}
        <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
          {playerGroups.map((group) => {
            const selectedCount = group.items.filter((item) => checkedPlayerItemIds[item.id] ?? true).length;
            const allSelected = group.items.length > 0 && selectedCount === group.items.length;

            return (
              <div key={group.key} className="space-y-2">
                <div className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <input
                      ref={(node) => {
                        groupCheckboxRefs.current[group.key] = node;
                      }}
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setCheckedPlayerItemIds((prev) => {
                          const next = { ...prev };
                          group.items.forEach((item) => {
                            next[item.id] = checked;
                          });
                          return next;
                        });
                      }}
                      className="h-4 w-4 accent-emerald-500"
                    />
                    <div>
                      <div className="text-sm font-semibold text-slate-200">{group.label}</div>
                      <div className="text-xs text-slate-500">{group.items.length} item(s)</div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">{selectedCount} selected</div>
                </div>

                {group.items.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-md border transition-colors ${
                      currentlyPlayingPlayerItemId === item.id
                        ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100'
                        : selectedPlayerItemId === item.id
                          ? 'border-blue-500/60 bg-blue-500/10 text-blue-100'
                          : 'border-slate-800 bg-slate-800/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <label className="flex items-start gap-3 px-3 py-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checkedPlayerItemIds[item.id] ?? true}
                        onChange={(e) => {
                          e.stopPropagation();
                          setCheckedPlayerItemIds((prev) => ({
                            ...prev,
                            [item.id]: e.target.checked,
                          }));
                        }}
                        className="mt-1 h-4 w-4 accent-emerald-500"
                      />
                      <button
                        type="button"
                        onClick={() => void selectPlayerItem(item)}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="text-sm font-semibold line-clamp-2">{item.title}</span>
                          <span
                            className={`shrink-0 text-[10px] uppercase tracking-wide px-2 py-1 rounded-full ${
                              item.source === 'manual'
                                ? 'bg-blue-950/40 text-blue-300 border border-blue-900/40'
                                : 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/40'
                            }`}
                          >
                            {sourceLabel(item.source)}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">{formatPlayerTimestamp(item.timestamp)}</div>
                        {item.source === 'scheduled' && item.status !== 'playing' && item.status !== 'ready' && (
                          <div className={`text-xs mt-1 ${scheduledStatusTone(item.status === 'error' ? 'error' : item.status)}`}>
                            {item.status === 'error' ? item.error || 'Audio unavailable' : scheduledStatusLabel(item.status)}
                          </div>
                        )}
                      </button>
                    </label>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900 rounded-lg border border-slate-800 p-6 flex flex-col gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Now Selected</p>
          <h3 className="text-lg font-semibold text-white break-words">{selectedPlayerTitle}</h3>
          {selectedPlayerItem && <div className="text-sm text-slate-400 mt-2">{sourceLabel(selectedPlayerItem.source)} | {formatPlayerTimestamp(selectedPlayerItem.timestamp)}</div>}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={
              isPlayerPlaying
                ? handlePause
                : () => {
                    const target = selectedPlayerItemId || playerItems[0]?.id;
                    if (target) {
                      setIsPlayingSequence(false);
                      void startPlayback(target, pauseOffsetRef.current, false);
                    }
                  }
            }
            disabled={!selectedPlayerCanPlay}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              selectedPlayerCanPlay ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            {isPlayerPlaying ? <><Pause size={18} /> Pause</> : <><PlayCircle size={18} /> Play</>}
          </button>
          <button
            onClick={() => {
              if (!selectedForPlayAll.length) return;
              sequenceQueueRef.current = selectedForPlayAll.map((item) => item.id);
              sequenceIndexRef.current = 0;
              setIsPlayingSequence(true);
              void startPlayback(sequenceQueueRef.current[0], 0, true);
            }}
            disabled={!selectedForPlayAll.length}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              selectedForPlayAll.length ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Play size={18} /> Play All
          </button>
          <button onClick={resetPlaybackFlags} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700 transition-colors">
            <VolumeX size={18} /> Stop
          </button>
          <button
            onClick={handleDownloadSelected}
            disabled={!selectedPlayerCanPlay}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              selectedPlayerCanPlay ? 'bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700' : 'bg-slate-800 text-slate-500 border border-slate-800 cursor-not-allowed'
            }`}
          >
            <Download size={18} /> Download
          </button>
        </div>

        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1">
            <span>{formatTime(playerProgress)}</span>
            <span>{formatTime(playerDuration)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={playerDuration || 1}
            step={0.1}
            value={Math.min(playerProgress, playerDuration || 0)}
            onChange={(e) => {
              const value = Math.max(0, Math.min(Number(e.target.value), playerDuration || 0));
              setPlayerProgress(value);
              pauseOffsetRef.current = value;
              if (isPlayerPlaying && selectedPlayerItemId) {
                void startPlayback(selectedPlayerItemId, value, isPlayingSequence);
              }
            }}
            disabled={!selectedPlayerCanPlay}
            className="w-full accent-emerald-500"
          />
        </div>

        {selectedPlayerItem ? (
          <div className="space-y-4">
            {selectedPlayerItem.groundingLinks?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedPlayerItem.groundingLinks.slice(0, 8).map((link, index) => (
                  <a
                    key={`${selectedPlayerItem.id}-${index}`}
                    href={link.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-300 bg-blue-950/20 border border-blue-900/30 rounded px-2 py-1"
                  >
                    <Link2 size={12} className="inline mr-1" />
                    {link.title}
                  </a>
                ))}
              </div>
            )}

            {selectedPlayerItem.source === 'scheduled' ? (
              <>
                <div className="bg-slate-800/70 border border-slate-700 rounded-md p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Generated Text</div>
                  <div className="text-sm text-slate-300 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
                    {selectedPlayerItem.bodyText || 'No generated text available.'}
                  </div>
                </div>
                <div className="bg-slate-800/50 border border-slate-700 rounded-md p-3">
                  <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Prompt</div>
                  <div className="text-sm text-slate-400 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
                    {selectedPlayerItem.promptText || 'No prompt available.'}
                  </div>
                </div>
              </>
            ) : (
              <div className="bg-slate-800/70 border border-slate-700 rounded-md p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Text</div>
                <div className="text-sm text-slate-300 whitespace-pre-wrap break-words min-h-[96px] max-h-80 overflow-y-auto">
                  {selectedPlayerItem.bodyText || 'Select an item to see its answer.'}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-400 bg-slate-800/70 border border-slate-700 rounded-md p-3 min-h-[96px]">
            Select an item to see its text and prompt.
          </div>
        )}
      </div>
    </div>
  );
};
