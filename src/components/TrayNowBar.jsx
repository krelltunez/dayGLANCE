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
  if (!currentTask) return null;

  const open = () => window.electronAPI?.openMainAt({ action: 'goto-task', taskId: currentTask.id });
  const start = fmtTime(currentTask.startTime);
  const end = fmtEndTime(currentTask.startTime, currentTask.duration);
  const timeLabel = end ? `${start}–${end}` : start;
  const label = timeLabel ? `Now: ${currentTask.title}  ·  ${timeLabel}` : `Now: ${currentTask.title}`;

  return (
    <button
      onClick={open}
      className={`w-full flex-shrink-0 flex items-center gap-2 px-4 py-1.5 text-xs font-semibold text-left transition-opacity hover:opacity-80 ${
        darkMode
          ? 'bg-amber-900/40 text-amber-300 border-b border-amber-700/40'
          : 'bg-amber-50 text-amber-800 border-b border-amber-200'
      }`}
    >
      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
