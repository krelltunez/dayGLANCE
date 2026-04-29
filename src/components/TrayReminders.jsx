import { Bell, X, Clock } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

export default function TrayReminders({ darkMode, reminders }) {
  const { borderClass, textPrimary, textSecondary } = useDayPlannerCtx();

  if (!reminders?.length) return null;

  const dismiss = (id) =>
    window.electronAPI?.backgroundAction({ action: 'dismiss-reminder', reminderId: id });

  const snooze = (reminder) =>
    window.electronAPI?.backgroundAction({ action: 'snooze-reminder', reminder });

  return (
    <div className={`flex-shrink-0 border-b ${borderClass}`}>
      {reminders.map((r) => (
        <div
          key={r.id}
          className={`flex items-start gap-2 px-3 py-2.5 border-b last:border-b-0 ${borderClass} ${
            darkMode ? 'bg-yellow-500/10' : 'bg-yellow-50'
          }`}
        >
          <Bell size={13} className="flex-shrink-0 mt-0.5 text-yellow-500" />
          <div className="flex-1 min-w-0">
            <div className={`text-xs font-medium truncate ${textPrimary}`}>{r.taskTitle}</div>
            <div className={`text-xs ${textSecondary}`}>{r.message}</div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!r.isCalendarEvent && r.startTime && (
              <button
                onClick={() => snooze(r)}
                title="Snooze 15 min"
                className={`p-1 rounded transition-opacity hover:opacity-70 ${
                  darkMode ? 'text-gray-400' : 'text-stone-400'
                }`}
              >
                <Clock size={13} />
              </button>
            )}
            <button
              onClick={() => dismiss(r.id)}
              title="Dismiss"
              className={`p-1 rounded transition-opacity hover:opacity-70 ${
                darkMode ? 'text-gray-400' : 'text-stone-400'
              }`}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
