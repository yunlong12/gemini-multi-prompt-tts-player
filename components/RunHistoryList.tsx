import React from 'react';
import { Download, Link2, PlayCircle } from 'lucide-react';
import { ScheduleRun } from '../types';

interface RunHistoryListProps {
  runs: ScheduleRun[];
}

export const RunHistoryList: React.FC<RunHistoryListProps> = ({ runs }) => {
  const getAudioUrl = (run: ScheduleRun) => {
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
      {runs.map((run) => {
        const audioUrl = getAudioUrl(run);
        const textUrl = getTextUrl(run);

        return (
          <div key={run.id} className="bg-slate-900 rounded-lg border border-slate-800 p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">
                  {run.status === 'success' ? 'Successful Run' : run.status === 'error' ? 'Failed Run' : 'Running'}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(run.startedAt).toLocaleString()} | {run.triggeredBy}
                </div>
              </div>
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
                  className="inline-flex items-center gap-2 text-sm text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2"
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
                  className="inline-flex items-center gap-2 text-sm text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg px-3 py-2"
                >
                  <Download size={15} /> Download Audio
                </a>
              </div>
            )}

            {!audioUrl && (
              <div className="text-xs text-slate-500 flex items-center gap-2">
                <PlayCircle size={13} /> Audio file unavailable for this run.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
