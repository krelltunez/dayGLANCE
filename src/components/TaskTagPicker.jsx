import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { addTagToTitle, collectTags, toggleTagInTitle } from '../utils/tagManager.js';
import { SEARCH_FROM, enterTagChoice, tagPickerOptions, titleTags } from '../utils/tagPicker.js';

// The task editor's tag picker (#2308), desktop and phone. A tag is a `#word`
// in the title, so this has no field of its own: a chip adds `#tag` to the end
// of the title or takes it out (utils/tagManager.js), and the title is the
// form's until Save, like anything typed. The editor's title stays the one
// place a tag lives, and the Obsidian and Todoist integrations read it there.
//
// It lists the tags in use as the tag manager does (collectTags, by name), the
// title's own picked. The field at the top filters them as the tag manager's
// search does, and offers "Add #…" for a tag not in use yet. #obsidian is not
// offered (utils/tagPicker.js): saving a new task with it writes the task to
// the Obsidian daily note.
//
// Collapsed, it is one row, the title's tags, like the project field; it
// opens in place below, as the project picker does (the phone's editor is a
// scrolling sheet that would clip a popover), and closes on a tap outside,
// Tab out, or Escape (which stops there: the form closes the whole editor on
// Escape). The chips are buttons that take the focus as the project picker's
// rows do, so Enter on a chip toggles it and Ctrl/Cmd+Enter still saves from
// anywhere (utils/submitShortcut.js). Enter in the field adds; it never
// submits and never removes.

/**
 * @param {object} props
 * @param {string} props.id        the trigger's id, for its <label>
 * @param {string} props.title     the title being edited
 * @param {(update: (title: string) => string) => void} props.onEditTitle
 *   applies a change to the title (useNewTaskInput's editNewTaskTitle)
 */
export default function TaskTagPicker({ id, title, onEditTitle }) {
  const { t } = useTranslation();
  const {
    darkMode, borderClass, textSecondary, isMobile,
    tasks = [], unscheduledTasks = [], recurringTasks = [],
  } = useDayPlannerCtx();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);

  // Read only while the list is shown: the closed row needs the title alone.
  const collected = useMemo(
    () => (open ? collectTags({ tasks, unscheduledTasks, recurringTasks }) : []),
    [open, tasks, unscheduledTasks, recurringTasks],
  );
  const { options, create, total } = tagPickerOptions({ collected, title, query });
  const picked = titleTags(title);

  const close = ({ refocus = false } = {}) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };
  const toggle = (tag) => onEditTitle((was) => toggleTagInTitle(was, tag));
  const add = (tag) => {
    onEditTitle((was) => addTagToTitle(was, tag));
    setQuery('');
    // The "Add #…" button goes once its tag is in the title.
    searchRef.current?.focus();
  };

  // Opening on desktop puts the caret in the field; on a phone it would
  // raise the keyboard over the chips, so the focus stays on the row.
  const focusSearchOnOpen = useRef(!isMobile);
  focusSearchOnOpen.current = !isMobile;
  useEffect(() => {
    if (open && focusSearchOnOpen.current) searchRef.current?.focus();
  }, [open]);

  // A tap or click anywhere else closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (containerRef.current?.contains(e.target)) return;
      setOpen(false);
      setQuery('');
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };

  const onTriggerKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      // Handled here: the desktop form keeps Space from pressing buttons.
      stop(e);
      if (open) close(); else setOpen(true);
    } else if (e.key === 'Escape' && open) {
      stop(e);
      close();
    }
  };

  const onPanelKeyDown = (e) => {
    if (e.key === 'Escape') {
      stop(e);
      close({ refocus: true });
    }
  };

  const onSearchKeyDown = (e) => {
    // Enter adds (enterTagChoice); it must not submit the editor's form.
    // Not while an input method is composing: its Enter confirms the word.
    if (e.key !== 'Enter' || e.ctrlKey || e.metaKey || e.nativeEvent?.isComposing) return;
    stop(e);
    const tag = enterTagChoice({ options, create }, query);
    if (tag) add(tag);
  };

  // Enter and Space press a chip here: the desktop form keeps Space from
  // pressing buttons. Ctrl/Cmd+Enter is the form's, to save.
  const onChipKeyDown = (e, tag, press = toggle) => {
    if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === ' ') {
      stop(e);
      press(tag);
    }
  };

  // Tab out of the picker closes it. (A tap elsewhere has no related target
  // in some browsers; the pointerdown listener covers that.)
  const onBlur = (e) => {
    if (open && e.relatedTarget && !containerRef.current?.contains(e.relatedTarget)) close();
  };

  const fieldBg = darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900';
  const panelId = `${id}-list`;
  const chipSize = isMobile ? 'px-3 py-1.5' : 'px-2.5 py-1';
  const chipOn = `border-blue-500 ${darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-50 text-blue-700'}`;
  const chipOff = `${borderClass} ${darkMode ? 'bg-gray-800 text-gray-300 hover:bg-gray-600' : 'bg-white text-stone-600 hover:bg-stone-100'}`;
  const chipBase = `inline-flex items-center gap-1 ${chipSize} rounded-full text-sm border transition-colors max-w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500`;

  return (
    <div ref={containerRef} data-task-tag-picker onBlur={onBlur}>
      <label className={`block text-sm ${textSecondary} mb-1`} htmlFor={id}>{t('task.tags')}</label>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        data-tag-picker-trigger
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        className={`w-full flex items-center gap-2 px-3 py-2 border ${borderClass} rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldBg}`}
      >
        {picked.length > 0 ? (
          <span className="flex flex-wrap gap-1 min-w-0" data-tag-picker-selected>
            {picked.map((tag) => (
              <span key={tag} className={`px-1.5 py-0.5 rounded text-xs truncate max-w-full ${darkMode ? 'bg-blue-500/20 text-blue-300' : 'bg-blue-50 text-blue-700'}`}>
                #{tag}
              </span>
            ))}
          </span>
        ) : (
          <span className={`truncate ${darkMode ? 'text-gray-400' : 'text-stone-400'}`}>{t('task.noTags')}</span>
        )}
        <ChevronDown size={16} className={`ml-auto flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${textSecondary}`} />
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={id}
          data-tag-picker-panel
          onKeyDown={onPanelKeyDown}
          className={`mt-1 border ${borderClass} rounded-lg overflow-hidden ${fieldBg}`}
        >
          <div className={`p-1.5 border-b ${borderClass}`}>
            <input
              ref={searchRef}
              type="search"
              data-tag-picker-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={total >= SEARCH_FROM ? t('task.tagPickerSearch') : t('task.tagPickerAdd')}
              aria-label={total >= SEARCH_FROM ? t('task.tagPickerSearch') : t('task.tagPickerAdd')}
              className={`w-full px-2 py-1 ${isMobile ? 'text-base' : 'text-sm'} rounded-md border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-800 text-white placeholder-gray-400' : 'bg-white text-stone-900 placeholder-stone-400'}`}
            />
          </div>
          <div className={`p-1.5 flex flex-wrap gap-1.5 overflow-y-auto overscroll-contain ${isMobile ? 'max-h-[35vh]' : 'max-h-48'}`}>
            {options.map(({ tag, selected }) => (
              <button
                key={tag}
                type="button"
                data-tag-picker-chip={tag}
                aria-pressed={selected}
                onClick={() => toggle(tag)}
                onKeyDown={(e) => onChipKeyDown(e, tag)}
                className={`${chipBase} ${selected ? chipOn : chipOff}`}
              >
                {selected && <Check size={14} className="flex-shrink-0" />}
                <span className="truncate">#{tag}</span>
              </button>
            ))}
            {create && (
              <button
                type="button"
                data-tag-picker-create={create}
                onClick={() => add(create)}
                onKeyDown={(e) => onChipKeyDown(e, create, add)}
                className={`${chipBase} border-dashed ${borderClass} ${darkMode ? 'text-blue-300 hover:bg-gray-600' : 'text-blue-700 hover:bg-stone-100'}`}
              >
                <Plus size={14} className="flex-shrink-0" />
                <span className="truncate">{t('task.tagPickerCreate', { tag: create })}</span>
              </button>
            )}
            {!create && options.length === 0 && (
              <p data-tag-picker-empty className={`px-1 py-1 text-xs ${textSecondary}`}>
                {query.trim() ? t('task.tagPickerNoMatch') : t('task.tagPickerEmpty')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
