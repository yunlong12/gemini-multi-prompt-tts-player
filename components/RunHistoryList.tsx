import React from 'react';
import { CheckSquare, Download, Link2, PlayCircle, Trash2 } from 'lucide-react';
import { ScheduleRun } from '../types';
import { formatPartLabel } from '../utils/ttsChunks';

interface RunHistoryListProps {
  runs: ScheduleRun[];
  selectedRunIds: Set<string>;
  pendingRunDeleteIds: string[];
  isDeletingRuns: boolean;
  onToggleRunSelection: (runId: string, checked: boolean) => void;
  onSelectAllRuns: () => void;
  onClearRunSelection: () => void;
  onRequestDeleteRun: (runId: string) => void;
  onRequestBulkDeleteRuns: () => void;
}

export const RunHistoryList: React.FC<RunHistoryListProps> = ({
  runs,
  selectedRunIds,
  pendingRunDeleteIds,
  isDeletingRuns,
  onToggleRunSelection,
  onSelectAllRuns,
  onClearRunSelection,
  onRequestDeleteRun,
  onRequestBulkDeleteRuns,
}) => {
  const orderedRuns = [...runs];
  const selectedCount = orderedRuns.filter((run) => selectedRunIds.has(run.id)).length;
  const allRunsSelected = orderedRuns.length > 0 && selectedCount === orderedRuns.length;
  const pendingDeleteIdSet = new Set(pendingRunDeleteIds);
  const getAudioUrl = (run: ScheduleRun) => {
    if (run.audioParts?.length) {
      return '';
    }
    if (run.audioPath) {
      return `/api/artifacts/${encodeURIComponent(run.audioPath)}`;
    }
    return run.audioDownloadUrl || '';
  };

  const getTextUrl = (run: ScheduleRun) => {
    if (!run.textPath) {
      return '';
    }
    return `/api/artifacts/${encodeURIComponent(run.textPath)}`;
  };

  if (runs.length === 0) {
    return (
      <div className="bg-slate-900 rounded-lg border border-dashed border-slate-800 p-6 text-sm text-slate-500">
        No scheduled runs yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-slate-800 bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(17,24,39,0.96))] p-4 shadow-[0_24px_64px_rgba(15,23,42,0.25)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200">
              <CheckSquare size={14} />
              Runs Console
            </div>
            <div className="text-sm text-slate-200">{orderedRuns.length} visible run(s)</div>
            <div className="text-xs text-slate-400">{selectedCount} selected</div>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={onSelectAllRuns}
              disabled={!orderedRuns.length || allRunsSelected || isDeletingRuns}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold ${
                !orderedRuns.length || allRunsSelected || isDeletingRuns
                  ? 'border-slate-800 bg-slate-900/50 text-slate-500'
                  : 'border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800'
              }`}
            >
              Select All Runs
            </button>
            <button
              type="button"
              onClick={onClearRunSelection}
              disabled={!selectedCount || isDeletingRuns}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-sm font-semibold ${
                !selectedCount || isDeletingRuns
                  ? 'border-slate-800 bg-slate-900/50 text-slate-500'
                  : 'border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800'
              }`}
            >
              Clear Selection
            </button>
            <button
              type="button"
              onClick={onRequestBulkDeleteRuns}
              disabled={!selectedCount || isDeletingRuns}
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold ${
                !selectedCount || isDeletingRuns
                  ? 'bg-red-950/40 text-red-300/50'
                  : 'bg-red-500 text-white shadow-[0_10px_30px_rgba(239,68,68,0.35)] hover:bg-red-400'
              }`}
            >
              <Trash2 size={15} />
              Delete Selected
            </button>
          </div>
        </div>
      </div>
      {orderedRuns.map((run) => {
        const audioUrl = getAudioUrl(run);
        const textUrl = getTextUrl(run);
        const partLabel = !run.audioParts?.length ? formatPartLabel(run.partIndex, run.partCount) : '';
        const isSelected = selectedRunIds.has(run.id);
        const isPendingDelete = pendingDeleteIdSet.has(run.id);
        const title = run.resolvedPrompt || run.generatedText || run.id;

        return (
          <div
            key={run.id}
            className={`rounded-2xl border p-4 space-y-3 transition-colors ${
              isPendingDelete
                ? 'border-red-500/40 bg-red-950/10 opacity-70'
                : isSelected
                  ? 'border-cyan-500/50 bg-cyan-500/10 shadow-[0_18px_50px_rgba(8,145,178,0.12)]'
                  : 'border-slate-800 bg-slate-900'
            }`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 flex-1 gap-3">
                <label className="mt-1 flex shrink-0 items-start">
                  <input
                    type="checkbox"
                    aria-label={`Select run ${title}`}
                    checked={isSelected}
                    disabled={isDeletingRuns}
                    onChange={(event) => onToggleRunSelection(run.id, event.target.checked)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-500"
                  />
                </label>
                <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">
                  {run.status === 'success' ? 'Successful Run' : run.status === 'error' ? 'Failed Run' : 'Running'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(run.startedAt).toLocaleString()} | {run.triggeredBy}
                </div>
                {partLabel && <div className="mt-2 text-[10px] uppercase tracking-wide text-slate-300">{partLabel}</div>}
                </div>
              </div>
              <div className="flex shrink-0 flex-row items-center justify-between gap-2 sm:flex-col sm:items-end">
                <div
                  className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    run.status === 'success'
                      ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-900/40'
                      : run.status === 'error'
                        ? 'bg-red-950/40 text-red-300 border border-red-900/40'
                        : 'bg-blue-950/40 text-blue-300 border border-blue-900/40'
                  }`}
                >
                  {run.status}
                </div>
                <button
                  type="button"
                  onClick={() => onRequestDeleteRun(run.id)}
                  disabled={isDeletingRuns}
                  aria-label={`Delete run ${title}`}
                  className={`inline-flex min-h-[40px] items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                    isDeletingRuns
                      ? 'border-red-900/30 bg-red-950/20 text-red-300/40'
                      : 'border-red-900/40 bg-red-950/20 text-red-300 hover:bg-red-950/40'
                  }`}
                >
                  <Trash2 size={13} />
                  Delete
                </button>
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-slate-300 bg-slate-950/60 border border-slate-800 rounded-md p-3">
              {run.generatedText || run.errorMessage || run.resolvedPrompt}
            </div>

            {run.groundingLinks?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {run.groundingLinks.slice(0, 5).map((link, index) => (
                  <a
                    key={`${run.id}-${index}`}
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

            {textUrl && (
              <div>
                <a
                  href={textUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                >
                  <Download size={15} /> Open JSON
                </a>
              </div>
            )}

            {audioUrl && (
              <div className="space-y-2">
                <audio controls preload="none" src={audioUrl} className="w-full" />
                <a
                  href={audioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 hover:bg-slate-700"
                >
                  <Download size={15} /> Download Audio
                </a>
              </div>
            )}

            {run.audioParts?.length ? (
              <details className="rounded-md border border-slate-800 bg-slate-950/40">
                <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-slate-200">
                  Audio Parts ({run.audioParts.length})
                </summary>
                <div className="border-t border-slate-800 px-3 py-3 space-y-3">
                  {[...run.audioParts].sort((a, b) => a.partIndex - b.partIndex).map((part) => (
                    <div key={`${run.id}-${part.partIndex}`} className="rounded-md border border-slate-800 bg-slate-900/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                            {formatPartLabel(part.partIndex, part.partCount)}
                          </div>
                          <div className="mt-1 text-xs text-slate-400 whitespace-pre-wrap break-words">
                            {part.text}
                          </div>
                        </div>
                        {part.audioPath ? (
                          <a
                            href={`/api/artifacts/${encodeURIComponent(part.audioPath)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-xs text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2"
                          >
                            <Download size={13} /> Download
                          </a>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            ) : null}

            {!audioUrl && (
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <PlayCircle size={13} /> {run.audioParts?.length ? 'Use the Player tab to play parts in sequence.' : 'Audio file unavailable for this run.'}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
