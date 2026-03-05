import React, { useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { CalendarClock, ListMusic, PlayCircle, RotateCcw, Terminal, Trash2 } from 'lucide-react';
import { InputSection } from './components/InputSection';
import { LoginForm } from './components/LoginForm';
import { ResultCard } from './components/ResultCard';
import { RunHistoryList } from './components/RunHistoryList';
import { ScheduleForm } from './components/ScheduleForm';
import { ScheduleList } from './components/ScheduleList';
import { UnifiedPlayer } from './components/UnifiedPlayer';
import { createSchedule as createScheduleApi, deleteSchedule as deleteScheduleApi, fetchRuns, fetchSchedules, fetchSchedulerConfig, login, runScheduleNow, updateSchedule as updateScheduleApi, updateSchedulerConfig as updateSchedulerConfigApi } from './services/adminApi';
import { generateSpeech, generateTextAnswer } from './services/geminiService';
import { AuthSession, ItemStatus, ProcessItem, Schedule, SchedulerConfig, ScheduleRun } from './types';
import { decodeAudioData } from './utils/audioUtils';
import { clearPersistedState, loadPersistedState, PersistedState, savePersistedState } from './utils/storage';

const ONE_HOUR_MS = 3600000;
const DEFAULT_TTS_MODEL = 'gemini-2.5-pro-preview-tts';
const SESSION_KEY = 'gemini-admin-session';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const POLLING_PRESETS = [1, 5, 10, 15, 30, 60];

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

const App: React.FC = () => {
  const [items, setItems] = useState<ProcessItem[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'results' | 'player' | 'history' | 'schedules' | 'runs'>('results');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [playerAutoplayRequestId, setPlayerAutoplayRequestId] = useState<string | null>(null);
  const [isHydrating, setIsHydrating] = useState(true);
  const [isProcessingActive, setIsProcessingActive] = useState(false);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isAdminRefreshing, setIsAdminRefreshing] = useState(false);
  const [isScheduleSaving, setIsScheduleSaving] = useState(false);
  const [adminError, setAdminError] = useState('');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [schedulerConfig, setSchedulerConfig] = useState<SchedulerConfig | null>(null);
  const [schedulerIntervalMinutesDraft, setSchedulerIntervalMinutesDraft] = useState(5);
  const [schedulerTimezoneDraft, setSchedulerTimezoneDraft] = useState('Europe/Paris');
  const [isSchedulerSaving, setIsSchedulerSaving] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const stopProcessingRef = useRef(false);
  const processingQueueRef = useRef<string[]>([]);
  const isWorkerRunningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const itemsRef = useRef<ProcessItem[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  const token = authSession?.token || '';

  const clearAdminSession = () => {
    addLog('[Auth] Clearing admin session and cached admin data.');
    localStorage.removeItem(SESSION_KEY);
    setAuthSession(null);
    setSchedules([]);
    setRuns([]);
    setSchedulerConfig(null);
    setSchedulerIntervalMinutesDraft(5);
    setSchedulerTimezoneDraft('Europe/Paris');
    setEditingSchedule(null);
  };

  const refreshAdminData = async (authToken = token) => {
    if (!authToken) {
      addLog('[Admin] Skipped refresh because token is missing.');
      return;
    }
    addLog('[Admin] Refreshing schedules/runs/scheduler config...');
    setIsAdminRefreshing(true);
    setAdminError('');
    try {
      const [nextSchedules, nextRuns] = await Promise.all([
        fetchSchedules(authToken),
        fetchRuns(authToken),
      ]);
      setSchedules(nextSchedules);
      setRuns(nextRuns);
      addLog(`[Admin] Refreshed ${nextSchedules.length} schedule(s) and ${nextRuns.length} run(s).`);
      try {
        const nextSchedulerConfig = await fetchSchedulerConfig(authToken);
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
      if (String(error?.message || '').toLowerCase().includes('unauthorized')) clearAdminSession();
      setAdminError(error?.message || 'Failed to refresh admin data');
    } finally {
      setIsAdminRefreshing(false);
    }
  };

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { addLog(`[UI] Active tab changed to "${activeTab}".`); }, [activeTab]);
  useEffect(() => {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) {
      addLog('[Auth] No saved admin session in localStorage.');
      return;
    }
    try {
      const parsed = JSON.parse(raw) as AuthSession;
      if (new Date(parsed.expiresAt).getTime() > Date.now()) {
        addLog(`[Auth] Restored admin session from localStorage, expires at ${parsed.expiresAt}.`);
        setAuthSession(parsed);
      } else {
        addLog('[Auth] Saved admin session expired, removing local copy.');
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      addLog('[Auth] Failed to parse saved admin session, removing local copy.');
      localStorage.removeItem(SESSION_KEY);
    }
  }, []);
  useEffect(() => { if (token) void refreshAdminData(token); }, [token]);
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
            return { id: item.id, prompt: item.prompt, answer: item.answer, groundingLinks: item.groundingLinks || [], audioBuffer, audioBase64: item.audioBase64, ttsModel: item.ttsModel, error, status, timestamp: item.timestamp || persisted.updatedAt };
          }));
          setItems((prev) => {
            const unique = new Map<string, ProcessItem>();
            [...hydratedItems, ...prev].forEach((item) => unique.set(item.id, item));
            return Array.from(unique.values()).sort((a, b) => b.timestamp - a.timestamp);
          });
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
        items: items.map((item) => ({ id: item.id, prompt: item.prompt, answer: item.answer, groundingLinks: item.groundingLinks, audioBase64: item.audioBase64, ttsModel: item.ttsModel, error: item.error, status: item.status, timestamp: item.timestamp })),
        recentPrompts: [],
        updatedAt: Date.now(),
      };
      try { await savePersistedState(state); } catch (e: any) { addLog(`Persistence Error: ${e.message || e}`); }
    }, 1000);
    return () => clearTimeout(timeout);
  }, [items, isHydrating]);

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
        addLog(`Processing "${currentPrompt}" (${processingQueueRef.current.length} queued after this).`);
        setItems((prev) => prev.map((item) => item.id === currentId ? { ...item, status: ItemStatus.GENERATING_TEXT, error: undefined } : item));
        try {
          const { text, groundingLinks } = await generateTextAnswer(currentPrompt, addLog);
          if (stopProcessingRef.current) { setItems((prev) => prev.map((item) => item.id === currentId ? { ...item, status: ItemStatus.ERROR, error: 'Stopped by user.' } : item)); break; }
          if (!itemsRef.current.some((item) => item.id === currentId)) { addLog(`Item deleted during processing, skipping "${currentPrompt}".`); continue; }
          setItems((prev) => prev.map((item) => item.id === currentId ? { ...item, answer: text, groundingLinks, status: ItemStatus.GENERATING_AUDIO } : item));
          const base64Audio = await generateSpeech(text, modelForItem, addLog);
          if (stopProcessingRef.current) { setItems((prev) => prev.map((item) => item.id === currentId ? { ...item, status: ItemStatus.ERROR, error: 'Stopped by user.' } : item)); break; }
          if (!itemsRef.current.some((item) => item.id === currentId)) { addLog(`Item deleted before audio decode, skipping "${currentPrompt}".`); continue; }
          const audioBuffer = await decodeAudioData(base64Audio, getAudioContext(), addLog);
          setItems((prev) => prev.map((item) => item.id === currentId ? { ...item, audioBuffer, audioBase64: base64Audio, status: ItemStatus.READY } : item));
          setSelectedItemId((prev) => prev || currentId);
          setPlayerAutoplayRequestId((prev) => prev || `manual:${currentId}`);
          addLog(`Completed "${currentPrompt}".`);
        } catch (error: any) {
          addLog(`Error: ${error.message}`);
          setItems((prev) => prev.map((item) => item.id === currentId ? { ...item, status: ItemStatus.ERROR, error: error.message } : item));
        }
      }
    } finally {
      isWorkerRunningRef.current = false;
      setIsProcessingActive(false);
      stopProcessingRef.current = false;
    }
  };

  const processPrompts = async (prompts: string[], ttsModel: string) => {
    const cleanPrompts = prompts.map((p) => p.trim()).filter(Boolean);
    if (!cleanPrompts.length) return;
    stopProcessingRef.current = false;
    const timestamp = Date.now();
    const newItems = cleanPrompts.map((prompt) => ({ id: uuidv4(), prompt, answer: null, audioBuffer: null, audioBase64: undefined, ttsModel, status: ItemStatus.QUEUED, groundingLinks: [], timestamp }));
    processingQueueRef.current.push(...newItems.map((item) => item.id));
    itemsRef.current = [...newItems, ...itemsRef.current];
    setItems((prev) => [...newItems, ...prev]);
    addLog(`Enqueued ${newItems.length} prompt(s) with ${ttsModel}. Queue length: ${processingQueueRef.current.length}.`);
    if (!isWorkerRunningRef.current) void runQueueWorker();
  };

  const handleAdminLogin = async (password: string) => {
    addLog(`[Auth] Admin login requested (password length: ${password.length}).`);
    setIsAuthLoading(true);
    setAdminError('');
    try {
      const session = await login(password);
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      setAuthSession(session);
      addLog(`[Auth] Admin login succeeded. Session expires at ${session.expiresAt}.`);
    } catch (error: any) {
      addLog(`[Auth] Admin login failed: ${error?.message || error}`);
      setAdminError(error?.message || 'Login failed');
    } finally {
      setIsAuthLoading(false);
    }
  };
  const handleScheduleSave = async (payload: Partial<Schedule>) => {
    if (!token) {
      addLog('[Schedules] Save skipped: missing auth token.');
      return;
    }
    addLog(`[Schedules] Saving schedule (${editingSchedule ? 'update' : 'create'}) name="${payload?.name || ''}" frequency="${payload?.frequency || ''}" time="${payload?.timeOfDay || ''}".`);
    setIsScheduleSaving(true);
    setAdminError('');
    try {
      if (editingSchedule) await updateScheduleApi(token, editingSchedule.id, payload);
      else await createScheduleApi(token, payload);
      setEditingSchedule(null);
      await refreshAdminData(token);
      addLog('[Schedules] Save succeeded and admin data refreshed.');
    } catch (error: any) {
      addLog(`[Schedules] Save failed: ${error?.message || error}`);
      setAdminError(error?.message || 'Failed to save schedule');
    } finally {
      setIsScheduleSaving(false);
    }
  };
  const handleScheduleDelete = async (schedule: Schedule) => {
    if (!token) {
      addLog('[Schedules] Delete skipped: missing auth token.');
      return;
    }
    const confirmed = window.confirm(`Delete schedule "${schedule.name}"?`);
    if (!confirmed) {
      addLog(`[Schedules] Delete canceled by user for "${schedule.name}".`);
      return;
    }
    addLog(`[Schedules] Deleting schedule "${schedule.name}" (${schedule.id}).`);
    try {
      await deleteScheduleApi(token, schedule.id);
      if (editingSchedule?.id === schedule.id) setEditingSchedule(null);
      await refreshAdminData(token);
      addLog(`[Schedules] Delete succeeded for "${schedule.name}".`);
    } catch (error: any) {
      addLog(`[Schedules] Delete failed for "${schedule.name}": ${error?.message || error}`);
      setAdminError(error?.message || 'Failed to delete schedule');
    }
  };
  const handleScheduleRunNow = async (schedule: Schedule) => {
    if (!token) {
      addLog('[Schedules] Run-now skipped: missing auth token.');
      return;
    }
    addLog(`[Schedules] Manual run triggered for "${schedule.name}" (${schedule.id}).`);
    try {
      const run = await runScheduleNow(token, schedule.id);
      addLog(`[Schedules] Manual run completed for "${schedule.name}" with status=${run.status}, runId=${run.id}.`);
      await refreshAdminData(token);
      setActiveTab('runs');
    } catch (error: any) {
      addLog(`[Schedules] Manual run failed for "${schedule.name}": ${error?.message || error}`);
      setAdminError(error?.message || 'Failed to run schedule');
    }
  };
  const handleSchedulerConfigSave = async () => {
    if (!token) {
      addLog('[Scheduler] Config save skipped: missing auth token.');
      return;
    }
    setIsSchedulerSaving(true);
    setAdminError('');
    try {
      const cron = minutesToCron(schedulerIntervalMinutesDraft);
      addLog(`[Scheduler] Updating polling config: cron="${cron}", timezone="${schedulerTimezoneDraft.trim()}".`);
      const updated = await updateSchedulerConfigApi(token, {
        schedule: cron,
        timeZone: schedulerTimezoneDraft.trim(),
      });
      setSchedulerConfig(updated);
      setSchedulerIntervalMinutesDraft(cronToMinutes(updated.schedule || '') || 5);
      setSchedulerTimezoneDraft(updated.timeZone || 'Europe/Paris');
      addLog(`Updated scheduler polling to every ${cronToMinutes(updated.schedule || '') || schedulerIntervalMinutesDraft} minute(s) (${updated.timeZone}).`);
    } catch (error: any) {
      addLog(`[Scheduler] Config update failed: ${error?.message || error}`);
      setAdminError(error?.message || 'Failed to update scheduler polling');
    } finally {
      setIsSchedulerSaving(false);
    }
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
    void clearPersistedState();
  };
  const resultsItems = items.filter((item) => Date.now() - item.timestamp < ONE_HOUR_MS);
  const adminPanel = !token
    ? <LoginForm onLogin={handleAdminLogin} isLoading={isAuthLoading} />
    : <>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Schedule Manager</h2>
            <p className="text-sm text-slate-400">Cloud Scheduler can trigger these prompts in the background.</p>
          </div>
          <button onClick={clearAdminSession} className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700">Sign Out</button>
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
            <button onClick={() => void refreshAdminData(token)} disabled={isAdminRefreshing} className={`px-3 py-2 rounded-lg text-sm font-semibold ${isAdminRefreshing ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'}`}>{isAdminRefreshing ? 'Refreshing...' : 'Refresh'}</button>
            <ScheduleList schedules={schedules} onEdit={setEditingSchedule} onDelete={handleScheduleDelete} onRunNow={handleScheduleRunNow} />
          </div>
        </div>
      </>;

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-12">
      <header className="mb-10 text-center">
        <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-400 to-emerald-400 mb-2">Gemini Audio Summarizer</h1>
        <p className="text-slate-400">Manual prompts, scheduled runs, and stored audio from one app.</p>
      </header>
      <InputSection onProcess={processPrompts} isProcessing={isProcessingActive} />
      <div className="flex flex-wrap gap-3 mb-6">
        {(['results', 'player', 'history', 'schedules', 'runs'] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 ${activeTab === tab ? 'bg-slate-800 text-white border border-slate-600 shadow' : 'bg-slate-900 text-slate-400 border border-slate-800'}`}>
            {tab === 'player' && <ListMusic size={18} />}
            {tab === 'schedules' && <CalendarClock size={18} />}
            {tab}
          </button>
        ))}
        {!isProcessingActive && items.length > 0 && <button onClick={resetAll} className="ml-auto bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg border border-slate-700 transition-colors flex items-center gap-2"><RotateCcw size={18} /> Clear Session</button>}
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
          setItems={setItems}
          setSelectedItemId={setSelectedItemId}
          addLog={addLog}
          autoplayRequestId={playerAutoplayRequestId}
          onAutoplayRequestHandled={() => setPlayerAutoplayRequestId(null)}
        />
      )}

      {activeTab === 'history' && <div className="bg-slate-900 rounded-lg border border-slate-800 p-4 mb-10 space-y-4">
        <div className="flex flex-wrap items-center gap-3 justify-between border-b border-slate-800 pb-4"><div className="flex items-center gap-2 text-slate-200 font-semibold"><ListMusic size={18} /> History (Stored in IndexedDB)</div><div className="text-xs text-slate-500 italic">All manually generated items are stored here.</div></div>
        {!items.length && <div className="text-center py-10 text-slate-600 italic">No history items yet.</div>}
        <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
          {items.map((item) => <div key={item.id} className={`rounded-lg border p-4 flex flex-col gap-2 ${item.status === ItemStatus.PLAYING ? 'border-emerald-500/60 bg-emerald-500/10' : selectedItemId === item.id ? 'border-blue-500/60 bg-blue-500/5' : 'border-slate-800 bg-slate-800/40'}`}><div className="flex justify-between items-start gap-4"><div className="min-w-0 flex-1"><div className="text-xs text-slate-500 mb-1">{new Date(item.timestamp).toLocaleString()}</div><div className="text-sm font-bold text-slate-100 break-words mb-1">{item.prompt}</div><div className="text-xs text-slate-400 line-clamp-2">{item.answer || 'No answer'}</div></div><div className="flex flex-col gap-2 shrink-0 w-32"><button onClick={() => { if (!item.audioBuffer) return; setSelectedItemId(item.id); setPlayerAutoplayRequestId(`manual:${item.id}`); setActiveTab('player'); }} disabled={!item.audioBuffer} className={`px-3 py-2 rounded-md text-sm font-semibold flex items-center gap-2 justify-center ${item.audioBuffer ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}><PlayCircle size={16} /> Play</button><button onClick={(e) => { e.stopPropagation(); const target = items.find((entry) => entry.id === item.id); if (!target || !window.confirm(`Delete "${target.prompt.substring(0, 30)}..."?`)) return; processingQueueRef.current = processingQueueRef.current.filter((queueId) => queueId !== item.id); if (selectedItemId === item.id) { setSelectedItemId(null); } if (playerAutoplayRequestId === `manual:${item.id}`) { setPlayerAutoplayRequestId(null); } setItems((prev) => prev.filter((entry) => entry.id !== item.id)); }} className="px-3 py-2 rounded-md text-sm font-semibold bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-900/30 flex items-center gap-2 justify-center"><Trash2 size={16} /> Delete</button></div></div></div>)}
        </div>
      </div>}

      {activeTab === 'schedules' && <div className="space-y-4">{adminPanel}</div>}
      {activeTab === 'runs' && <div className="space-y-4">{!token ? <LoginForm onLogin={handleAdminLogin} isLoading={isAuthLoading} /> : <><div className="flex items-center justify-between"><div><h2 className="text-xl font-semibold text-white">Scheduled Runs</h2><p className="text-sm text-slate-400">Latest automated or manual schedule executions.</p></div><button onClick={() => void refreshAdminData(token)} disabled={isAdminRefreshing} className={`px-3 py-2 rounded-lg text-sm font-semibold ${isAdminRefreshing ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'}`}>{isAdminRefreshing ? 'Refreshing...' : 'Refresh'}</button></div>{adminError && <div className="text-sm text-red-400 bg-red-950/30 border border-red-900/30 rounded-md p-3">{adminError}</div>}<RunHistoryList runs={runs} /></>}</div>}
    </div>
  );
};

export default App;
