import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Clock3, Globe, Loader2, Volume2 } from 'lucide-react';
import { ItemStatus, ProcessItem } from '../types';
import { formatPartLabel } from '../utils/ttsChunks';

interface ResultCardProps {
  item: ProcessItem;
  isActive: boolean;
}

export const ResultCard: React.FC<ResultCardProps> = ({ item, isActive }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const partLabel = formatPartLabel(item.partIndex, item.partCount);
  const collapsedMaxHeight = 240;
  const audioParts = [...(item.audioParts || [])].sort((a, b) => a.partIndex - b.partIndex);

  useEffect(() => {
    setIsExpanded(false);
  }, [item.id, item.answer]);

  useEffect(() => {
    if (!item.answer) {
      setIsCollapsible(false);
      return;
    }

    const measure = () => {
      const contentElement = contentRef.current;
      setIsCollapsible(Boolean(contentElement) && contentElement.scrollHeight - collapsedMaxHeight > 4);
    };

    const frameId = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', measure);
    };
  }, [item.answer]);

  const getStatusIcon = () => {
    switch (item.status) {
      case ItemStatus.QUEUED:
        return <span className="flex items-center gap-2 text-slate-300"><Clock3 size={16} /> Queued</span>;
      case ItemStatus.GENERATING_TEXT:
        return <span className="flex items-center gap-2 text-yellow-400"><Loader2 className="animate-spin" size={16} /> Researching...</span>;
      case ItemStatus.GENERATING_AUDIO:
        return <span className="flex items-center gap-2 text-fuchsia-300"><Loader2 className="animate-spin" size={16} /> Generating Voice...</span>;
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
    <div
      className={`relative overflow-hidden rounded-[1.45rem] border p-4 transition-all duration-300 sm:p-5 ${
        isActive
          ? 'border-blue-500 bg-slate-800 shadow-[0_0_20px_rgba(59,130,246,0.18)] scale-[1.01]'
          : 'border-slate-700 bg-slate-800/60'
      }`}
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h3 className="pr-2 text-base font-semibold leading-7 text-slate-100 sm:pr-4 sm:text-lg">{item.prompt}</h3>
        <div className="flex flex-row items-center justify-between gap-2 sm:flex-col sm:items-end">
          {partLabel ? (
            <div className="whitespace-nowrap rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
              {partLabel}
            </div>
          ) : null}
          <div className="whitespace-nowrap rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-mono">
            {getStatusIcon()}
          </div>
        </div>
      </div>

      {item.answer ? (
        <div className="mb-4">
          <div className="relative overflow-hidden rounded-xl border border-slate-800/80 bg-slate-900/50 p-3">
            <div
              ref={contentRef}
              className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300 transition-[max-height] duration-200 ease-out"
              style={isExpanded ? undefined : { maxHeight: `${collapsedMaxHeight}px`, overflow: 'hidden' }}
            >
              {item.answer}
            </div>
            {!isExpanded && isCollapsible ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-900/95 via-slate-900/70 to-transparent" />
            ) : null}
          </div>
          {isCollapsible ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setIsExpanded((current) => !current)}
                className="min-h-[40px] rounded-full px-3 text-xs font-semibold uppercase tracking-wide text-cyan-300 transition-colors hover:text-cyan-200"
              >
                {isExpanded ? 'Collapse Text' : 'Expand Text'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {audioParts.length ? (
        <details className="mb-4 rounded-xl border border-slate-800/80 bg-slate-900/40">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm font-semibold text-slate-200">
            Audio Parts ({audioParts.length})
          </summary>
          <div className="space-y-3 border-t border-slate-800/80 px-3 py-3">
            {audioParts.map((part) => (
              <div key={`${item.id}-${part.partIndex}`} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                      {formatPartLabel(part.partIndex, part.partCount)}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-400">{part.text}</div>
                  </div>
                  {part.audioPath ? (
                    <a
                      href={`/api/artifacts/${encodeURIComponent(part.audioPath)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 rounded-full border border-cyan-500/20 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
                    >
                      Download
                    </a>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {item.groundingLinks.length > 0 ? (
        <div className="mt-3 border-t border-slate-700/50 pt-3">
          <p className="mb-2 flex items-center gap-1 text-xs text-slate-500"><Globe size={12} /> Sources used:</p>
          <div className="flex flex-wrap gap-2">
            {item.groundingLinks.map((link, idx) => (
              <a
                key={idx}
                href={link.uri}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full bg-blue-500/10 px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 hover:underline"
              >
                {link.title || new URL(link.uri).hostname}
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {item.error ? <div className="mt-2 rounded-xl bg-red-900/20 p-2 text-xs text-red-400">{item.error}</div> : null}
    </div>
  );
};
