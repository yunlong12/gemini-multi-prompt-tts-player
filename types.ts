export interface GroundingUrl {
  uri: string;
  title: string;
}

export interface GeminiToolOptions {
  enableGoogleSearch?: boolean;
  enableUrlContext?: boolean;
}

export interface AudioPart {
  partIndex: number;
  partCount: number;
  text: string;
  audioPath?: string;
  audioDownloadUrl?: string;
  durationSeconds?: number;
  audioBase64?: string;
}

export type ManualRunStatus = 'queued' | 'generating_text' | 'generating_audio' | 'success' | 'error';

export interface ManualRunProgressEntry {
  ts: string;
  message: string;
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
  audioPath?: string;
  audioDownloadUrl?: string;
  textPath?: string;
  audioParts?: AudioPart[];
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
  audioParts?: AudioPart[];
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

export interface PlayerQueueSegment {
  key: string;
  playerItemId: string;
  partIndex?: number;
  partCount?: number;
  audioPath?: string;
  legacy: boolean;
}

export interface PlayerUiState {
  checkedPlayerItemIds: Record<string, boolean>;
  selectedPlayerItemId: string | null;
  expandedAudioPartKeys: Record<string, boolean>;
  currentlyPlayingPlayerItemId: string | null;
  currentlyPlayingPartIndex: number | null;
  playerProgress: number;
  playerDuration: number;
  isPlayerPlaying: boolean;
  isPlayingSequence: boolean;
  queue: PlayerQueueSegment[];
  queueIndex: number;
  pauseOffset: number;
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
  audioParts?: AudioPart[];
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

export interface ManualRun {
  id: string;
  prompt: string;
  status: ManualRunStatus;
  generatedText?: string;
  groundingLinks: GroundingUrl[];
  ttsModel: string;
  toolOptions?: GeminiToolOptions;
  audioPath?: string;
  audioParts?: AudioPart[];
  audioDownloadUrl?: string;
  textPath?: string;
  errorMessage?: string;
  progressLogs?: ManualRunProgressEntry[];
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface SchedulerConfig {
  jobName: string;
  location: string;
  schedule: string;
  timeZone: string;
  uri: string;
  state: string;
}
