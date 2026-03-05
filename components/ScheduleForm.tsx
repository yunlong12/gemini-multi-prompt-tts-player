import React, { useEffect, useState } from 'react';
import { Schedule, ScheduleFrequency } from '../types';

interface ScheduleFormProps {
  initialValue?: Schedule | null;
  onSubmit: (payload: Partial<Schedule>) => Promise<void>;
  onCancel: () => void;
  isSaving: boolean;
}

const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const defaultDraft: Partial<Schedule> = {
  name: '',
  promptTemplate: '',
  enabled: true,
  timezone: 'Europe/Paris',
  frequency: 'daily',
  timeOfDay: '08:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  intervalMinutes: 1440,
  ttsModel: 'gemini-2.5-pro-preview-tts',
  outputPrefix: 'daily-briefings',
};

export const ScheduleForm: React.FC<ScheduleFormProps> = ({ initialValue, onSubmit, onCancel, isSaving }) => {
  const [draft, setDraft] = useState<Partial<Schedule>>(defaultDraft);

  useEffect(() => {
    setDraft(initialValue ? { ...initialValue } : defaultDraft);
  }, [initialValue]);

  const frequency = (draft.frequency || 'daily') as ScheduleFrequency;

  const toggleDay = (day: number) => {
    const existing = new Set(draft.daysOfWeek || []);
    if (existing.has(day)) {
      existing.delete(day);
    } else {
      existing.add(day);
    }
    setDraft((prev) => ({ ...prev, daysOfWeek: Array.from(existing).sort((a, b) => a - b) }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(draft);
  };

  return (
    <form onSubmit={handleSubmit} className="bg-slate-900 rounded-lg border border-slate-800 p-5 space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          <span className="mb-1 block">Name</span>
          <input
            value={draft.name || ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label className="block text-sm text-slate-300">
          <span className="mb-1 block">Timezone</span>
          <input
            value={draft.timezone || 'Europe/Paris'}
            onChange={(e) => setDraft((prev) => ({ ...prev, timezone: e.target.value }))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
      </div>

      <label className="block text-sm text-slate-300">
        <span className="mb-1 block">Prompt Template</span>
        <textarea
          value={draft.promptTemplate || ''}
          onChange={(e) => setDraft((prev) => ({ ...prev, promptTemplate: e.target.value }))}
          rows={5}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500 resize-y"
        />
        <span className="mt-1 block text-xs text-slate-500">{'Supports {{today}}, {{yesterday}}, {{timezone}}.'}</span>
      </label>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block text-sm text-slate-300">
          <span className="mb-1 block">Frequency</span>
          <select
            value={frequency}
            onChange={(e) => setDraft((prev) => ({ ...prev, frequency: e.target.value as ScheduleFrequency }))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="custom_interval">Custom Interval</option>
          </select>
        </label>

        {frequency !== 'custom_interval' && (
          <label className="block text-sm text-slate-300">
            <span className="mb-1 block">Time</span>
            <input
              type="time"
              value={draft.timeOfDay || '08:00'}
              onChange={(e) => setDraft((prev) => ({ ...prev, timeOfDay: e.target.value }))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        )}

        {frequency === 'custom_interval' && (
          <label className="block text-sm text-slate-300">
            <span className="mb-1 block">Interval Minutes</span>
            <input
              type="number"
              min={1}
              value={draft.intervalMinutes || 60}
              onChange={(e) => setDraft((prev) => ({ ...prev, intervalMinutes: Number(e.target.value) }))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        )}

        <label className="block text-sm text-slate-300">
          <span className="mb-1 block">TTS Model</span>
          <select
            value={draft.ttsModel || 'gemini-2.5-pro-preview-tts'}
            onChange={(e) => setDraft((prev) => ({ ...prev, ttsModel: e.target.value }))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="gemini-2.5-pro-preview-tts">Gemini 2.5 Pro TTS</option>
            <option value="gemini-2.5-flash-preview-tts">Gemini 2.5 Flash TTS</option>
          </select>
        </label>
      </div>

      {frequency === 'weekly' && (
        <div className="text-sm text-slate-300">
          <span className="mb-2 block">Days of Week</span>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {dayLabels.map((label, index) => {
              const active = (draft.daysOfWeek || []).includes(index);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleDay(index)}
                  className={`rounded-lg px-2 py-2 text-xs font-semibold border ${
                    active
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-950 text-slate-400 border-slate-700'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block text-sm text-slate-300">
          <span className="mb-1 block">Output Prefix</span>
          <input
            value={draft.outputPrefix || 'daily-briefings'}
            onChange={(e) => setDraft((prev) => ({ ...prev, outputPrefix: e.target.value }))}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>

        <label className="flex items-center gap-3 text-sm text-slate-300 pt-6">
          <input
            type="checkbox"
            checked={draft.enabled ?? true}
            onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
            className="h-4 w-4 accent-blue-500"
          />
          Enabled
        </label>
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={isSaving}
          className={`px-4 py-2 rounded-lg font-semibold ${
            isSaving ? 'bg-slate-800 text-slate-500' : 'bg-blue-600 hover:bg-blue-500 text-white'
          }`}
        >
          {isSaving ? 'Saving...' : initialValue ? 'Update Schedule' : 'Create Schedule'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg font-semibold bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};
