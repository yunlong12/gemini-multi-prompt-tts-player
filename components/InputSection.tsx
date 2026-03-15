import React, { useState } from 'react';
import { PlayCircle, MessageSquarePlus, Settings2 } from 'lucide-react';
import { GeminiToolOptions } from '../types';

interface InputSectionProps {
  onProcess: (prompts: string[], ttsModel: string, toolOptions: GeminiToolOptions) => void;
  isProcessing: boolean;
  warningMessage?: string;
}

export const InputSection: React.FC<InputSectionProps> = ({ onProcess, isProcessing, warningMessage }) => {
  const [inputText, setInputText] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro-preview-tts');
  const [enableGoogleSearch, setEnableGoogleSearch] = useState(true);
  const [enableUrlContext, setEnableUrlContext] = useState(false);

  const handleProcess = () => {
    if (!inputText.trim() || warningMessage) return;
    const prompts = inputText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (prompts.length > 0) {
      onProcess(prompts, selectedModel, { enableGoogleSearch, enableUrlContext });
      setInputText('');
    }
  };

  return (
    <div className="mb-8 overflow-hidden rounded-[1.75rem] border border-slate-700/80 bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_28%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(15,23,42,0.9))] p-4 shadow-[0_26px_70px_-40px_rgba(15,23,42,1)] sm:p-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
        <h2 className="text-xl font-semibold flex items-center gap-2 text-blue-300">
          <MessageSquarePlus size={24} />
          Input Prompts
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Queue one or more prompts. On phone, this card stays compact and keeps the main action within thumb reach.
        </p>
        </div>
        <div className="flex w-full min-w-0 items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 sm:w-auto sm:max-w-[20rem]">
          <Settings2 size={14} className="text-slate-400" />
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full min-w-0 bg-transparent border-none text-sm text-slate-200 focus:ring-0 cursor-pointer outline-none sm:text-xs"
            title="Select TTS Model"
          >
            <option value="gemini-2.5-pro-preview-tts">Gemini 2.5 Pro TTS (High Quality)</option>
            <option value="gemini-2.5-flash-preview-tts">Gemini 2.5 Flash TTS (Faster)</option>
          </select>
        </div>
      </div>
      
      <p className="mb-3 text-sm text-slate-400">
        Enter multiple prompts (one per line). Each will be processed individually.
      </p>
      <div className="mb-4 grid gap-2 sm:flex sm:flex-wrap">
        <button
          type="button"
          onClick={() => setEnableGoogleSearch((prev) => !prev)}
          className={`min-h-[46px] rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
            enableGoogleSearch
              ? 'border-blue-500 bg-blue-500/15 text-blue-200'
              : 'border-slate-700 bg-slate-900 text-slate-400'
          }`}
        >
          Google Search {enableGoogleSearch ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          onClick={() => setEnableUrlContext((prev) => !prev)}
          className={`min-h-[46px] rounded-2xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
            enableUrlContext
              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
              : 'border-slate-700 bg-slate-900 text-slate-400'
          }`}
        >
          URL Context {enableUrlContext ? 'On' : 'Off'}
        </button>
      </div>
      {warningMessage && (
        <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {warningMessage}
        </div>
      )}
      <textarea
        className="h-40 w-full rounded-[1.35rem] border border-slate-700 bg-slate-950/85 p-4 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono resize-none shadow-[inset_0_1px_0_rgba(148,163,184,0.08)]"
        placeholder={`Who won the 2024 Super Bowl?
Explain quantum physics simply.
Tell me a joke about a cat.`}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
      />
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="rounded-2xl border border-slate-800 bg-slate-950/55 px-4 py-3 text-xs leading-5 text-slate-400">
          {inputText.trim()
            ? `${inputText.split('\n').map((line) => line.trim()).filter(Boolean).length} prompt(s) ready`
            : 'Add one prompt per line to build a batch.'}
        </div>
        <button
          onClick={handleProcess}
          disabled={!inputText.trim()}
          className={`
            min-h-[50px] w-full items-center justify-center gap-2 rounded-2xl px-6 py-3 font-bold transition-all sm:w-auto
            flex
            ${!inputText.trim() || warningMessage
              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg hover:shadow-blue-500/30 active:scale-95'
            }
          `}
        >
          {isProcessing ? (
            <>
              <PlayCircle size={20} />
              Add to Queue
            </>
          ) : (
            <>
              <PlayCircle size={20} />
              Generate & Prepare Audio
            </>
          )}
        </button>
      </div>
    </div>
  );
};
