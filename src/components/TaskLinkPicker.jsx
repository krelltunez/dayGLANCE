import React from 'react';
import { Link2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatShortDate } from '../utils/taskUtils.js';

/**
 * The `@@` picker under a note being typed (#2145): the tasks a link can go
 * to, filtered by what follows the `@@` (utils/taskLinks.js). The note keeps
 * the keyboard: its keydown moves `index` and picks; a click here picks too,
 * without taking the focus from the note. A task found by one of its tags
 * shows those tags, so it is clear why it is listed (#2369).
 */
export default function TaskLinkPicker({ candidates, index, onPick, darkMode }) {
  const { t } = useTranslation();
  const muted = darkMode ? 'text-gray-400' : 'text-stone-500';
  return (
    <div
      role="listbox"
      aria-label={t('task.linkPickerLabel')}
      data-task-link-picker
      className={`mt-1 p-1 rounded-lg border shadow-lg text-sm ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'}`}
    >
      {candidates.length === 0 ? (
        <div className={`px-2 py-1.5 text-xs ${muted}`}>{t('task.linkPickerEmpty')}</div>
      ) : candidates.map(({ task, title, tags = [] }, i) => (
        <div
          key={task.id}
          role="option"
          aria-selected={i === index}
          data-task-link-option={task.id}
          // mousedown, not click: keep the note focused, or its blur saves
          // and closes it before the pick lands.
          onMouseDown={(e) => { e.preventDefault(); onPick(task); }}
          className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${
            i === index ? (darkMode ? 'bg-gray-700' : 'bg-blue-50') : (darkMode ? 'hover:bg-gray-700/60' : 'hover:bg-stone-50')
          }`}
        >
          <Link2 size={12} className={`flex-shrink-0 ${muted}`} />
          <span className={`flex-1 min-w-0 truncate ${task.completed ? 'line-through opacity-60' : ''}`}>{title}</span>
          {tags.length > 0 && (
            <span data-task-link-tags className={`text-xs italic flex-shrink-0 truncate max-w-[40%] ${muted}`}>{tags.map((tag) => `#${tag}`).join(' ')}</span>
          )}
          {task.date && <span className={`text-xs flex-shrink-0 ${muted}`}>{formatShortDate(new Date(`${task.date}T12:00:00`))}</span>}
        </div>
      ))}
    </div>
  );
}
