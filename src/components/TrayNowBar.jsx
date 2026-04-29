import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

function fmtEndTime(startTime, duration) {
  if (!startTime || !duration) return null;
  const [h, m] = startTime.split(':').map(Number);
  const totalMin = h * 60 + m + duration;
  const eh = Math.floor(totalMin / 60) % 24;
  const em = totalMin % 60;
  const suffix = eh < 12 ? 'am' : 'pm';
  const hour = eh % 12 || 12;
  return em === 0 ? `${hour}${suffix}` : `${hour}:${String(em).padStart(2, '0')}${suffix}`;
}

export default function TrayNowBar({ darkMode, currentTask }) {
  const { borderClass, textPrimary, textSecondary } = useDayPlannerCtx();

  if (!currentTask) return null;

  const open = () => window.electronAPI?.openMainAt({ action: 'goto-task', taskId: currentTask.id });
  const start = fmtTime(currentTask.startTime);
  const end = fmtEndTime(currentTask.startTime, currentTask.duration);
  const timeLabel = end ? `${start}–${end}` : start;

  return (
    <div className={`flex-shrink-0 border-b ${borderClass}`}>
      <button
        onClick={open}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-opacity hover:opacity-80 ${
          darkMode ? 'bg-blue-500/15' : 'bg-blue-50'
        }`}
      >
        <div
          className="flex-shrink-0 w-2 h-2 rounded-full mt-px"
          style={{ backgroundColor: currentTask.colorHex || '#3b82f6' }}
        />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium truncate ${textPrimary}`}>{currentTask.title}</div>
          {timeLabel && <div className={`text-xs ${textSecondary}`}>{timeLabel}</div>}
        </div>
        <div className={`text-xs font-medium flex-shrink-0 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}>
          Now
        </div>
      </button>
    </div>
  );
}
