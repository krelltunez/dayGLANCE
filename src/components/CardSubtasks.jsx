import React from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cardSubtaskLayout, SUBTASK_ROW_PX } from '../utils/cardSubtasks.js';

// A task's subtasks on its timeline card, when the card has room (GRID on the
// phone; MULTI, DAY and JOBO's Plan side on desktop and tablet). Shown in the
// task's own order, done ones struck through; when they do not all fit, the
// last row says how many more and opens the notes and subtasks panel.
//
// White on the card's colour, like every mark on a timeline card, with the
// card's own completion box at a smaller size.
//
// A REPEATING task's subtasks have no checkboxes: the series keeps one list
// for every occurrence (utils/expandRecurringTasks.js), so ticking one on
// Monday's card would tick it on every day's. They are listed, with a dot or
// a tick for their state, until subtasks are kept per occurrence.
//
// The callers decide whether to show the list at all (wide cards only, the
// device setting on, not an imported event); this draws what fits.
export default function CardSubtasks({ task, height, reservedPx, readOnly = false, onToggle, onMore }) {
  const { t } = useTranslation();
  const { shown, more, rows } = cardSubtaskLayout({ height, reservedPx, subtasks: task?.subtasks });
  if (!rows) return null;
  const stop = (e) => e.stopPropagation();

  return (
    <div
      data-card-subtasks={readOnly ? 'read-only' : 'interactive'}
      className="mt-1 flex flex-col overflow-hidden min-w-0"
      style={{ maxHeight: `${rows * SUBTASK_ROW_PX}px` }}
      onDoubleClick={stop}
    >
      {shown.map((st) => {
        const done = !!st.completed;
        const label = <span className={`truncate ${done ? 'line-through opacity-70' : ''}`}>{st.title}</span>;
        if (readOnly) {
          return (
            <div key={st.id} data-card-subtask={st.id} className="flex items-center gap-1.5 text-xs min-w-0" style={{ height: SUBTASK_ROW_PX }}>
              <span className="w-3.5 flex-shrink-0 flex items-center justify-center" aria-hidden="true">
                {done ? <Check size={11} strokeWidth={3} /> : <span className="w-1.5 h-1.5 rounded-full bg-white/80" />}
              </span>
              {label}
            </div>
          );
        }
        return (
          <button
            key={st.id}
            type="button"
            data-card-subtask={st.id}
            role="checkbox"
            aria-checked={done}
            onClick={(e) => { stop(e); onToggle?.(st.id); }}
            className="flex items-center gap-1.5 text-xs text-left min-w-0 rounded hover:bg-white/10"
            style={{ height: SUBTASK_ROW_PX }}
          >
            <span className={`w-3.5 h-3.5 flex-shrink-0 rounded border-2 border-white flex items-center justify-center ${done ? 'bg-white/40' : 'bg-white/20'}`}>
              {done && <Check size={8} strokeWidth={3} />}
            </span>
            {label}
          </button>
        );
      })}
      {more > 0 && (
        <button
          type="button"
          data-card-subtasks-more={more}
          onClick={(e) => { stop(e); onMore?.(); }}
          className="text-xs text-left opacity-80 hover:opacity-100 hover:underline self-start"
          style={{ height: SUBTASK_ROW_PX }}
        >
          {shown.length ? t('task.cardSubtasksMore', { count: more }) : t('task.cardSubtasksCount', { count: more })}
        </button>
      )}
    </div>
  );
}
