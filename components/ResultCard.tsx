import React from 'react';
import { Loader2, CheckCircle, AlertCircle, Volume2, Globe, Clock3 } from 'lucide-react';
import { ItemStatus, ProcessItem } from '../types';

interface ResultCardProps {
  item: ProcessItem;
  isActive: boolean;
}

export const ResultCard: React.FC<ResultCardProps> = ({ item, isActive }) => {
  const getStatusIcon = () => {
    switch (item.status) {
      case ItemStatus.QUEUED:
        return <span className="flex items-center gap-2 text-slate-300"><Clock3 size={16} /> Queued</span>;
      case ItemStatus.GENERATING_TEXT:
        return <span className="flex items-center gap-2 text-yellow-400"><Loader2 className="animate-spin" size={16} /> Researching...</span>;
      case ItemStatus.GENERATING_AUDIO:
        return <span className="flex items-center gap-2 text-purple-400"><Loader2 className="animate-spin" size={16} /> Generating Voice...</span>;
      case ItemStatus.READY:
        return <span className="flex items-center gap-2 text-emerald-400"><CheckCircle size={16} /> Ready to Play</span>;
      case ItemStatus.PLAYING:
        return <span className="flex items-center gap-2 text-blue-400"><Volume2 className="animate-pulse" size={16} /> Playing Now</span>;
      case ItemStatus.ERROR:
        return <span className="flex items-center gap-2 text-red-400"><AlertCircle size={16} /> Error</span>;
      default:
        return <span className="text-slate-500">Waiting...</span>;
    }
  };

  return (
    <div className={`
      relative rounded-lg p-5 border transition-all duration-300
      ${isActive 
        ? 'bg-slate-800 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)] scale-[1.01]' 
        : 'bg-slate-800/50 border-slate-700'
      }
    `}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="font-semibold text-lg text-slate-200 pr-4">
          {item.prompt}
        </h3>
        <div className="text-xs font-mono bg-slate-900 px-3 py-1 rounded-full border border-slate-700 whitespace-nowrap">
          {getStatusIcon()}
        </div>
      </div>

      {item.answer && (
        <div className="text-slate-300 text-sm leading-relaxed mb-4 p-3 bg-slate-900/50 rounded-md">
          {item.answer}
        </div>
      )}

      {item.groundingLinks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700/50">
          <p className="text-xs text-slate-500 mb-2 flex items-center gap-1">
            <Globe size={12} /> Sources used:
          </p>
          <div className="flex flex-wrap gap-2">
            {item.groundingLinks.map((link, idx) => (
              <a
                key={idx}
                href={link.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 hover:underline bg-blue-500/10 px-2 py-1 rounded"
              >
                {link.title || new URL(link.uri).hostname}
              </a>
            ))}
          </div>
        </div>
      )}

      {item.error && (
        <div className="mt-2 text-xs text-red-400 bg-red-900/20 p-2 rounded">
          {item.error}
        </div>
      )}
    </div>
  );
};
