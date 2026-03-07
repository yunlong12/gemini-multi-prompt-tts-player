import React from 'react';
import { CalendarClock, Pencil, PlayCircle, Trash2 } from 'lucide-react';
import { Schedule } from '../types';

interface ScheduleListProps {
  schedules: Schedule[];
  onEdit: (schedule: Schedule) => void;
  onDelete: (schedule: Schedule) => void;
  onRunNow: (schedule: Schedule) => void;
}

export const ScheduleList: React.FC<ScheduleListProps> = ({ schedules, onEdit, onDelete, onRunNow }) => {
  if (schedules.length === 0) {
    return (
      <div className="bg-slate-900 rounded-lg border border-dashed border-slate-800 p-6 text-sm text-slate-500">
        No schedules yet. Create one to start automated runs.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {schedules.map((schedule) => (
        <div key={schedule.id} className="bg-slate-900 rounded-lg border border-slate-800 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-white font-semibold">
                <CalendarClock size={16} />
                <span className="truncate">{schedule.name}</span>
              </div>
              <div className="mt-1 text-xs text-slate-500">
                {schedule.enabled ? 'Enabled' : 'Disabled'} · {schedule.frequency} · Next run {new Date(schedule.nextRunAt).toLocaleString()}
              </div>
              <div className="mt-2 text-sm text-slate-300 line-clamp-3">{schedule.promptTemplate}</div>
              <div className="mt-2 text-xs text-slate-500">
                Last status: {schedule.lastStatus || 'idle'}
                {schedule.lastError ? ` · ${schedule.lastError}` : ''}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-col">
              <button
                onClick={() => onRunNow(schedule)}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 sm:justify-start"
              >
                <PlayCircle size={15} /> Run
              </button>
              <button
                onClick={() => onEdit(schedule)}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 sm:justify-start"
              >
                <Pencil size={15} /> Edit
              </button>
              <button
                onClick={() => onDelete(schedule)}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-red-900/40 bg-red-950/40 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-950/60 sm:justify-start"
              >
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
