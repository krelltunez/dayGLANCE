import React from 'react';
import { BrainCircuit, LayoutGrid, Inbox, CalendarDays, Check, Loader } from 'lucide-react';

const SmartSchedulePanel = ({ aiConfig, inboxTasks, smartScheduleResults, smartScheduleLoading, smartScheduleError, smartScheduleAccepted, setSmartScheduleAccepted, onRun, onApply, onCancel, darkMode, textPrimary, textSecondary, borderClass, cardBg, hoverBg, gtdFrames, formatTime, mode = 'inbox' }) => {
  const isReschedule = mode === 'reschedule';
  if (!aiConfig?.enabled || (!aiConfig.features?.smartScheduling && !isReschedule)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <BrainCircuit size={48} className={textSecondary} />
        <h3 className={`text-lg font-semibold ${textPrimary}`}>AI Scheduling</h3>
        <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
          Enable AI features and Smart Scheduling in Settings to use this feature.
        </p>
      </div>
    );
  }

  if (gtdFrames.filter(f => f.enabled).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <LayoutGrid size={48} className={textSecondary} />
        <h3 className={`text-lg font-semibold ${textPrimary}`}>No Active Frames</h3>
        <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
          Create and enable at least one GTD Frame before running Smart Schedule.
        </p>
      </div>
    );
  }

  if (inboxTasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Inbox size={48} className={textSecondary} />
        <h3 className={`text-lg font-semibold ${textPrimary}`}>{isReschedule ? 'All Caught Up!' : 'Inbox Empty'}</h3>
        <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
          {isReschedule
            ? 'No incomplete tasks from today — nothing to reschedule.'
            : 'Add tasks to your inbox first, then Smart Schedule will place them in your frames.'}
        </p>
      </div>
    );
  }

  // Robust task lookup: AI may return taskId as a different type (number vs string)
  const findTaskById = (taskId) =>
    inboxTasks.find(t => t.id === taskId) || inboxTasks.find(t => String(t.id) === String(taskId));

  // Show results
  if (smartScheduleResults) {
    const placements = smartScheduleResults.placements || [];
    const unplaceable = smartScheduleResults.unplaceable || [];
    const acceptedCount = placements.filter(p => smartScheduleAccepted[p.taskId]).length;

    return (
      <div className="space-y-3">
        <h3 className={`text-sm font-semibold ${textPrimary}`}>Proposed Schedule</h3>
        {placements.length > 0 && (
          <div className="space-y-2">
            {placements.map(p => {
              const task = findTaskById(p.taskId);
              return (
                <div key={p.taskId} className={`p-3 rounded-lg border ${borderClass} ${smartScheduleAccepted[p.taskId] ? (darkMode ? 'bg-green-900/20 border-green-800' : 'bg-green-50 border-green-200') : (darkMode ? 'bg-gray-800' : 'bg-stone-50')}`}>
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => setSmartScheduleAccepted(prev => ({ ...prev, [p.taskId]: !prev[p.taskId] }))}
                      className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${smartScheduleAccepted[p.taskId] ? 'bg-green-500 border-green-500 text-white' : `${borderClass}`}`}
                    >
                      {smartScheduleAccepted[p.taskId] && <Check size={12} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${textPrimary} truncate`}>{task?.title || 'Unknown task'}</div>
                      <div className={`text-xs ${textSecondary} mt-0.5`}>
                        {p.date} at {formatTime(p.time)} · {p.frameLabel}
                      </div>
                      {p.reasoning && <div className={`text-xs ${textSecondary} mt-0.5 italic`}>{p.reasoning}</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {unplaceable.length > 0 && (
          <div>
            <h4 className={`text-xs font-semibold ${textSecondary} mb-1`}>Could not be placed</h4>
            <div className="space-y-1">
              {unplaceable.map(u => {
                const task = findTaskById(u.taskId);
                return (
                  <div key={u.taskId} className={`p-2 rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-stone-50'} text-xs`}>
                    <span className={textPrimary}>{task?.title || 'Unknown task'}</span>
                    <span className={`${textSecondary} ml-1`}>— {u.reason}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button
            onClick={onApply}
            disabled={acceptedCount === 0}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${acceptedCount > 0 ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-300 text-gray-500 cursor-not-allowed'}`}
          >
            Apply {acceptedCount} Task{acceptedCount !== 1 ? 's' : ''}
          </button>
          <button onClick={onCancel} className={`px-4 py-2.5 rounded-lg text-sm ${textSecondary} ${hoverBg} transition-colors`}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Initial state — show run button
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center py-8 gap-3">
        <CalendarDays size={48} className="text-blue-500" />
        <h3 className={`text-lg font-semibold ${textPrimary}`}>{isReschedule ? 'Reschedule Tasks' : 'Smart Schedule'}</h3>
        <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
          {isReschedule
            ? `AI will find slots for your ${inboxTasks.length} incomplete task${inboxTasks.length !== 1 ? 's' : ''} in the next 3 days.`
            : `AI will place your ${inboxTasks.length} inbox task${inboxTasks.length !== 1 ? 's' : ''} into available frame slots for the next 3 days.`}
        </p>

        {smartScheduleError && (
          <div className="p-2 rounded-lg bg-red-500/10 text-red-500 text-sm text-center max-w-xs">
            {smartScheduleError}
          </div>
        )}

        <button
          onClick={onRun}
          disabled={smartScheduleLoading}
          className="mt-2 px-6 py-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          {smartScheduleLoading ? (
            <><Loader size={16} className="animate-spin" /> {isReschedule ? 'Rescheduling...' : 'Scheduling...'}</>
          ) : (
            <><BrainCircuit size={16} /> {isReschedule ? 'Reschedule Tasks' : 'Run Smart Schedule'}</>
          )}
        </button>
      </div>
    </div>
  );
};

export default SmartSchedulePanel;
