import React, { useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp, Pencil, PlayCircle, Power, Trash2 } from 'lucide-react';
import { Schedule } from '../types';

interface ScheduleListProps {
  schedules: Schedule[];
  onEdit: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
  onRunNow: (schedule: Schedule) => void;
  onToggleEnabled: (schedule: Schedule) => void;
  editingScheduleId: string | null;
  pendingScheduleActionId: string | null;
  pendingScheduleActionType: 'edit' | 'run-now' | 'toggle-enabled' | 'delete' | null;
}

const PROMPT_PREVIEW_LIMIT = 220;
const ERROR_PREVIEW_LIMIT = 240;

const truncateText = (value: string, limit: number) => {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (normalized.length <= limit) {
    return { text: normalized, truncated: false };
  }
  return {
    text: `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}...`,
    truncated: true,
  };
};

const summarizeScheduleError = (error: string) => {
  const raw = String(error || '').trim();
  if (!raw) return '';

  const normalized = raw.replace(/\s+/g, ' ');
  if (/RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(normalized)) {
    return 'Gemini quota or rate limit reached. Retry later, use another key, or reduce TTS load.';
  }
  if (/signBlob|iam\.serviceAccounts\.signBlob/i.test(normalized)) {
    return 'Artifact URL signing failed. Check Cloud Run service account signed URL permissions.';
  }
  if (/deadline|timeout/i.test(normalized)) {
    return 'The scheduled run timed out before finishing. Consider a shorter prompt or lower TTS load.';
  }
  return normalized;
};

const formatNextRun = (value?: string) => {
  if (!value) return 'No next run scheduled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No next run scheduled';
  return parsed.toLocaleString();
};

export const ScheduleList: React.FC<ScheduleListProps> = ({
  schedules,
  onEdit,
  onDelete,
  onRunNow,
  onToggleEnabled,
  editingScheduleId,
  pendingScheduleActionId,
  pendingScheduleActionType,
}) => {
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});
  const [expandedErrors, setExpandedErrors] = useState<Record<string, boolean>>({});

  const togglePrompt = (scheduleId: string) =>
    setExpandedPrompts((prev) => ({ ...prev, [scheduleId]: !prev[scheduleId] }));

  const toggleError = (scheduleId: string) =>
    setExpandedErrors((prev) => ({ ...prev, [scheduleId]: !prev[scheduleId] }));

  if (schedules.length === 0) {
    return (
      <div className="rounded-[1.4rem] border border-dashed border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-500">
        No schedules yet. Create one to start automated runs.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {schedules.map((schedule) => {
        const status = String(schedule.lastStatus || 'idle').toLowerCase();
        const isPromptExpanded = Boolean(expandedPrompts[schedule.id]);
        const isErrorExpanded = Boolean(expandedErrors[schedule.id]);
        const promptPreview = truncateText(schedule.promptTemplate, PROMPT_PREVIEW_LIMIT);
        const errorSummary = summarizeScheduleError(schedule.lastError || '');
        const errorPreview = truncateText(errorSummary, ERROR_PREVIEW_LIMIT);
        const hasLongPrompt = promptPreview.truncated;
        const hasLongError =
          Boolean(schedule.lastError) &&
          (errorPreview.truncated || errorSummary !== String(schedule.lastError || '').trim());

        const enabledTone = schedule.enabled
          ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100'
          : 'border-slate-700 bg-slate-800/60 text-slate-400';
        const isEditing = editingScheduleId === schedule.id;
        const isPendingAction = pendingScheduleActionId === schedule.id;
        const isPendingRunNow = isPendingAction && pendingScheduleActionType === 'run-now';
        const isPendingToggle = isPendingAction && pendingScheduleActionType === 'toggle-enabled';
        const isPendingDelete = isPendingAction && pendingScheduleActionType === 'delete';

        const statusTone =
          status === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
            : status === 'error'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              : status === 'running'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                : 'border-slate-700 bg-slate-800/60 text-slate-300';

        return (
          <div
            key={schedule.id}
            className={`rounded-[1.4rem] border p-4 shadow-[0_18px_50px_-28px_rgba(15,23,42,0.9)] sm:p-5 transition ${
              isEditing ? 'border-cyan-500/50 bg-slate-900 shadow-[0_22px_60px_-24px_rgba(6,182,212,0.35)]' : 'border-slate-800 bg-slate-900/95'
            }`}
          >
            <div className="space-y-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-white">
                      <div className="rounded-full border border-slate-700 bg-slate-800/80 p-2 text-slate-200">
                        <CalendarClock size={16} />
                      </div>
                      <h3 className="truncate text-lg font-semibold tracking-tight sm:text-xl">{schedule.name}</h3>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">Automated prompt with clearer mobile controls, summary, and run status.</p>
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] ${enabledTone}`}>
                    {schedule.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Frequency</div>
                    <div className="mt-1 text-sm font-medium text-slate-100">{schedule.frequency}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Timezone</div>
                    <div className="mt-1 text-sm font-medium text-slate-100">{schedule.timezone || 'Europe/Paris'}</div>
                  </div>
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-200/70">Next Run</div>
                    <div className="mt-1 text-sm font-medium text-cyan-50">{formatNextRun(schedule.nextRunAt)}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-[1.15rem] border border-slate-800 bg-slate-950/55 p-3">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Prompt Preview</div>
                <div className="text-sm leading-6 text-slate-200">
                  {isPromptExpanded ? schedule.promptTemplate : promptPreview.text}
                </div>
                {hasLongPrompt && (
                  <button
                    type="button"
                    onClick={() => togglePrompt(schedule.id)}
                    className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:bg-slate-800"
                  >
                    {isPromptExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {isPromptExpanded ? 'Collapse prompt' : 'Expand prompt'}
                  </button>
                )}
              </div>

              <div className={`rounded-[1.15rem] border p-3 ${statusTone}`}>
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 rounded-full p-2 ${status === 'error' ? 'bg-rose-500/15 text-rose-200' : status === 'running' ? 'bg-amber-500/15 text-amber-100' : 'bg-slate-700/60 text-slate-200'}`}>
                    <AlertTriangle size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.22em] opacity-70">Last Status</span>
                      <span className="rounded-full border border-current/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]">
                        {status}
                      </span>
                    </div>
                    {schedule.lastError ? (
                      <>
                        <div className="mt-2 text-sm leading-6 text-current/90">
                          {isErrorExpanded ? schedule.lastError : errorPreview.text}
                        </div>
                        {hasLongError && (
                          <button
                            type="button"
                            onClick={() => toggleError(schedule.id)}
                            className="mt-3 inline-flex items-center gap-2 rounded-full border border-current/20 bg-slate-950/30 px-3 py-1.5 text-xs font-semibold text-current transition hover:bg-slate-950/50"
                          >
                            {isErrorExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            {isErrorExpanded ? 'Hide details' : 'Show details'}
                          </button>
                        )}
                      </>
                    ) : (
                      <div className="mt-2 text-sm leading-6 text-current/85">
                        {status === 'success'
                          ? 'The latest automated run completed successfully.'
                          : status === 'running'
                            ? 'A run is currently in progress.'
                            : 'No recent errors reported.'}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-[1.15rem] border border-slate-800 bg-slate-950/55 p-3">
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Actions</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.25fr),repeat(3,minmax(0,1fr))]">
                  <button
                    type="button"
                    onClick={() => onRunNow(schedule)}
                    disabled={isPendingAction}
                    className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                      isPendingAction
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500'
                    }`}
                  >
                    <PlayCircle size={16} /> {isPendingRunNow ? 'Running...' : 'Run now'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onEdit(schedule)}
                    disabled={isPendingAction}
                    className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      isEditing
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-100'
                        : isPendingAction
                          ? 'border-slate-800 bg-slate-800 text-slate-500 cursor-not-allowed'
                          : 'border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                    }`}
                  >
                    <Pencil size={16} /> {isEditing ? 'Editing' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(schedule)}
                    disabled={isPendingAction}
                    className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      isPendingAction
                        ? 'border-slate-800 bg-slate-800 text-slate-500 cursor-not-allowed'
                        : 'border-red-900/40 bg-red-950/40 text-red-300 hover:bg-red-950/60'
                    }`}
                  >
                    <Trash2 size={16} /> {isPendingDelete ? 'Deleting...' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleEnabled(schedule)}
                    disabled={isPendingAction}
                    className={`flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${
                      isPendingAction ? 'border-slate-800 bg-slate-800 text-slate-500 cursor-not-allowed' : enabledTone
                    }`}
                  >
                    <Power size={16} />
                    {isPendingToggle ? (schedule.enabled ? 'Disabling...' : 'Enabling...') : schedule.enabled ? 'Schedule enabled' : 'Schedule disabled'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
