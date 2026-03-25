import React from 'react';
import { RefreshCw, X, Zap, Loader } from 'lucide-react';

const FrameNudgeCard = ({ suggestion, loading, error, activeFrame, darkMode, textPrimary, textSecondary, onRefresh, onDismiss, onStartTask }) => {
  const borderCol = darkMode ? 'border-teal-800/50' : 'border-teal-200';
  const bgCol = darkMode ? 'bg-teal-900/20' : 'bg-teal-50';
  const labelCol = darkMode ? 'text-teal-300' : 'text-teal-700';
  const iconCol = 'text-teal-500';
  return (
    <div className={`rounded-lg border p-3 mb-3 ${borderCol} ${bgCol}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Zap size={13} className={`${iconCol} flex-shrink-0`} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${labelCol} truncate`}>{activeFrame.label}</span>
          <span className={`text-xs ${textSecondary} flex-shrink-0`}>{activeFrame.minutesRemaining}m left</span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button onClick={onRefresh} className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="New suggestion">
            <RefreshCw size={11} className={`${loading ? 'animate-spin' : ''} ${textSecondary}`} />
          </button>
          <button onClick={onDismiss} className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Dismiss">
            <X size={11} className={textSecondary} />
          </button>
        </div>
      </div>
      {loading && (
        <div className="flex items-center gap-2">
          <Loader size={13} className={`animate-spin ${textSecondary}`} />
          <span className={`text-xs ${textSecondary}`}>Finding best task…</span>
        </div>
      )}
      {error && !loading && (
        <p className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
      )}
      {suggestion && !loading && (
        <button
          onClick={() => onStartTask(suggestion.taskId, suggestion.isInbox)}
          className={`w-full text-left rounded-md px-2.5 py-2 transition-colors ${darkMode ? 'bg-teal-900/40 hover:bg-teal-800/60' : 'bg-white hover:bg-teal-50'} border ${borderCol}`}
        >
          <div className={`text-sm font-medium ${textPrimary} leading-snug`}>{suggestion.taskTitle}</div>
          {suggestion.reason && (
            <div className={`text-xs mt-0.5 ${textSecondary}`}>{suggestion.reason}</div>
          )}
        </button>
      )}
    </div>
  );
};

export default FrameNudgeCard;
