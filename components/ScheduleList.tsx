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
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
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

            <div className="flex shrink-0 flex-col gap-2">
              <button
                onClick={() => onRunNow(schedule)}
                className="px-3 py-2 rounded-md text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2"
              >
                <PlayCircle size={15} /> Run
              </button>
              <button
                onClick={() => onEdit(schedule)}
                className="px-3 py-2 rounded-md text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-2"
              >
                <Pencil size={15} /> Edit
              </button>
              <button
                onClick={() => onDelete(schedule)}
                className="px-3 py-2 rounded-md text-sm font-semibold bg-red-950/40 hover:bg-red-950/60 text-red-300 border border-red-900/40 flex items-center gap-2"
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
