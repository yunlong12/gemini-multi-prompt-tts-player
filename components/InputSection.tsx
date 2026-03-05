import React, { useState } from 'react';
import { PlayCircle, MessageSquarePlus, Settings2 } from 'lucide-react';

interface InputSectionProps {
  onProcess: (prompts: string[], ttsModel: string) => void;
  isProcessing: boolean;
}

export const InputSection: React.FC<InputSectionProps> = ({ onProcess, isProcessing }) => {
  const [inputText, setInputText] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-pro-preview-tts');

  const handleProcess = () => {
    if (!inputText.trim()) return;
    const prompts = inputText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (prompts.length > 0) {
      onProcess(prompts, selectedModel);
      setInputText('');
    }
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6 shadow-lg mb-8 border border-slate-700">
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:justify-between sm:items-start">
        <h2 className="text-xl font-semibold flex items-center gap-2 text-blue-400">
          <MessageSquarePlus size={24} />
          Input Prompts
        </h2>
        <div className="flex w-full min-w-0 items-center gap-2 bg-slate-900/50 px-3 py-1.5 rounded-lg border border-slate-700 sm:w-auto">
          <Settings2 size={14} className="text-slate-400" />
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full min-w-0 bg-transparent border-none text-slate-300 text-xs focus:ring-0 cursor-pointer outline-none sm:w-auto"
            title="Select TTS Model"
          >
            <option value="gemini-2.5-pro-preview-tts">Gemini 2.5 Pro TTS (High Quality)</option>
            <option value="gemini-2.5-flash-preview-tts">Gemini 2.5 Flash TTS (Faster)</option>
          </select>
        </div>
      </div>
      
      <p className="text-sm text-slate-400 mb-2">
        Enter multiple prompts (one per line). Each will be processed individually.
      </p>
      <textarea
        className="w-full h-40 bg-slate-900 border border-slate-700 rounded-lg p-4 text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm resize-none"
        placeholder={`Who won the 2024 Super Bowl?
Explain quantum physics simply.
Tell me a joke about a cat.`}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
      />
      <div className="mt-4 flex justify-end gap-3">
        <button
          onClick={handleProcess}
          disabled={!inputText.trim()}
          className={`
            flex items-center gap-2 px-6 py-3 rounded-lg font-bold transition-all
            ${!inputText.trim()
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
