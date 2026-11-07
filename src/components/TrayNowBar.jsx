import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import TimeRange from './TimeRange.jsx';

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, '0')}${suffix}`;
}

// The tray popup's NOW bar. The bar itself opens the main window at the
// running task. When the task's title carries a [[wikilink]] (the main
// window pushes it as `note`, title already stripped), an open-book button
// beside the label opens that note in Obsidian through the main process,
// without raising the main window: the tray exists so you do not have to.
//
// The range is the task's own, through the shared formatter (#2278): a task
// from 23:00 for two hours reads "11pm–1am" with the app's raised "+1"
// ("Ends the next day"), whether it is 23:30 or 00:08 the next day (the main
// window pushes the night before's task while it runs).
export default function TrayNowBar({ darkMode, currentTask }) {
  const { t } = useTranslation();
  if (!currentTask) return null;

  const open = () => window.electronAPI?.openMainAt({ action: 'goto-task', taskId: currentTask.id });
  const openNote = () => window.electronAPI?.obsidian?.openNote?.(currentTask.note);
  const timeLabel = !currentTask.startTime ? null
    : currentTask.duration
      ? <TimeRange startTime={currentTask.startTime} duration={currentTask.duration} formatTime={fmtTime} />
      : fmtTime(currentTask.startTime);
  const noteLabel = currentTask.note ? t('task.openWikiNoteInObsidian', { name: currentTask.note }) : '';

  return (
    <div
      className={`w-full flex-shrink-0 flex items-stretch text-xs font-semibold ${
        darkMode
          ? 'bg-amber-900/40 text-amber-300 border-b border-amber-700/40'
          : 'bg-amber-50 text-amber-800 border-b border-amber-200'
      }`}
    >
      <button
        type="button"
        onClick={open}
        className="flex-1 min-w-0 flex items-center gap-2 px-4 py-1.5 text-left transition-opacity hover:opacity-80"
      >
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
        <span className="truncate">{`Now: ${currentTask.title}`}{timeLabel && <>{'  ·  '}{timeLabel}</>}</span>
      </button>
      {currentTask.note && (
        <button
          type="button"
          onClick={openNote}
          title={noteLabel}
          aria-label={noteLabel}
          className="flex-shrink-0 flex items-center px-3 transition-opacity hover:opacity-80"
        >
          <BookOpen size={13} />
        </button>
      )}
    </div>
  );
}
