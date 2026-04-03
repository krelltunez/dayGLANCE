import React from 'react';
import { Archive, ChevronDown, RotateCcw } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const InboxArchivedBar = () => {
  const {
    darkMode, textSecondary, hoverBg, borderClass,
    unscheduledTasks,
    restoreArchivedInboxTask,
    goalsProjectsEnabled, projects,
    inboxArchivedExpanded: expanded,
    setInboxArchivedExpanded: setExpanded,
  } = useDayPlannerCtx();

  const archivedTasks = unscheduledTasks.filter(t => t.archived && !t.imported);

  if (archivedTasks.length === 0) return null;

  return (
    <div className={`border-t ${borderClass} mt-1`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className={`flex items-center gap-2 text-xs ${textSecondary} ${hoverBg} px-3 py-2 w-full transition-colors`}
      >
        <Archive size={13} className="flex-shrink-0" />
        <span className="font-medium">Archived ({archivedTasks.length})</span>
        <ChevronDown
          size={13}
          className={`ml-auto flex-shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="pb-2 px-2 flex flex-col gap-0.5">
          {archivedTasks.map(task => {
            const proj = goalsProjectsEnabled && task.projectId
              ? projects.find(p => p.id === task.projectId)
              : null;
            return (
              <div
                key={task.id}
                data-task-id={task.id}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${hoverBg} min-w-0`}
              >
                <span className={`text-xs ${textSecondary} flex-1 min-w-0 truncate line-through opacity-60`}>
                  {task.title}
                </span>
                {proj && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-600'}`}>
                    {proj.title}
                  </span>
                )}
                <button
                  onClick={() => restoreArchivedInboxTask(task.id)}
                  className={`flex-shrink-0 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded transition-colors ${
                    darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'
                  }`}
                  title="Restore to inbox"
                >
                  <RotateCcw size={9} />
                  <span>Restore</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default InboxArchivedBar;
