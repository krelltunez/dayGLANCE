import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getProjectColor, taskColorToHex } from '../utils/colorUtils.js';
import { NEW_PROJECT_ID } from '../utils/pendingProject.js';
import { filterProjectGroups, groupInboxProjects } from '../utils/inboxProjectGroups.js';
import { projectPickerRows } from '../utils/projectPickerRows.js';
import { readRememberedOpen, rememberOpen } from '../hooks/useRememberedOpen.js';

// The task editor's project picker (#2279), desktop and phone. A native
// <select> could only group the projects one level, by goal, and could not
// fold, so with many projects it was a long undifferentiated list. This one
// groups them the way the Inbox filter does (#2232): areas, their goals, each
// goal's projects, then the standalone ones, every group folding and the fold
// remembered on the device (under its own keys, apart from the filter's).
//
// It opens in place, below the field, rather than as a popover: the phone's
// editor is a scrolling bottom sheet, which would clip a floating list.
//
// Keys: Enter, Space or Down open it; Up and Down walk the rows; Left and
// Right fold a group; Enter or Space picks; Escape closes the picker and
// nothing else (the editor's form closes the whole editor on Escape, so the
// picker stops the keys it handles). A tap outside it, or Tab out of it,
// closes it too.

const OPEN_KEY = (key) => `day-planner-task-project-open-${key}`;
// From this many projects, a filter field heads the list.
const FILTER_FROM = 8;

/**
 * @param {object} props
 * @param {string} props.id               the field's id, for its <label>
 * @param {string} props.value            the task's project id, '' for none
 * @param {(value: string) => void} props.onChange  '' for no project,
 *   NEW_PROJECT_ID for "New project…", or a project's id
 */
export default function TaskProjectPicker({ id, value, onChange }) {
  const { t } = useTranslation();
  const { darkMode, borderClass, textPrimary, textSecondary, isMobile } = useDayPlannerCtx();
  const { goals = [], projects = [], areas = [] } = useFeaturesCtx();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Folds changed while the picker is mounted; the rest are read from storage.
  const [folds, setFolds] = useState({});
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const filterRef = useRef(null);
  const rowNodes = useRef(new Map());

  const groups = useMemo(() => groupInboxProjects({ projects, goals, areas: areas || [] }), [projects, goals, areas]);
  const projectCount = groups.standalone.length
    + groups.areas.reduce((n, area) => n + area.goals.reduce((m, goal) => m + goal.projects.length, 0), 0);
  const filtering = query.trim() !== '';
  const shown = useMemo(() => filterProjectGroups(groups, query), [groups, query]);

  const selectedId = value && value !== NEW_PROJECT_ID ? value : null;
  const selected = selectedId ? projects.find((p) => p.id === selectedId) || null : null;
  const selectedGoal = selected?.goalId ? goals.find((g) => g.id === selected.goalId) || null : null;
  const selectedKey = selected ? `project-${selected.id}` : 'none';

  const isOpen = (key, defaultOpen) => folds[key] ?? readRememberedOpen(OPEN_KEY(key), defaultOpen);
  const rows = [
    { type: 'choice', key: 'none', value: '' },
    { type: 'choice', key: 'new', value: NEW_PROJECT_ID },
    ...projectPickerRows(shown, { isOpen, filtering, selectedId }),
  ];
  // While a filter is typed, the groups are labels, not folds.
  const focusable = rows.filter((row) => !(filtering && row.type === 'group')).map((row) => row.key);

  const close = ({ refocus = false } = {}) => {
    setOpen(false);
    setQuery('');
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (next) => {
    // The trigger takes the focus back first: "New project…" swaps the
    // field for a name input, which then takes it from there.
    close({ refocus: true });
    onChange(next);
  };
  const toggleGroup = (row) => {
    const next = !row.open;
    rememberOpen(OPEN_KEY(row.key), next);
    setFolds((was) => ({ ...was, [row.key]: next }));
  };
  const activate = (row) => {
    if (row.type === 'group') toggleGroup(row);
    else if (row.type === 'project') choose(row.project.id);
    else choose(row.value);
  };

  // Opening puts the focus on the task's project, or on "No project".
  // Only on opening: a fold toggled while open leaves the focus where it is.
  const focusSelected = () => (rowNodes.current.get(selectedKey) || rowNodes.current.get('none'))?.focus();
  const focusSelectedRef = useRef(focusSelected);
  focusSelectedRef.current = focusSelected;
  useEffect(() => {
    if (open) focusSelectedRef.current();
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
    } else if (e.key === 'ArrowDown') {
      stop(e);
      if (open) focusSelected(); else setOpen(true);
    } else if (e.key === 'Escape' && open) {
      stop(e);
      close();
    }
  };

  const onPanelKeyDown = (e) => {
    if (e.key === 'Escape') {
      stop(e);
      close({ refocus: true });
      return;
    }
    const inFilter = e.target === filterRef.current;
    const walk = e.key === 'ArrowDown' || e.key === 'ArrowUp' || (!inFilter && (e.key === 'Home' || e.key === 'End'));
    if (!walk || !focusable.length) return;
    stop(e);
    const at = focusable.findIndex((key) => rowNodes.current.get(key) === document.activeElement);
    const last = focusable.length - 1;
    let next;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else if (at === -1) next = e.key === 'ArrowDown' ? 0 : last;
    else next = (at + (e.key === 'ArrowDown' ? 1 : -1) + focusable.length) % focusable.length;
    rowNodes.current.get(focusable[next])?.focus();
  };

  const onRowKeyDown = (e, row) => {
    if (e.key === 'Enter' || e.key === ' ') {
      stop(e);
      activate(row);
    } else if (row.type === 'group' && ((e.key === 'ArrowRight' && !row.open) || (e.key === 'ArrowLeft' && row.open))) {
      stop(e);
      toggleGroup(row);
    }
  };

  const onFilterKeyDown = (e) => {
    // Enter picks the first match; it must not submit the editor's form.
    if (e.key !== 'Enter') return;
    stop(e);
    const first = rows.find((row) => row.type === 'project');
    if (first) choose(first.project.id);
  };

  // Tab out of the picker closes it. (A tap elsewhere has no related target
  // in some browsers; the pointerdown listener covers that.)
  const onBlur = (e) => {
    if (open && e.relatedTarget && !containerRef.current?.contains(e.relatedTarget)) close();
  };

  const nodeRef = (key) => (node) => {
    if (node) rowNodes.current.set(key, node); else rowNodes.current.delete(key);
  };
  const dot = (color) => (
    <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: taskColorToHex(color) }} />
  );
  const indent = (level) => ({ paddingLeft: `${0.5 + level * 1}rem` });
  const rowPad = isMobile ? 'py-2.5' : 'py-1.5';
  const rowBase = `w-full flex items-center gap-2 pr-2 ${rowPad} text-sm text-left rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500`;
  const rowHover = darkMode ? 'hover:bg-gray-600' : 'hover:bg-stone-100';
  const rowOn = darkMode ? 'bg-blue-500/25 text-white' : 'bg-blue-50 text-blue-800';

  const groupTitle = (row) => {
    if (row.kind === 'standalone') return t('goals.standalone');
    if (row.kind === 'area' && row.title === null) return t('goals.noDefinedArea');
    return row.title;
  };

  const renderRow = (row) => {
    if (row.type === 'group') {
      const title = groupTitle(row);
      const label = (
        <>
          {row.kind === 'goal' && row.color ? dot(row.color) : null}
          <span className={`truncate ${row.kind === 'area' ? 'text-[11px] font-semibold uppercase tracking-wide' : 'text-xs font-medium'}`}>{title}</span>
          <span className="text-xs opacity-60">{row.count}</span>
        </>
      );
      if (filtering) {
        return (
          <div key={row.key} data-project-picker-group={row.key} className={`flex items-center gap-2 pr-2 py-1 ${textSecondary}`} style={indent(row.level)}>
            {label}
          </div>
        );
      }
      return (
        <button
          key={row.key}
          ref={nodeRef(row.key)}
          type="button"
          data-project-picker-group={row.key}
          aria-expanded={row.open}
          aria-label={t(row.open ? 'inbox.filter.collapseGroup' : 'inbox.filter.expandGroup', { name: title })}
          onClick={() => toggleGroup(row)}
          onKeyDown={(e) => onRowKeyDown(e, row)}
          className={`${rowBase} ${rowHover} ${textSecondary}`}
          style={indent(row.level)}
        >
          {row.open ? <ChevronDown size={14} className="flex-shrink-0" /> : <ChevronRight size={14} className="flex-shrink-0" />}
          {label}
        </button>
      );
    }
    const isSelected = row.key === selectedKey;
    let content;
    if (row.type === 'project') {
      const goal = row.project.goalId ? goals.find((g) => g.id === row.project.goalId) : null;
      content = <>{dot(getProjectColor(row.project, goal))}<span className="truncate flex-1">{row.project.title}</span></>;
    } else if (row.key === 'new') {
      content = <><Plus size={14} className="flex-shrink-0 text-blue-500" /><span className="truncate flex-1">{t('task.newProjectOption')}</span></>;
    } else {
      content = <span className={`truncate flex-1 ${isSelected ? '' : textSecondary}`}>{t('task.noProject')}</span>;
    }
    return (
      <button
        key={row.key}
        ref={nodeRef(row.key)}
        type="button"
        data-project-picker-option={row.type === 'project' ? row.project.id : row.key}
        aria-current={isSelected ? 'true' : undefined}
        onClick={() => activate(row)}
        onKeyDown={(e) => onRowKeyDown(e, row)}
        className={`${rowBase} ${isSelected ? rowOn : `${rowHover} ${textPrimary}`}`}
        style={indent(row.type === 'project' ? row.level : 0)}
      >
        {content}
        {isSelected && <Check size={14} className="flex-shrink-0 text-blue-500" />}
      </button>
    );
  };

  const fieldBg = darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900';
  const panelId = `${id}-list`;
  const matches = rows.some((row) => row.type === 'project');

  return (
    <div ref={containerRef} data-task-project-picker onBlur={onBlur}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        data-project-picker-trigger
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={onTriggerKeyDown}
        className={`w-full flex items-center gap-2 px-3 py-2 border ${borderClass} rounded-lg text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldBg}`}
      >
        {selected ? (
          <>
            {dot(getProjectColor(selected, selectedGoal))}
            <span className="truncate">{selected.title}</span>
            {selectedGoal && (
              <span data-project-picker-goal className={`truncate text-xs ${textSecondary}`}>{selectedGoal.title}</span>
            )}
          </>
        ) : (
          <span className={`truncate ${darkMode ? 'text-gray-400' : 'text-stone-400'}`}>{t('task.noProject')}</span>
        )}
        <ChevronDown size={16} className={`ml-auto flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${textSecondary}`} />
      </button>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-labelledby={id}
          data-project-picker-panel
          onKeyDown={onPanelKeyDown}
          className={`mt-1 border ${borderClass} rounded-lg overflow-hidden ${fieldBg}`}
        >
          {projectCount >= FILTER_FROM && (
            <div className={`p-1.5 border-b ${borderClass}`}>
              <input
                ref={filterRef}
                type="search"
                data-project-picker-filter
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onFilterKeyDown}
                placeholder={t('task.filterProjects')}
                aria-label={t('task.filterProjects')}
                className={`w-full px-2 py-1 text-sm rounded-md border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-800 text-white placeholder-gray-400' : 'bg-white text-stone-900 placeholder-stone-400'}`}
              />
            </div>
          )}
          <div className={`p-1 overflow-y-auto overscroll-contain ${isMobile ? 'max-h-[45vh]' : 'max-h-72'}`}>
            {rows.map(renderRow)}
            {filtering && !matches && (
              <p className={`px-2 py-1.5 text-xs ${textSecondary}`}>{t('task.noMatchingProjects')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
