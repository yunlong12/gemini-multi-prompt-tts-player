import { ItemStatus, ManualRun, Schedule, SchedulerConfig, ScheduleRun } from '../../types';
import { PersistedState } from '../../utils/storage';

const nowIso = new Date().toISOString();

export const makeSession = () => ({
  expiresAt: '2026-03-16T10:00:00.000Z',
});

export const makeManualRun = (overrides: Partial<ManualRun> = {}): ManualRun => ({
  id: 'manual-1',
  prompt: 'Daily summary',
  status: 'success',
  generatedText: 'Generated answer',
  groundingLinks: [{ uri: 'https://example.com/article', title: 'Example' }],
  ttsModel: 'gemini-2.5-pro-preview-tts',
  toolOptions: {
    enableGoogleSearch: true,
    enableUrlContext: false,
  },
  audioPath: 'audio/manual-1.wav',
  audioDownloadUrl: '/api/artifacts/audio/manual-1.wav',
  textPath: 'text/manual-1.json',
  createdAt: nowIso,
  updatedAt: nowIso,
  finishedAt: nowIso,
  ...overrides,
});

export const makeSchedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: 'schedule-1',
  name: 'Morning Briefing',
  promptTemplate: 'Summarize {{today}}.',
  enableGoogleSearch: true,
  enableUrlContext: false,
  enabled: true,
  timezone: 'Europe/Paris',
  frequency: 'daily',
  timeOfDay: '08:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  intervalMinutes: 1440,
  ttsModel: 'gemini-2.5-pro-preview-tts',
  outputPrefix: 'daily-briefings',
  nextRunAt: '2026-03-16T08:00:00.000Z',
  lastStatus: 'success',
  lastError: '',
  createdAt: nowIso,
  updatedAt: nowIso,
  ...overrides,
});

export const makeRun = (overrides: Partial<ScheduleRun> = {}): ScheduleRun => ({
  id: 'run-1',
  scheduleId: 'schedule-1',
  startedAt: nowIso,
  finishedAt: nowIso,
  status: 'success',
  triggeredBy: 'scheduler',
  resolvedPrompt: 'Morning Briefing prompt',
  generatedText: 'Run output',
  groundingLinks: [{ uri: 'https://example.com/run', title: 'Run source' }],
  audioPath: 'audio/run-1.wav',
  audioDownloadUrl: '/api/artifacts/audio/run-1.wav',
  textPath: 'text/run-1.json',
  ...overrides,
});

export const makeSchedulerConfig = (overrides: Partial<SchedulerConfig> = {}): SchedulerConfig => ({
  jobName: 'schedule-runner',
  location: 'europe-west1',
  schedule: '*/5 * * * *',
  timeZone: 'Europe/Paris',
  uri: 'https://example.com/job',
  state: 'ENABLED',
  ...overrides,
});

export const makePersistedState = (): PersistedState => ({
  items: [
    {
      id: 'persisted-manual-1',
      prompt: 'Persisted prompt',
      answer: 'Persisted answer',
      groundingLinks: [],
      audioBase64: 'UklGRgEAAABXQVZF',
      audioPath: 'audio/persisted-manual-1.wav',
      audioDownloadUrl: '/api/artifacts/audio/persisted-manual-1.wav',
      textPath: 'text/persisted-manual-1.json',
      status: ItemStatus.READY,
      timestamp: Date.parse(nowIso),
    },
  ],
  scheduledRuns: [
    {
      id: 'persisted-run-1',
      scheduleId: 'schedule-1',
      startedAt: nowIso,
      status: 'success',
      triggeredBy: 'scheduler',
      resolvedPrompt: 'Persisted scheduled prompt',
      generatedText: 'Persisted scheduled body',
      groundingLinks: [],
      audioPath: 'audio/persisted-run-1.wav',
      audioDownloadUrl: '/api/artifacts/audio/persisted-run-1.wav',
      cacheStatus: 'cached',
    },
  ],
  recentPrompts: [],
  updatedAt: Date.parse(nowIso),
});
