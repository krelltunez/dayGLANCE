import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Minus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getProjectColor, taskColorToHex } from '../utils/colorUtils.js';
import { groupInboxProjects } from '../utils/inboxProjectGroups.js';
import { hiddenGroupState } from '../utils/calendarFilter.js';
import { projectPickerRows } from '../utils/projectPickerRows.js';
import { readRememberedOpen, rememberOpen } from '../hooks/useRememberedOpen.js';

// The calendar filter's "Hide projects" section (#2307), in the desktop
// popover (GlanceSidebar) and the phone's bottom sheet (MobileBottomSheets).
// The projects are those the app's other pickers offer, grouped the same way
// (areas, goals, then the standalone projects; utils/projectPickerRows.js).
// A ticked project's tasks leave the calendar views on this device; they
// still occupy their time everywhere else (utils/calendarFilter.js).
//
// An area, a goal or the standalone projects hides all of its projects at
// once (#2332), as the Inbox filter selects them: the group's name, with a
// box that reads partly ticked while only some are hidden. Its chevron folds.

const OPEN_KEY = (key) => `day-planner-calendar-filter-open-${key}`;
const NO_GROUPS = { areas: [], standalone: [], hasAreas: false };

/** What the filter's button and header need, shared by the desktop and phone surfaces. */
export function useCalendarFilterSummary() {
  const planner = useDayPlannerCtx();
  const { goalsProjectsEnabled, projects, goals, areas } = useFeaturesCtx() || {};
  const groups = useMemo(() => (goalsProjectsEnabled
    ? groupInboxProjects({ projects: projects || [], goals: goals || [], areas: areas || [] })
    : NO_GROUPS), [goalsProjectsEnabled, projects, goals, areas]);
  const hasProjects = groups.areas.length > 0 || groups.standalone.length > 0;
  const tags = planner.filterableTags || [];
  const selectedTags = planner.selectedTags || [];
  const tagsNarrowed = !tags.every((tag) => selectedTags.includes(tag));
  const projectsHidden = (planner.liveHiddenProjects?.size || 0) > 0;
  return {
    groups,
    hasProjects,
    // The filter has something to offer: tags to pick, or projects to hide.
    available: tags.length > 0 || hasProjects,
    // The button lights while either part leaves something out.
    active: tagsNarrowed || projectsHidden,
    hiddenCount: planner.calendarHiddenCount || 0,
  };
}

export default function CalendarFilterProjects({ variant = 'popover', groups }) {
  const { t } = useTranslation();
  const {
    darkMode, textPrimary, textSecondary,
    liveHiddenProjects, toggleHiddenProject, toggleHiddenProjectGroup, showAllProjects,
  } = useDayPlannerCtx();
  const { goals } = useFeaturesCtx() || {};
  const hidden = liveHiddenProjects || new Set();
  const isHidden = (id) => hidden.has(String(id));
  const holdsHidden = (projects) => projects.some((p) => isHidden(p.id));

  // Folds remembered on this device, as the task editor's picker keeps its
  // own. A goal opens by default when it holds a hidden project, so what is
  // hidden is never folded out of sight on first opening; not when every one
  // of its projects is, since its own box says so (#2332).
  const [folds, setFolds] = useState({});
  const holdsSome = (projects) => holdsHidden(projects) && !projects.every((p) => isHidden(p.id));
  const goalHolds = new Map([['standalone', holdsSome(groups.standalone)]]);
  for (const area of groups.areas) for (const goal of area.goals) goalHolds.set(`goal-${goal.id}`, holdsSome(goal.projects));
  const isOpen = (key, defaultOpen) => folds[key] ?? readRememberedOpen(OPEN_KEY(key), defaultOpen || !!goalHolds.get(key));
  const rows = projectPickerRows(groups, { isOpen });
  const toggleFold = (row) => {
    const next = !row.open;
    rememberOpen(OPEN_KEY(row.key), next);
    setFolds((was) => ({ ...was, [row.key]: next }));
  };
  // Hiding a group changes what its fold defaults to; keep it as it is on
  // screen, so the row the user just clicked does not open or close under them.
  const toggleGroupHidden = (row) => {
    setFolds((was) => (row.key in was ? was : { ...was, [row.key]: row.open }));
    toggleHiddenProjectGroup(row.ids);
  };
  const box = (state) => (
    <span className={`${sheet ? 'w-5 h-5' : 'w-4 h-4'} rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
      state !== 'none' ? 'bg-blue-500 border-blue-500' : darkMode ? 'border-gray-600' : 'border-stone-300'
    }`}>
      {state === 'all' && <EyeOff size={sheet ? 13 : 11} className="text-white" />}
      {state === 'some' && <Minus size={sheet ? 13 : 11} className="text-white" />}
    </span>
  );

  const sheet = variant === 'sheet';
  const indent = (level) => ({ paddingLeft: `${0.75 + level}rem` });
  const dot = (color) => (
    <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: taskColorToHex(color) }} />
  );
  const groupTitle = (row) => {
    if (row.kind === 'standalone') return t('goals.standalone');
    if (row.kind === 'area' && row.title === null) return t('goals.noDefinedArea');
    return row.title;
  };
  const rowHover = darkMode ? (sheet ? 'active:bg-white/5' : 'hover:bg-white/5') : (sheet ? 'active:bg-stone-50' : 'hover:bg-stone-50');
  const rowPad = sheet ? 'py-3' : 'py-2';

  return (
    <div data-calendar-filter-projects>
      <div className={`flex items-center justify-between ${sheet ? 'px-4 pt-2 pb-1' : 'px-3 pt-2 pb-1'}`}>
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${textSecondary}`}>
          {t('calendarFilter.hideProjects')}
        </span>
        {hidden.size > 0 && (
          <button
            type="button"
            data-show-all-projects
            onClick={showAllProjects}
            className={`${sheet ? 'text-sm' : 'text-xs'} text-blue-500 hover:text-blue-600 font-medium`}
          >
            {t('calendarFilter.showAll')}
          </button>
        )}
      </div>
      <div className={sheet ? 'px-1 pb-2' : 'pb-1'}>
        {rows.map((row) => {
          if (row.type === 'group') {
            const title = groupTitle(row);
            const state = hiddenGroupState(hidden, row.ids);
            return (
              <div key={row.key} className="flex items-center gap-0.5 pr-3" style={indent(row.level)}>
                <button
                  type="button"
                  data-calendar-filter-group={row.key}
                  aria-expanded={row.open}
                  aria-label={t(row.open ? 'inbox.filter.collapseGroup' : 'inbox.filter.expandGroup', { name: title })}
                  onClick={() => toggleFold(row)}
                  className={`flex-shrink-0 rounded-md ${sheet ? 'p-2 -ml-2' : 'p-1 -ml-1'} ${rowHover} ${textSecondary}`}
                >
                  {row.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button
                  type="button"
                  data-hide-group={row.key}
                  data-group-state={state}
                  aria-pressed={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                  title={t(state === 'all' ? 'calendarFilter.showGroup' : 'calendarFilter.hideGroup', { name: title })}
                  onClick={() => toggleGroupHidden(row)}
                  className={`flex-1 min-w-0 flex items-center gap-2 px-1.5 ${sheet ? 'py-2' : 'py-1.5'} text-left rounded-md transition-colors ${
                    state === 'all' ? (darkMode ? 'bg-blue-500/20' : 'bg-blue-50') : rowHover
                  } ${textSecondary}`}
                >
                  {box(state)}
                  {row.kind === 'goal' && row.color ? dot(row.color) : null}
                  <span className={`truncate ${row.kind === 'area' ? 'text-[11px] font-semibold uppercase tracking-wide' : 'text-xs font-medium'} ${state === 'all' ? 'line-through opacity-70' : ''}`}>{title}</span>
                  <span className="text-xs opacity-60">{row.count}</span>
                </button>
              </div>
            );
          }
          const { project } = row;
          const on = isHidden(project.id);
          const goal = project.goalId ? (goals || []).find((g) => g.id === project.goalId) : null;
          return (
            <button
              key={row.key}
              type="button"
              data-hide-project={project.id}
              aria-pressed={on}
              onClick={() => toggleHiddenProject(project.id)}
              className={`w-full flex items-center gap-2 pr-3 ${rowPad} text-left rounded-md transition-colors ${
                on ? (darkMode ? 'bg-blue-500/20' : 'bg-blue-50') : rowHover
              }`}
              style={indent(row.level)}
            >
              {box(on ? 'all' : 'none')}
              {dot(getProjectColor(project, goal))}
              <span className={`flex-1 truncate text-sm ${textPrimary} ${on ? 'line-through opacity-70' : ''}`}>{project.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
