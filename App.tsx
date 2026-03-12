import React, { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { AlertTriangle, CalendarClock, CheckSquare, ListMusic, PlayCircle, Square, Terminal, Trash2 } from 'lucide-react';
import { InputSection } from './components/InputSection';
import { LoginForm } from './components/LoginForm';
import { ResultCard } from './components/ResultCard';
import { RunHistoryList } from './components/RunHistoryList';
import { ScheduleForm } from './components/ScheduleForm';
import { ScheduleList } from './components/ScheduleList';
import { UnifiedPlayer } from './components/UnifiedPlayer';
import {
  createSchedule as createScheduleApi,
  deleteRun as deleteRunApi,
  deleteSchedule as deleteScheduleApi,
  fetchAuthSession,
  fetchRuns,
  fetchSchedules,
  fetchSchedulerConfig,
  login,
  logout as logoutApi,
  runScheduleNow,
  updateSchedule as updateScheduleApi,
  updateSchedulerConfig as updateSchedulerConfigApi,
} from './services/adminApi';
import { generateSpeech, generateTextAnswer } from './services/geminiService';
import { AuthSession, GeminiToolOptions, ItemStatus, ProcessItem, Schedule, SchedulerConfig, ScheduleRun } from './types';
import { arrayBufferToBase64, base64ToUint8Array, decodeAudioData } from './utils/audioUtils';
import { clearPersistedState, loadPersistedState, PersistedScheduledRun, PersistedState, savePersistedState } from './utils/storage';
import { formatPartLabel, splitTextForTTS } from './utils/ttsChunks';

const ONE_HOUR_MS = 3600000;
const DEFAULT_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const DEFAULT_TOOL_OPTIONS: Required<GeminiToolOptions> = {
  enableGoogleSearch: true,
  enableUrlContext: false,
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const POLLING_PRESETS = [1, 5, 10, 15, 30, 60];
type RateLimitScope = 'login' | 'text' | 'tts';
type ScheduledAudioLoadState = 'idle' | 'queued' | 'downloading' | 'decoding' | 'cached' | 'error';

const cronToMinutes = (cron: string): number | null => {
  const normalized = String(cron || '').trim();
  if (!normalized) return null;
  if (normalized === '0 * * * *') return 60;
  const stepMatch = normalized.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  if (stepMatch) {
    const minutes = Number(stepMatch[1]);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : null;
  }
  return null;
};

const minutesToCron = (minutes: number): string => {
  const safeMinutes = Math.max(1, Math.min(60, Math.floor(minutes)));
  return safeMinutes === 60 ? '0 * * * *' : `*/${safeMinutes} * * * *`;
};

const getLocalDateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatHistoryDateLabel = (timestamp: number) =>
  new Date(timestamp).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const App: React.FC = () => {
  const [items, setItems] = useState<ProcessItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'results' | 'player' | 'history' | 'schedules' | 'runs'>('results');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [playerAutoplayRequestId, setPlayerAutoplayRequestId] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isProcessingActive, setIsProcessingActive] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isAuthBootstrapping, setIsAuthBootstrapping] = useState(true);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isAdminRefreshing, setIsAdminRefreshing] = useState(false);
  const [isScheduleSaving, setIsScheduleSaving] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [persistedScheduledRuns, setPersistedScheduledRuns] = useState<Record<string, PersistedScheduledRun>>({});
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig | null>(null);
  const [schedulerIntervalMinutesDraft, setSchedulerIntervalMinutesDraft] = useState(5);
  const [schedulerTimezoneDraft, setSchedulerTimezoneDraft] = useState('Europe/Paris');
  const [isSchedulerSaving, setIsSchedulerSaving] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [selectedHistoryEntryIds, setSelectedHistoryEntryIds] = useState<Set<string>>(new Set());
  const [scheduledAudioBuffersById, setScheduledAudioBuffersById] = useState<Record<string, AudioBuffer>>({});
  const [scheduledAudioLoadStateById, setScheduledAudioLoadStateById] = useState<Record<string, ScheduledAudioLoadState>>({});
  const [scheduledAudioErrorsById, setScheduledAudioErrorsById] = useState<Record<string, string>>({});
  const [rateLimitWarnings, setRateLimitWarnings] = useState<Record<RateLimitScope, string>>({
    login: '',
    text: '',
    tts: '',
  });
  const stopProcessingRef = useRef(false);
  const processingQueueRef = useRef<string[]>([]);
  const isWorkerRunningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef<ProcessItem[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const scheduledAudioLoadPromisesRef = useRef<Record<string, Promise<AudioBuffer | null>>>({});
  const scheduledAudioHydrationRef = useRef<Record<string, Promise<void>>>({});
  const scheduledPrefetchedIdsRef = useRef<Record<string, boolean>>({});
  const scheduledPrefetchRunningRef = useRef(false);
  const scheduledPrefetchCycleRef = useRef(0);

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  const isAdminAuthenticated = Boolean(authSession);
  const isUnauthorizedError = (error: unknown) =>
    String((error as Error | undefined)?.message || '').toLowerCase().includes('unauthorized');
  const isRateLimitError = (error: unknown) => Number((error as Error & { status?: number } | undefined)?.status) === 429;
  const setRateLimitWarning = (scope: RateLimitScope, message: string) =>
    setRateLimitWarnings((prev) => ({ ...prev, [scope]: message }));
  const clearRateLimitWarning = (scope: RateLimitScope) =>
    setRateLimitWarnings((prev) => (prev[scope] ? { ...prev, [scope]: '' } : prev));
  const activeRateLimitWarnings = (Object.entries(rateLimitWarnings) as [RateLimitScope, string][])
    .filter(([, message]) => Boolean(message));
  const generationWarningMessage = [rateLimitWarnings.text, rateLimitWarnings.tts].filter(Boolean).join(' ');
  const historyGroupCheckboxRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const updateHistorySelection = (entryId: string, checked: boolean) =>
    setSelectedHistoryEntryIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  const setHistoryDateSelection = (entryIds: string[], checked: boolean) =>
    setSelectedHistoryEntryIds((prev) => {
      const next = new Set(prev);
      entryIds.forEach((entryId) => {
        if (checked) next.add(entryId);
        else next.delete(entryId);
      });
      return next;
    });

  const clearAdminSession = () => {
    addLog('[Auth] Clearing admin session and cached admin data.');
    setAuthSession(null);
    setSchedules([]);
    setRuns([]);
    setSchedulerConfig(null);
    setSchedulerIntervalMinutesDraft(5);
    setSchedulerTimezoneDraft('Europe/Paris');
    setEditingSchedule(null);
  };
  const clearScheduledAudioState = (runId: string) => {
    const playerItemId = `scheduled:${runId}`;
    setScheduledAudioBuffersById((prev) => {
      if (!prev[playerItemId]) return prev;
      const next = { ...prev };
      delete next[playerItemId];
      return next;
    });
    setScheduledAudioLoadStateById((prev) => {
      if (!prev[playerItemId]) return prev;
      const next = { ...prev };
      delete next[playerItemId];
      return next;
    });
    setScheduledAudioErrorsById((prev) => {
      if (!prev[playerItemId]) return prev;
      const next = { ...prev };
      delete next[playerItemId];
      return next;
    });
    delete scheduledAudioLoadPromisesRef.current[playerItemId];
    delete scheduledAudioHydrationRef.current[playerItemId];
    delete scheduledPrefetchedIdsRef.current[playerItemId];
  };

  const refreshAdminData = async () => {
    if (!isAdminAuthenticated) {
      addLog('[Admin] Skipped refresh because admin session is missing.');
      return;
    }
    addLog('[Admin] Refreshing schedules/runs/scheduler config...');
    setIsAdminRefreshing(true);
    setAdminError('');
    try {
      const [nextSchedules, nextRuns] = await Promise.all([
        fetchSchedules(),
        fetchRuns(),
      ]);
      setSchedules(nextSchedules);
      setRuns(nextRuns);
      addLog(`[Admin] Refreshed ${nextSchedules.length} schedule(s) and ${nextRuns.length} run(s).`);
      try {
        const nextSchedulerConfig = await fetchSchedulerConfig();
        setSchedulerConfig(nextSchedulerConfig);
        setSchedulerIntervalMinutesDraft(cronToMinutes(nextSchedulerConfig.schedule || '') || 5);
        setSchedulerTimezoneDraft(nextSchedulerConfig.timeZone || 'Europe/Paris');
        addLog(`[Admin] Scheduler config loaded: ${nextSchedulerConfig.schedule} (${nextSchedulerConfig.timeZone}).`);
      } catch (schedulerError: any) {
        setSchedulerConfig(null);
        setSchedulerIntervalMinutesDraft(5);
        if (!schedulerTimezoneDraft) setSchedulerTimezoneDraft('Europe/Paris');
        addLog(`Scheduler config unavailable: ${schedulerError?.message || schedulerError}`);
      }
    } catch (error: any) {
      addLog(`[Admin] Refresh failed: ${error?.message || error}`);
      if (isUnauthorizedError(error)) {
        clearAdminSession();
      }
      setAdminError(error?.message || 'Failed to refresh admin data');
    } finally {
      setIsAdminRefreshing(false);
    }
  };

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { addLog(`[UI] Active tab changed to "${activeTab}".`); }, [activeTab]);
  useEffect(() => {
    const bootstrapAuth = async () => {
      try {
        const session = await fetchAuthSession();
        addLog(`[Auth] Restored admin session from cookie, expires at ${session.expiresAt}.`);
        setAuthSession(session);
      } catch (error) {
        if (isUnauthorizedError(error)) {
          addLog('[Auth] No valid admin session cookie found.');
          return;
        }
        addLog(`[Auth] Failed to restore admin session: ${(error as Error)?.message || error}`);
      } finally {
        setIsAuthBootstrapping(false);
      }
    };
    void bootstrapAuth();
  }, []);
  useEffect(() => { if (isAdminAuthenticated) void refreshAdminData(); }, [isAdminAuthenticated]);
  useEffect(() => {
    const loadState = async () => {
      try {
          const persisted = await loadPersistedState();
          if (persisted) {
            addLog(`[Storage] Found persisted state with ${persisted.items?.length || 0} item(s).`);
            const ctx = getAudioContext();
          const hydratedItems: ProcessItem[] = await Promise.all((persisted.items || []).map(async (item) => {
            let audioBuffer: AudioBuffer | null = null;
            if (item.audioBase64) {
              try { audioBuffer = await decodeAudioData(item.audioBase64, ctx, () => {}); } catch {}
            }
            let status = item.status as ItemStatus;
            let error = item.error;
            if (status === ItemStatus.GENERATING_TEXT || status === ItemStatus.GENERATING_AUDIO) { status = ItemStatus.ERROR; error = error || 'Process interrupted (page refresh or crash)'; }
            else if (status === ItemStatus.PLAYING) status = ItemStatus.READY;
            if (audioBuffer && status !== ItemStatus.ERROR) status = ItemStatus.READY;
            return { id: item.id, prompt: item.prompt, answer: item.answer, groundingLinks: item.groundingLinks || [], audioBuffer, audioBase64: item.audioBase64, ttsModel: item.ttsModel, enableGoogleSearch: item.enableGoogleSearch ?? DEFAULT_TOOL_OPTIONS.enableGoogleSearch, enableUrlContext: item.enableUrlContext ?? DEFAULT_TOOL_OPTIONS.enableUrlContext, partIndex: item.partIndex, partCount: item.partCount, partGroupId: item.partGroupId, error, status, timestamp: item.timestamp || persisted.updatedAt };
          }));
          setItems((prev) => {
            const unique = new Map<string, ProcessItem>();
            [...hydratedItems, ...prev].forEach((item) => unique.set(item.id, item));
            return Array.from(unique.values()).sort((a, b) => b.timestamp - a.timestamp || (a.partIndex || 1) - (b.partIndex || 1));
          });
          setPersistedScheduledRuns(
            Object.fromEntries((persisted.scheduledRuns || []).map((run) => [run.id, run]))
          );
          addLog('Loaded saved session from IndexedDB.');
        }
        if (!persisted) addLog('[Storage] No persisted state found.');
      } catch (e: any) {
        addLog(`Failed to load saved data: ${e.message || e}`);
      } finally {
        setIsHydrating(false);
      }
    };
    void loadState();
  }, []);
  useEffect(() => {
    if (isHydrating) return;
    const timeout = setTimeout(async () => {
      const state: PersistedState = {
        items: items.map((item) => ({ id: item.id, prompt: item.prompt, answer: item.answer, groundingLinks: item.groundingLinks, audioBase64: item.audioBase64, ttsModel: item.ttsModel, enableGoogleSearch: item.enableGoogleSearch, enableUrlContext: item.enableUrlContext, partIndex: item.partIndex, partCount: item.partCount, partGroupId: item.partGroupId, error: item.error, status: item.status, timestamp: item.timestamp })),
        scheduledRuns: Object.values(persistedScheduledRuns),
        recentPrompts: [],
        updatedAt: Date.now(),
      };
      try { await savePersistedState(state); } catch (e: any) { addLog(`Persistence Error: ${e.message || e}`); }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [items, isHydrating, persistedScheduledRuns]);

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
  const loadScheduledRunAudio = async (runId: string): Promise<AudioBuffer | null> => {
    const playerItemId = `scheduled:${runId}`;
    const matchingRun = runs.find((run) => run.id === runId) || persistedScheduledRuns[runId];
    const audioPath = 'audioPath' in (matchingRun || {}) ? matchingRun?.audioPath : undefined;
    if (!audioPath) {
      return null;
    }
    if (scheduledAudioBuffersById[playerItemId]) {
      return scheduledAudioBuffersById[playerItemId];
    }
    if (scheduledAudioLoadPromisesRef.current[playerItemId]) {
      return scheduledAudioLoadPromisesRef.current[playerItemId];
    }

    const promise = (async () => {
      try {
        addLog(`[Player] Loading scheduled audio for ${playerItemId.slice(0, 12)}.`);
        setScheduledAudioLoadStateById((prev) => ({ ...prev, [playerItemId]: 'downloading' }));
        setScheduledAudioErrorsById((prev) => {
          const next = { ...prev };
          delete next[playerItemId];
          return next;
        });
        setPersistedScheduledRuns((prev) => ({
          ...prev,
          [runId]: {
            ...prev[runId],
            ...(matchingRun || {}),
            cacheStatus: 'downloading',
            cacheError: '',
          },
        }));
        const response = await fetch(`/api/artifacts/${encodeURIComponent(audioPath)}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        setScheduledAudioLoadStateById((prev) => ({ ...prev, [playerItemId]: 'decoding' }));
        setPersistedScheduledRuns((prev) => ({
          ...prev,
          [runId]: {
            ...prev[runId],
            ...(matchingRun || {}),
            cacheStatus: 'decoding',
            cacheError: '',
          },
        }));
        const audioWavBase64 = arrayBufferToBase64(arrayBuffer);
        const decoded = await getAudioContext().decodeAudioData(arrayBuffer.slice(0));
        setScheduledAudioBuffersById((prev) => ({ ...prev, [playerItemId]: decoded }));
        setScheduledAudioLoadStateById((prev) => ({ ...prev, [playerItemId]: 'cached' }));
        setPersistedScheduledRuns((prev) => ({
          ...prev,
          [runId]: {
            ...prev[runId],
            ...(matchingRun || {}),
            audioWavBase64,
            cacheStatus: 'cached',
            cacheError: '',
          },
        }));
        addLog(`[Player] Scheduled audio ready (${decoded.duration.toFixed(2)}s).`);
        return decoded;
      } catch (error: any) {
        const message = error?.message || 'Failed to load scheduled audio';
        setScheduledAudioLoadStateById((prev) => ({ ...prev, [playerItemId]: 'error' }));
        setScheduledAudioErrorsById((prev) => ({ ...prev, [playerItemId]: message }));
        setPersistedScheduledRuns((prev) => ({
          ...prev,
          [runId]: {
            ...prev[runId],
            ...(matchingRun || {}),
            cacheStatus: 'failed',
            cacheError: message,
          },
        }));
        addLog(`[Player] Scheduled audio load failed: ${message}`);
        return null;
      } finally {
        delete scheduledAudioLoadPromisesRef.current[playerItemId];
      }
    })();

    scheduledAudioLoadPromisesRef.current[playerItemId] = promise;
    return promise;
  };

  useEffect(() => {
    const hydratePersistedAudio = async (runId: string, persistedRun: PersistedScheduledRun) => {
      const playerItemId = `scheduled:${runId}`;
      if (!persistedRun.audioWavBase64 || scheduledAudioBuffersById[playerItemId]) {
        return;
      }
      if (scheduledAudioHydrationRef.current[playerItemId]) {
        return scheduledAudioHydrationRef.current[playerItemId];
      }

      const promise = (async () => {
        try {
          setScheduledAudioLoadStateById((prev) => ({ ...prev, [playerItemId]: 'decoding' }));
          const bytes = base64ToUint8Array(persistedRun.audioWavBase64!);
          const decoded = await getAudioContext().decodeAudioData(bytes.buffer.slice(0));
          setScheduledAudioBuffersById((prev) => ({ ...prev, [playerItemId]: decoded }));
          setScheduledAudioLoadStateById((prev) => ({ ...prev, [playerItemId]: 'cached' }));
          setPersistedScheduledRuns((prev) => ({
            ...prev,
            [runId]: {
              ...prev[runId],
              cacheStatus: 'cached',
              cacheError: '',
            },
          }));
          addLog(`[Player] Restored scheduled audio from local cache for ${playerItemId.slice(0, 12)}.`);
        } catch (error: any) {
          setScheduledAudioLoadStateById((prev) => ({ ...prev, [playerItemId]: 'error' }));
          setScheduledAudioErrorsById((prev) => ({ ...prev, [playerItemId]: error?.message || 'Failed to restore cached audio' }));
          setPersistedScheduledRuns((prev) => ({
            ...prev,
            [runId]: {
              ...prev[runId],
              cacheStatus: 'failed',
              cacheError: error?.message || 'Failed to restore cached audio',
            },
          }));
        } finally {
          delete scheduledAudioHydrationRef.current[playerItemId];
        }
      })();

      scheduledAudioHydrationRef.current[playerItemId] = promise;
      return promise;
    };

    for (const run of runs) {
      if (run.status !== 'success' || !run.audioPath) {
        continue;
      }
      const persistedRun = persistedScheduledRuns[run.id];
      if (persistedRun?.audioWavBase64) {
        void hydratePersistedAudio(run.id, persistedRun);
      }
    }
  }, [runs, persistedScheduledRuns, scheduledAudioBuffersById]);

  useEffect(() => {
    const scheduledRunsWithAudio = runs.filter((run) => run.status === 'success' && Boolean(run.audioPath));
    if (!scheduledRunsWithAudio.length) {
      return;
    }

    const missingRuns = scheduledRunsWithAudio.filter((run) => {
      const playerItemId = `scheduled:${run.id}`;
      const persistedRun = persistedScheduledRuns[run.id];
      return !persistedRun?.audioWavBase64 && !scheduledPrefetchedIdsRef.current[playerItemId];
    });

    if (!missingRuns.length || scheduledPrefetchRunningRef.current) {
      return;
    }

    for (const run of missingRuns) {
      const playerItemId = `scheduled:${run.id}`;
      setScheduledAudioLoadStateById((prev) => (prev[playerItemId] ? prev : { ...prev, [playerItemId]: 'queued' }));
      setPersistedScheduledRuns((prev) => ({
        ...prev,
        [run.id]: {
          ...prev[run.id],
          ...run,
          cacheStatus: prev[run.id]?.audioWavBase64 ? 'cached' : prev[run.id]?.cacheStatus || 'queued',
          cacheError: prev[run.id]?.cacheError || '',
        },
      }));
    }

    scheduledPrefetchRunningRef.current = true;
    scheduledPrefetchCycleRef.current += 1;
    addLog(`[Player] Prefetch queue started for ${missingRuns.length} scheduled audio item(s), top to bottom.`);
    void (async () => {
      for (const run of missingRuns) {
        const playerItemId = `scheduled:${run.id}`;
        scheduledPrefetchedIdsRef.current[playerItemId] = true;
        await loadScheduledRunAudio(run.id);
      }
      addLog('[Player] Scheduled audio prefetch finished.');
      scheduledPrefetchRunningRef.current = false;
    })();
  }, [runs, persistedScheduledRuns, scheduledAudioBuffersById]);
  const runQueueWorker = async () => {
    if (isWorkerRunningRef.current) return;
    isWorkerRunningRef.current = true;
    setIsProcessingActive(true);
    try {
      while (processingQueueRef.current.length > 0) {
        if (stopProcessingRef.current) { addLog(`Worker halted. ${processingQueueRef.current.length} queued item(s) remain.`); break; }
        const currentId = processingQueueRef.current.shift();
        if (!currentId) continue;
        let currentItem = itemsRef.current.find((item) => item.id === currentId);
        if (!currentItem) { await wait(0); currentItem = itemsRef.current.find((item) => item.id === currentId); }
        if (!currentItem) { addLog(`Skipping removed item ${currentId.slice(0, 8)}.`); continue; }
        const currentPrompt = currentItem.prompt;
        const modelForItem = currentItem.ttsModel || DEFAULT_TTS_MODEL;
        let currentStage: RateLimitScope = 'text';
        addLog(`Processing "${currentPrompt}" (${processingQueueRef.current.length} queued after this).`);
        setItems((prev) => prev.map((item) => item.id === currentId ? { ...item, status: ItemStatus.GENERATING_TEXT, error: undefined } : item));
        try {
          const { text, groundingLinks } = await generateTextAnswer(
            currentPrompt,
            {
              enableGoogleSearch: currentItem.enableGoogleSearch ?? DEFAULT_TOOL_OPTIONS.enableGoogleSearch,
              enableUrlContext: currentItem.enableUrlContext ?? DEFAULT_TOOL_OPTIONS.enableUrlContext,
            },
            addLog
          );
          clearRateLimitWarning('text');
          if (stopProcessingRef.current) {
            setItems((prev) => {
              const next = prev.map((item) => item.id === currentId ? { ...item, status: ItemStatus.ERROR, error: 'Stopped by user.' } : item);
              itemsRef.current = next;
              return next;
            });
            break;
          }
          if (!itemsRef.current.some((item) => item.id === currentId)) { addLog(`Item deleted during processing, skipping "${currentPrompt}".`); continue; }
          currentStage = 'tts';
          const ttsChunks = splitTextForTTS(text);
          const partGroupId = ttsChunks.length > 1 ? uuidv4() : currentId;
          const chunkedItems: ProcessItem[] = ttsChunks.map((chunk, index) => ({
            id: index === 0 ? currentId : uuidv4(),
            prompt: currentPrompt,
            answer: chunk.text,
            audioBuffer: null,
            audioBase64: undefined,
            ttsModel: modelForItem,
            enableGoogleSearch: currentItem.enableGoogleSearch ?? DEFAULT_TOOL_OPTIONS.enableGoogleSearch,
            enableUrlContext: currentItem.enableUrlContext ?? DEFAULT_TOOL_OPTIONS.enableUrlContext,
            partIndex: chunk.partIndex,
            partCount: chunk.partCount,
            partGroupId,
            status: ItemStatus.QUEUED,
            groundingLinks,
            timestamp: currentItem.timestamp,
          }));
          setItems((prev) => {
            const next = prev.flatMap((item) => item.id === currentId ? chunkedItems : [item]);
            itemsRef.current = next;
            return next;
          });
          if (chunkedItems.length > 1) {
            addLog(`[TTS] Split long text into ${chunkedItems.length} part(s) for "${currentPrompt}".`);
          }

          for (const partItem of chunkedItems) {
            const partLabel = formatPartLabel(partItem.partIndex, partItem.partCount) || 'single part';
            setItems((prev) => {
              const next = prev.map((item) => item.id === partItem.id ? { ...item, status: ItemStatus.GENERATING_AUDIO, error: undefined } : item);
              itemsRef.current = next;
              return next;
            });
            try {
              addLog(`[TTS] Starting ${partLabel} for "${currentPrompt}".`);
              const base64Audio = await generateSpeech(partItem.answer || '', modelForItem, addLog, { contextLabel: partLabel });
              clearRateLimitWarning('tts');
              if (stopProcessingRef.current) {
                setItems((prev) => {
                  const next = prev.map((item) => item.id === partItem.id ? { ...item, status: ItemStatus.ERROR, error: 'Stopped by user.' } : item);
                  itemsRef.current = next;
                  return next;
                });
                break;
              }
              if (!itemsRef.current.some((item) => item.id === partItem.id)) {
                addLog(`Item deleted before audio decode, skipping "${currentPrompt}" ${partLabel}.`);
                continue;
              }
              addLog(`[TTS] ${partLabel} audio received. Decoding...`);
              const audioBuffer = await decodeAudioData(base64Audio, getAudioContext(), addLog);
              setItems((prev) => {
                const next = prev.map((item) => item.id === partItem.id ? { ...item, audioBuffer, audioBase64: base64Audio, status: ItemStatus.READY } : item);
                itemsRef.current = next;
                return next;
              });
              addLog(`[TTS] ${partLabel} ready.`);
              setSelectedItemId((prev) => prev || partItem.id);
              setPlayerAutoplayRequestId((prev) => prev || `manual:${partItem.id}`);
            } catch (partError: any) {
              const failureMessage = partError?.message || `${partLabel} failed.`;
              addLog(`[TTS] ${failureMessage}`);
              if (isRateLimitError(partError)) {
                setRateLimitWarning('tts', 'Daily TTS limit reached: 200 requests per day.');
              }
              setItems((prev) => {
                const next = prev.map((item) => {
                  if (item.id === partItem.id) {
                    return { ...item, status: ItemStatus.ERROR, error: failureMessage };
                  }
                  if (
                    item.partGroupId &&
                    partItem.partGroupId &&
                    item.partGroupId === partItem.partGroupId &&
                    item.status === ItemStatus.QUEUED
                  ) {
                    return {
                      ...item,
                      status: ItemStatus.ERROR,
                      error: `Skipped because ${partLabel} failed: ${failureMessage}`,
                    };
                  }
                  return item;
                });
                itemsRef.current = next;
                return next;
              });
              throw Object.assign(partError instanceof Error ? partError : new Error(failureMessage), { alreadyLogged: true });
            }
          }
          addLog(`Completed "${currentPrompt}".`);
        } catch (error: any) {
          if (!error?.alreadyLogged) {
            addLog(`Error: ${error.message}`);
          }
          if (isRateLimitError(error)) {
            const warningMessage =
              currentStage === 'text'
                ? 'Daily text generation limit reached: 200 requests per day.'
                : 'Daily TTS limit reached: 200 requests per day.';
            setRateLimitWarning(currentStage, warningMessage);
          }
          setItems((prev) => {
            if (currentStage === 'tts') {
              return prev;
            }
            const next = prev.map((item) => item.id === currentId ? { ...item, status: ItemStatus.ERROR, error: error.message } : item);
            itemsRef.current = next;
            return next;
          });
        }
      }
    } finally {
      isWorkerRunningRef.current = false;
      setIsProcessingActive(false);
      stopProcessingRef.current = false;
    }
  };

  const processPrompts = async (prompts: string[], ttsModel: string, toolOptions: GeminiToolOptions) => {
    const cleanPrompts = prompts.map((p) => p.trim()).filter(Boolean);
    if (!cleanPrompts.length) return;
    stopProcessingRef.current = false;
    const timestamp = Date.now();
    const normalizedToolOptions = {
      enableGoogleSearch: toolOptions.enableGoogleSearch ?? DEFAULT_TOOL_OPTIONS.enableGoogleSearch,
      enableUrlContext: toolOptions.enableUrlContext ?? DEFAULT_TOOL_OPTIONS.enableUrlContext,
    };
    const newItems = cleanPrompts.map((prompt) => ({ id: uuidv4(), prompt, answer: null, audioBuffer: null, audioBase64: undefined, ttsModel, enableGoogleSearch: normalizedToolOptions.enableGoogleSearch, enableUrlContext: normalizedToolOptions.enableUrlContext, partIndex: undefined, partCount: undefined, partGroupId: undefined, status: ItemStatus.QUEUED, groundingLinks: [], timestamp }));
    processingQueueRef.current.push(...newItems.map((item) => item.id));
    itemsRef.current = [...newItems, ...itemsRef.current];
    setItems((prev) => [...newItems, ...prev]);
    addLog(`Enqueued ${newItems.length} prompt(s) with ${ttsModel}. Tools: googleSearch=${normalizedToolOptions.enableGoogleSearch}, urlContext=${normalizedToolOptions.enableUrlContext}. Queue length: ${processingQueueRef.current.length}.`);
    if (!isWorkerRunningRef.current) void runQueueWorker();
  };

  const handleAdminLogin = async (password: string) => {
    addLog(`[Auth] Admin login requested (password length: ${password.length}).`);
    setIsAuthLoading(true);
    setAdminError('');
    try {
      const session = await login(password);
      setAuthSession(session);
      clearRateLimitWarning('login');
      addLog(`[Auth] Admin login succeeded. Session expires at ${session.expiresAt}.`);
    } catch (error: any) {
      addLog(`[Auth] Admin login failed: ${error?.message || error}`);
      if (isRateLimitError(error)) {
        setRateLimitWarning('login', 'Daily login limit reached: 100 attempts per day.');
      }
      const message = error?.message || 'Login failed';
      setAdminError(message);
      throw new Error(message);
    } finally {
      setIsAuthLoading(false);
    }
  };
  const handleAdminLogout = async () => {
    addLog('[Auth] Signing out admin session.');
    try {
      await logoutApi();
    } catch (error) {
      addLog(`[Auth] Logout request failed, clearing local admin state anyway: ${(error as Error)?.message || error}`);
    } finally {
      clearAdminSession();
    }
  };
  const handleScheduleSave = async (payload: Partial<Schedule>) => {
    if (!isAdminAuthenticated) {
      addLog('[Schedules] Save skipped: missing admin session.');
      return;
    }
    addLog(`[Schedules] Saving schedule (${editingSchedule ? 'update' : 'create'}) name="${payload?.name || ''}" frequency="${payload?.frequency || ''}" time="${payload?.timeOfDay || ''}".`);
    setIsScheduleSaving(true);
    setAdminError('');
    try {
      if (editingSchedule) await updateScheduleApi(editingSchedule.id, payload);
      else await createScheduleApi(payload);
      setEditingSchedule(null);
      await refreshAdminData();
      addLog('[Schedules] Save succeeded and admin data refreshed.');
    } catch (error: any) {
      addLog(`[Schedules] Save failed: ${error?.message || error}`);
      if (isUnauthorizedError(error)) clearAdminSession();
      setAdminError(error?.message || 'Failed to save schedule');
    } finally {
      setIsScheduleSaving(false);
    }
  };
  const handleScheduleDelete = async (schedule: Schedule) => {
    if (!isAdminAuthenticated) {
      addLog('[Schedules] Delete skipped: missing admin session.');
      return;
    }
    const confirmed = window.confirm(`Delete schedule "${schedule.name}"?`);
    if (!confirmed) {
      addLog(`[Schedules] Delete canceled by user for "${schedule.name}".`);
      return;
    }
    addLog(`[Schedules] Deleting schedule "${schedule.name}" (${schedule.id}).`);
    try {
      await deleteScheduleApi(schedule.id);
      if (editingSchedule?.id === schedule.id) setEditingSchedule(null);
      await refreshAdminData();
      addLog(`[Schedules] Delete succeeded for "${schedule.name}".`);
    } catch (error: any) {
      addLog(`[Schedules] Delete failed for "${schedule.name}": ${error?.message || error}`);
      if (isUnauthorizedError(error)) clearAdminSession();
      setAdminError(error?.message || 'Failed to delete schedule');
    }
  };
  const handleScheduleRunNow = async (schedule: Schedule) => {
    if (!isAdminAuthenticated) {
      addLog('[Schedules] Run-now skipped: missing admin session.');
      return;
    }
    addLog(`[Schedules] Manual run triggered for "${schedule.name}" (${schedule.id}).`);
    try {
      const run = await runScheduleNow(schedule.id);
      addLog(`[Schedules] Manual run completed for "${schedule.name}" with status=${run.status}, runId=${run.id}.`);
      await refreshAdminData();
      setActiveTab('runs');
    } catch (error: any) {
      addLog(`[Schedules] Manual run failed for "${schedule.name}": ${error?.message || error}`);
      if (isUnauthorizedError(error)) clearAdminSession();
      setAdminError(error?.message || 'Failed to run schedule');
    }
  };
  const handleSchedulerConfigSave = async () => {
    if (!isAdminAuthenticated) {
      addLog('[Scheduler] Config save skipped: missing admin session.');
      return;
    }
    setIsSchedulerSaving(true);
    setAdminError('');
    try {
      const cron = minutesToCron(schedulerIntervalMinutesDraft);
      addLog(`[Scheduler] Updating polling config: cron="${cron}", timezone="${schedulerTimezoneDraft.trim()}".`);
      const updated = await updateSchedulerConfigApi({
        schedule: cron,
        timeZone: schedulerTimezoneDraft.trim(),
      });
      setSchedulerConfig(updated);
      setSchedulerIntervalMinutesDraft(cronToMinutes(updated.schedule || '') || 5);
      setSchedulerTimezoneDraft(updated.timeZone || 'Europe/Paris');
      addLog(`Updated scheduler polling to every ${cronToMinutes(updated.schedule || '') || schedulerIntervalMinutesDraft} minute(s) (${updated.timeZone}).`);
    } catch (error: any) {
      addLog(`[Scheduler] Config update failed: ${error?.message || error}`);
      if (isUnauthorizedError(error)) clearAdminSession();
      setAdminError(error?.message || 'Failed to update scheduler polling');
    } finally {
      setIsSchedulerSaving(false);
    }
  };
  const deleteScheduledHistoryItem = async (runId: string) => {
    const target = persistedScheduledRuns[runId];
    if (!target) {
      return false;
    }

    if (!isAdminAuthenticated) {
      const message = 'Admin login is required to delete scheduled history from Google Cloud.';
      setAdminError(message);
      addLog(`[History] ${message}`);
      setActiveTab('schedules');
      return false;
    }

    addLog(`[History] Deleting scheduled run "${target.resolvedPrompt}" (${runId}) from cloud and local cache.`);
    setAdminError('');
    try {
      await deleteRunApi(runId);
      if (playerAutoplayRequestId === `scheduled:${runId}`) {
        setPlayerAutoplayRequestId(null);
      }
      clearScheduledAudioState(runId);
      setPersistedScheduledRuns((prev) => {
        const next = { ...prev };
        delete next[runId];
        return next;
      });
      setRuns((prev) => prev.filter((run) => run.id !== runId));
      addLog(`[History] Deleted scheduled run "${target.resolvedPrompt}" from cloud and local cache.`);
      return true;
    } catch (error: any) {
      addLog(`[History] Failed to delete scheduled run "${target.resolvedPrompt}": ${error?.message || error}`);
      if (isUnauthorizedError(error)) {
        clearAdminSession();
      }
      setAdminError(error?.message || 'Failed to delete scheduled run');
      return false;
    }
  };
  const handleScheduledHistoryDelete = async (runId: string) => {
    const target = persistedScheduledRuns[runId];
    if (!target || !window.confirm(`Delete scheduled history "${target.resolvedPrompt.substring(0, 30)}..." from cloud and local cache?`)) {
      return;
    }

    await deleteScheduledHistoryItem(runId);
  };
  const deleteManualHistoryItem = async (itemId: string) => {
    const target = itemsRef.current.find((entry) => entry.id === itemId);
    if (!target) {
      return false;
    }

    processingQueueRef.current = processingQueueRef.current.filter((queueId) => queueId !== itemId);
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
    }
    if (playerAutoplayRequestId === `manual:${itemId}`) {
      setPlayerAutoplayRequestId(null);
    }
    setItems((prev) => prev.filter((entry) => entry.id !== itemId));
    addLog(`[History] Deleted manual item "${target.prompt}".`);
    return true;
  };
  const handleManualHistoryDelete = async (itemId: string) => {
    const target = itemsRef.current.find((entry) => entry.id === itemId);
    if (!target || !window.confirm(`Delete "${target.prompt.substring(0, 30)}..."?`)) {
      return;
    }

    await deleteManualHistoryItem(itemId);
  };

  const resetAll = () => {
    addLog('[UI] Clearing full session state (results/logs/player queue).');
    stopProcessingRef.current = true;
    processingQueueRef.current = [];
    isWorkerRunningRef.current = false;
    setIsProcessingActive(false);
    setItems([]);
    setLogs([]);
    setSelectedItemId(null);
    setPlayerAutoplayRequestId(null);
    setSelectedHistoryEntryIds(new Set());
    setScheduledAudioBuffersById({});
    setScheduledAudioLoadStateById({});
    setScheduledAudioErrorsById({});
    scheduledAudioLoadPromisesRef.current = {};
    scheduledAudioHydrationRef.current = {};
    scheduledPrefetchedIdsRef.current = {};
    scheduledPrefetchRunningRef.current = false;
    void clearPersistedState();
  };
  const resultsItems = items
    .filter((item) => Date.now() - item.timestamp < ONE_HOUR_MS)
    .sort((a, b) => b.timestamp - a.timestamp || (a.partIndex || 1) - (b.partIndex || 1));
  const persistedScheduledHistory = Object.values(persistedScheduledRuns);
  const historyEntries = [
    ...items.map((item) => ({
      id: `manual:${item.id}`,
      source: 'manual' as const,
      targetId: item.id,
      timestamp: item.timestamp,
      title: formatPartLabel(item.partIndex, item.partCount) ? `${item.prompt} (${formatPartLabel(item.partIndex, item.partCount)})` : item.prompt,
      body: item.answer || 'No answer',
      partIndex: item.partIndex,
      playable: Boolean(item.audioBuffer),
      isActive: item.status === ItemStatus.PLAYING || selectedItemId === item.id,
      onPlay: () => {
        if (!item.audioBuffer) return;
        setSelectedItemId(item.id);
        setPlayerAutoplayRequestId(`manual:${item.id}`);
        setActiveTab('player');
      },
      onDelete: () => {
        void handleManualHistoryDelete(item.id);
      },
    })),
    ...persistedScheduledHistory.map((run) => ({
      id: `scheduled:${run.id}`,
      source: 'scheduled' as const,
      targetId: run.id,
      timestamp: new Date(run.startedAt).getTime(),
      title: formatPartLabel(run.partIndex, run.partCount) ? `${run.resolvedPrompt} (${formatPartLabel(run.partIndex, run.partCount)})` : run.resolvedPrompt,
      body: run.generatedText || run.errorMessage || 'No text available',
      partIndex: run.partIndex,
      playable: Boolean(run.audioWavBase64 || run.audioPath),
      isActive: playerAutoplayRequestId === `scheduled:${run.id}`,
      onPlay: () => {
        setSelectedItemId(null);
        setPlayerAutoplayRequestId(`scheduled:${run.id}`);
        setActiveTab('player');
      },
      onDelete: () => {
        void handleScheduledHistoryDelete(run.id);
      },
    })),
  ].sort((a, b) => b.timestamp - a.timestamp || (a.partIndex || 1) - (b.partIndex || 1));
  const historyGroups = historyEntries.reduce<Array<{
    key: string;
    label: string;
    timestamp: number;
    entries: typeof historyEntries;
  }>>((groups, entry) => {
    const key = getLocalDateKey(entry.timestamp);
    const existingGroup = groups[groups.length - 1];
    if (existingGroup && existingGroup.key === key) {
      existingGroup.entries.push(entry);
      return groups;
    }

    groups.push({
      key,
      label: formatHistoryDateLabel(entry.timestamp),
      timestamp: entry.timestamp,
      entries: [entry],
    });
    return groups;
  }, []);
  const selectedHistoryEntries = historyEntries.filter((entry) => selectedHistoryEntryIds.has(entry.id));
  const hasSelectedScheduledEntries = selectedHistoryEntries.some((entry) => entry.source === 'scheduled');
  const hasSelectedHistoryEntries = selectedHistoryEntries.length > 0;
  const handleBulkDeleteHistory = async () => {
    if (!hasSelectedHistoryEntries) {
      return;
    }

    if (hasSelectedScheduledEntries && !isAdminAuthenticated) {
      const message = 'Admin login is required to delete scheduled history from Google Cloud.';
      setAdminError(message);
      addLog(`[History] ${message}`);
      setActiveTab('schedules');
      return;
    }

    const confirmMessage = hasSelectedScheduledEntries
      ? `Delete ${selectedHistoryEntries.length} selected history item(s)? Scheduled items will be deleted from Google Cloud and local cache.`
      : `Delete ${selectedHistoryEntries.length} selected history item(s)?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    let successCount = 0;
    let failureCount = 0;
    const failedIds = new Set<string>();
    setAdminError('');

    for (const entry of selectedHistoryEntries) {
      try {
        if (entry.source === 'manual') {
          const deleted = await deleteManualHistoryItem(entry.targetId);
          if (!deleted) {
            failureCount += 1;
            failedIds.add(entry.id);
            continue;
          }
        } else {
          const deleted = await deleteScheduledHistoryItem(entry.targetId);
          if (!deleted) {
            failureCount += 1;
            failedIds.add(entry.id);
            continue;
          }
        }

        successCount += 1;
      } catch (_error) {
        failureCount += 1;
        failedIds.add(entry.id);
      }
    }

    setSelectedHistoryEntryIds(failedIds);
    addLog(`[History] Bulk delete finished. Success=${successCount}, Failed=${failureCount}.`);
  };
  useEffect(() => {
    setSelectedHistoryEntryIds((prev) => {
      if (prev.size === 0) {
        return prev;
      }

      const validIds = new Set(historyEntries.map((entry) => entry.id));
      const next = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [historyEntries]);
  useEffect(() => {
    historyGroups.forEach((group) => {
      const checkbox = historyGroupCheckboxRefs.current[group.key];
      if (!checkbox) {
        return;
      }
      const selectedCount = group.entries.filter((entry) => selectedHistoryEntryIds.has(entry.id)).length;
      checkbox.indeterminate = selectedCount > 0 && selectedCount < group.entries.length;
    });
  }, [historyGroups, selectedHistoryEntryIds]);
  const adminPanel = <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Schedule Manager</h2>
          <p className="text-sm text-slate-400">Cloud Scheduler can trigger these prompts in the background.</p>
        </div>
        <button onClick={() => void handleAdminLogout()} className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700">Sign Out</button>
      </div>
      {adminError && <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/30 rounded-md p-3">{adminError}</div>}
      <div className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Scheduler Polling</h3>
          <p className="text-xs text-slate-400">Controls Cloud Scheduler job <span className="font-mono">{schedulerConfig?.jobName || 'schedule-runner'}</span>.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm text-slate-300">
            <span className="block mb-1">Polling Interval (minutes)</span>
            <div className="flex gap-2">
              <select
                value={POLLING_PRESETS.includes(schedulerIntervalMinutesDraft) ? schedulerIntervalMinutesDraft : 0}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (next > 0) setSchedulerIntervalMinutesDraft(next);
                }}
                className="w-40 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={0}>Custom</option>
                {POLLING_PRESETS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    Every {minutes} min
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={60}
                value={schedulerIntervalMinutesDraft}
                onChange={(e) => setSchedulerIntervalMinutesDraft(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </label>
          <label className="text-sm text-slate-300">
            <span className="block mb-1">Timezone</span>
            <input
              value={schedulerTimezoneDraft}
              onChange={(e) => setSchedulerTimezoneDraft(e.target.value)}
              placeholder="Europe/Paris"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleSchedulerConfigSave()}
            disabled={schedulerIntervalMinutesDraft < 1 || isSchedulerSaving}
            className={`px-3 py-2 rounded-lg text-sm font-semibold ${schedulerIntervalMinutesDraft < 1 || isSchedulerSaving ? 'bg-slate-800 text-slate-500 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
          >
            {isSchedulerSaving ? 'Saving...' : 'Update Polling'}
          </button>
          {schedulerConfig && <span className="text-xs text-slate-400">Current: every {cronToMinutes(schedulerConfig.schedule || '') || 5} min ({schedulerConfig.timeZone})</span>}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px),1fr]">
        <ScheduleForm initialValue={editingSchedule} onSubmit={handleScheduleSave} onCancel={() => setEditingSchedule(null)} isSaving={isScheduleSaving} />
        <div className="space-y-4">
          <button onClick={() => void refreshAdminData()} disabled={isAdminRefreshing} className={`px-3 py-2 rounded-lg text-sm font-semibold ${isAdminRefreshing ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'}`}>{isAdminRefreshing ? 'Refreshing...' : 'Refresh'}</button>
          <ScheduleList schedules={schedules} onEdit={setEditingSchedule} onDelete={handleScheduleDelete} onRunNow={handleScheduleRunNow} />
        </div>
      </div>
    </>;

  if (isAuthBootstrapping) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <div className="text-2xl font-semibold text-white">Restoring Session</div>
          <div className="text-sm text-slate-400">Checking saved admin login...</div>
        </div>
      </div>
    );
  }

  if (!isAdminAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
        <div className="fixed inset-0 bg-slate-950/95" />
        <div className="relative z-10 w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">Gemini Audio Summarizer</h1>
            <p className="text-slate-400">Sign in to enter the app.</p>
          </div>
          {activeRateLimitWarnings.length > 0 && (
            <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 shadow-lg shadow-amber-950/20">
              <div className="mb-3 flex items-center gap-2 text-amber-200">
                <AlertTriangle size={18} />
                <span className="text-sm font-semibold uppercase tracking-wide">Usage Limit Reached</span>
              </div>
              <div className="space-y-2">
                {activeRateLimitWarnings.map(([scope, message]) => (
                  <div key={scope} className="rounded-xl border border-amber-500/20 bg-slate-950/40 px-4 py-3 text-sm text-amber-100">
                    <span className="mr-2 font-semibold uppercase">{scope}</span>
                    <span>{message}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {adminError && <div className="mb-4 text-sm text-red-400 bg-red-950/30 border border-red-900/30 rounded-md p-3">{adminError}</div>}
          <LoginForm onLogin={handleAdminLogin} isLoading={isAuthLoading} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-12">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">Gemini Audio Summarizer</h1>
        <p className="text-slate-400">Manual prompts, scheduled runs, and stored audio from one app.</p>
      </header>
      {activeRateLimitWarnings.length > 0 && (
        <div className="mb-6 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 shadow-lg shadow-amber-950/20">
          <div className="mb-3 flex items-center gap-2 text-amber-200">
            <AlertTriangle size={18} />
            <span className="text-sm font-semibold uppercase tracking-wide">Usage Limit Reached</span>
          </div>
          <div className="space-y-2">
            {activeRateLimitWarnings.map(([scope, message]) => (
              <div key={scope} className="rounded-xl border border-amber-500/20 bg-slate-950/40 px-4 py-3 text-sm text-amber-100">
                <span className="mr-2 font-semibold uppercase">{scope}</span>
                <span>{message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <InputSection onProcess={processPrompts} isProcessing={isProcessingActive} warningMessage={generationWarningMessage} />
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-3">
          {(['results', 'player', 'history', 'schedules', 'runs'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${
                activeTab === tab
                  ? 'bg-slate-800 text-white border border-slate-600 shadow'
                  : 'bg-slate-900 text-slate-400 border border-slate-800'
              }`}
            >
              {tab === 'player' && <ListMusic size={18} />}
              {tab === 'schedules' && <CalendarClock size={18} />}
              {tab}
            </button>
          ))}
        </div>

      </div>

      {activeTab === 'results' && <>
        <div className="space-y-4 mb-12">
          <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Showing responses from the last hour</p>
          {resultsItems.length === 0 && <div className="text-center py-10 text-slate-500 border border-dashed border-slate-800 rounded-lg">No recent results. Start by entering a prompt above.</div>}
          {resultsItems.map((item) => <ResultCard key={item.id} item={item} isActive={item.status === ItemStatus.PLAYING} />)}
        </div>
        <div className="bg-slate-950 rounded-lg border border-slate-800 p-4 shadow-xl">
          <div className="flex items-center gap-2 text-slate-400 mb-2 pb-2 border-b border-slate-800"><Terminal size={16} /><span className="text-xs font-mono font-bold uppercase tracking-wider">Activity Log</span></div>
          <div className="h-64 overflow-y-auto font-mono text-xs space-y-1 pr-2">
            {logs.length === 0 && <span className="text-slate-600 italic">Ready to start...</span>}
            {logs.map((log, idx) => <div key={idx} className="text-emerald-400/90 break-all"><span className="opacity-50 mr-2 select-none">&gt;</span>{log}</div>)}
            <div ref={logsEndRef} />
          </div>
        </div>
      </>}

      {activeTab === 'player' && (
        <UnifiedPlayer
          items={items}
          runs={runs}
          persistedScheduledRuns={persistedScheduledRuns}
          setItems={setItems}
          setSelectedItemId={setSelectedItemId}
          addLog={addLog}
          autoplayRequestId={playerAutoplayRequestId}
          onAutoplayRequestHandled={() => setPlayerAutoplayRequestId(null)}
          scheduledAudioBuffersById={scheduledAudioBuffersById}
          scheduledAudioLoadStateById={scheduledAudioLoadStateById}
          scheduledAudioErrorsById={scheduledAudioErrorsById}
          loadScheduledRunAudio={loadScheduledRunAudio}
        />
      )}

      {activeTab === 'history' && <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 mb-10 space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between border-b border-slate-800 pb-4"><div className="flex items-center gap-2 text-slate-200 font-semibold"><ListMusic size={18} /> History (Stored in IndexedDB)</div><div className="text-xs text-slate-500 italic">Manual items and locally cached scheduled runs are stored here.</div></div>
        {historyEntries.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-slate-300">
              Selected: <span className="font-semibold text-white">{selectedHistoryEntries.length}</span> / {historyEntries.length}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setSelectedHistoryEntryIds(new Set(historyEntries.map((entry) => entry.id)))}
                className="inline-flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-slate-700"
              >
                <CheckSquare size={15} />
                Select All
              </button>
              <button
                onClick={() => setSelectedHistoryEntryIds(new Set())}
                disabled={!hasSelectedHistoryEntries}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${
                  hasSelectedHistoryEntries
                    ? 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                    : 'border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed'
                }`}
              >
                <Square size={15} />
                Clear Selection
              </button>
              <button
                onClick={() => void handleBulkDeleteHistory()}
                disabled={!hasSelectedHistoryEntries}
                className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
                  hasSelectedHistoryEntries
                    ? 'border-red-900/30 bg-red-900/20 text-red-300 hover:bg-red-900/35'
                    : 'border-slate-800 bg-slate-900 text-slate-500 cursor-not-allowed'
                }`}
              >
                <Trash2 size={15} />
                Delete Selected
              </button>
            </div>
          </div>
        )}
        {!historyEntries.length && <div className="text-center py-10 text-slate-600 italic">No history items yet.</div>}
        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
          {historyGroups.map((group) => {
            const selectedCount = group.entries.filter((entry) => selectedHistoryEntryIds.has(entry.id)).length;
            const allSelected = group.entries.length > 0 && selectedCount === group.entries.length;
            return (
              <div key={group.key} className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <input
                      ref={(node) => {
                        historyGroupCheckboxRefs.current[group.key] = node;
                      }}
                      type="checkbox"
                      checked={allSelected}
                      onChange={(event) => setHistoryDateSelection(group.entries.map((entry) => entry.id), event.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{group.label}</div>
                      <div className="text-xs text-slate-500">{group.entries.length} item(s)</div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-400">{selectedCount} selected</div>
                </div>
                {group.entries.map((entry) => <div key={entry.id} className={`rounded-lg border p-4 flex flex-col gap-2 ${entry.isActive ? 'border-emerald-500/60 bg-emerald-500/10' : 'border-slate-800 bg-slate-800/40'}`}><div className="flex justify-between items-start gap-4"><div className="flex min-w-0 flex-1 gap-3"><label className="mt-1 flex shrink-0 items-start"><input type="checkbox" checked={selectedHistoryEntryIds.has(entry.id)} onChange={(event) => updateHistorySelection(entry.id, event.target.checked)} className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-emerald-500 focus:ring-emerald-500" /></label><div className="min-w-0 flex-1"><div className="flex items-center gap-2 mb-1"><div className="text-xs text-slate-500">{new Date(entry.timestamp).toLocaleString()}</div><span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-full ${entry.source === 'manual' ? 'bg-blue-950/40 text-blue-300 border border-blue-900/40' : 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/40'}`}>{entry.source}</span></div><div className="text-sm font-bold text-slate-100 break-words mb-1">{entry.title}</div><div className="text-xs text-slate-400 line-clamp-3">{entry.body}</div></div></div><div className="flex flex-col gap-2 shrink-0 w-32"><button onClick={entry.onPlay} disabled={!entry.playable} className={`px-3 py-2 rounded-md text-sm font-semibold flex items-center gap-2 justify-center ${entry.playable ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}><PlayCircle size={16} /> Play</button><button onClick={entry.onDelete} className="px-3 py-2 rounded-md text-sm font-semibold bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-900/30 flex items-center gap-2 justify-center"><Trash2 size={16} /> Delete</button></div></div></div>)}
              </div>
            );
          })}
        </div>
      </div>}

      {activeTab === 'schedules' && <div className="space-y-4">{adminPanel}</div>}
      {activeTab === 'runs' && <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold text-white">Scheduled Runs</h2><p className="text-sm text-slate-400">Latest automated or manual schedule executions.</p></div><button onClick={() => void refreshAdminData()} disabled={isAdminRefreshing} className={`px-3 py-2 rounded-lg text-sm font-semibold ${isAdminRefreshing ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'}`}>{isAdminRefreshing ? 'Refreshing...' : 'Refresh'}</button></div>{adminError && <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/30 rounded-md p-3">{adminError}</div>}<RunHistoryList runs={runs} /></div>}
    </div>
  );
};

export default App;
