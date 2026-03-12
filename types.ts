export interface GroundingUrl {
  uri: string;
  title: string;
}

export interface GeminiToolOptions {
  enableGoogleSearch?: boolean;
  enableUrlContext?: boolean;
}

export enum ItemStatus {
  QUEUED = 'QUEUED',
  IDLE = 'IDLE',
  GENERATING_TEXT = 'GENERATING_TEXT',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  READY = 'READY',
  ERROR = 'ERROR',
  PLAYING = 'PLAYING',
}

export interface ProcessItem {
  id: string;
  prompt: string;
  answer: string | null;
  audioBuffer: AudioBuffer | null;
  audioBase64?: string;
  ttsModel?: string;
  enableGoogleSearch?: boolean;
  enableUrlContext?: boolean;
  partIndex?: number;
  partCount?: number;
  partGroupId?: string;
  status: ItemStatus;
  groundingLinks: GroundingUrl[];
  error?: string;
  timestamp: number;
}

export type PlayerItemSource = 'manual' | 'scheduled';
export type PlayerItemStatus =
  | 'ready'
  | 'queued'
  | 'downloading'
  | 'decoding'
  | 'cached'
  | 'error'
  | 'playing';

export interface PlayerItem {
  id: string;
  source: PlayerItemSource;
  title: string;
  timestamp: number;
  partIndex?: number;
  partCount?: number;
  partGroupId?: string;
  status: PlayerItemStatus;
  promptText: string;
  bodyText: string;
  groundingLinks: GroundingUrl[];
  audioBuffer: AudioBuffer | null;
  audioUrl?: string;
  downloadUrl?: string;
  localAudioBase64?: string;
  error?: string;
  ttsModel?: string;
}

export type ScheduleFrequency = 'daily' | 'weekly' | 'custom_interval';

export interface Schedule {
  id: string;
  name: string;
  promptTemplate: string;
  enableGoogleSearch?: boolean;
  enableUrlContext?: boolean;
  enabled: boolean;
  timezone: string;
  frequency: ScheduleFrequency;
  timeOfDay: string;
  daysOfWeek?: number[];
  intervalMinutes?: number;
  ttsModel: string;
  outputPrefix: string;
  lastRunAt?: string;
  nextRunAt: string;
  lastStatus?: 'idle' | 'running' | 'success' | 'error';
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRun {
  id: string;
  scheduleId: string;
  startedAt: string;
  finishedAt?: string;
  status: 'running' | 'success' | 'error';
  triggeredBy: 'manual' | 'scheduler';
  resolvedPrompt: string;
  generatedText?: string;
  groundingLinks: GroundingUrl[];
  audioPath?: string;
  textPath?: string;
  audioDownloadUrl?: string;
  errorMessage?: string;
  partIndex?: number;
  partCount?: number;
  partGroupId?: string;
}

export interface AuthSession {
  expiresAt: string;
}

export interface SchedulerConfig {
  jobName: string;
  location: string;
  schedule: string;
  timeZone: string;
  uri: string;
  state: string;
}
