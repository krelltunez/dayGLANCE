import React from 'react';
import { Inbox, Calendar } from 'lucide-react';
import { stripWikilinks } from '../utils/taskUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const FrameScheduleModal = () => {
  const {
    frameScheduleModal, setFrameScheduleModal,
    unscheduledTasks,
    computeAvailableSlots, manuallyScheduleTask,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();

  const inboxTasks = unscheduledTasks.filter(t => !t.completed && !t.isExample && (!t.deadline || t.deadline === frameScheduleModal.dateStr)).sort((a, b) => {
    const aHasDeadline = a.deadline ? 1 : 0;
    const bHasDeadline = b.deadline ? 1 : 0;
    if (bHasDeadline !== aHasDeadline) return bHasDeadline - aHasDeadline;
    return (b.priority || 0) - (a.priority || 0);
  });
  const frameInstance = {
    frameId: frameScheduleModal.frameId,
    date: frameScheduleModal.dateStr,
    start: frameScheduleModal.frame.start,
    end: frameScheduleModal.frame.end,
    bufferMinutes: frameScheduleModal.frame.bufferMinutes ?? 5,
  };
  const availableSlots = computeAvailableSlots(frameInstance, new Date(frameScheduleModal.dateStr + 'T12:00:00'));
  const totalAvailable = availableSlots.reduce((sum, s) => sum + s.minutes, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setFrameScheduleModal(null)}>
      <div className={`${cardBg} rounded-lg shadow-xl border ${borderClass} w-80 max-h-[70vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className={`p-4 border-b ${borderClass}`}>
          <h3 className={`font-semibold ${textPrimary}`}>Manually Schedule</h3>
          <p className={`text-xs ${textSecondary} mt-1`}>
            {frameScheduleModal.frame.label} &middot; {frameScheduleModal.dateStr}
          </p>
          <p className="mt-1.5">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>{totalAvailable}min available</span>
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {inboxTasks.length === 0 ? (
            <div className={`text-center py-8 ${textSecondary} text-sm`}>
              <Inbox size={24} className="mx-auto mb-2 opacity-50" />
              No inbox tasks to schedule
            </div>
          ) : (
            inboxTasks.map(task => {
              const fits = availableSlots.some(s => s.minutes >= (task.duration || 30));
              return (
                <button
                  key={task.id}
                  className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 transition-colors flex items-start gap-2 ${!fits ? 'opacity-50 cursor-not-allowed' : hoverBg}`}
                  onClick={() => fits && manuallyScheduleTask(task.id)}
                  disabled={!fits}
                  title={!fits ? `No slot large enough for ${task.duration || 30}min task` : `Schedule in ${frameScheduleModal.frame.label}`}
                >
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm ${textPrimary} truncate`}>{stripWikilinks(task.title)}</div>
                    <div className={`text-xs ${textSecondary} flex items-center gap-2 mt-0.5`}>
                      <span>{task.duration || 30}min</span>
                      {task.priority >= 1 && <span className={task.priority >= 2 ? 'text-red-500' : 'text-amber-500'}>P{task.priority}</span>}
                      {task.deadline && <span className="flex items-center gap-0.5"><Calendar size={10} />{task.deadline}</span>}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className={`p-3 border-t ${borderClass}`}>
          <button onClick={() => setFrameScheduleModal(null)} className={`w-full px-3 py-2 rounded-lg text-sm ${textSecondary} ${hoverBg} transition-colors`}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default FrameScheduleModal;
