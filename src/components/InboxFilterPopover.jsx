import React, { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { extractTags } from '../utils/taskUtils.js';
import { useTranslation } from 'react-i18next';
import { notBucketed } from '../utils/bucketList.js';
import useRememberedOpen from '../hooks/useRememberedOpen.js';
import { groupInboxProjects, projectIdsOf, selectionState, toggleProjectGroup } from '../utils/inboxProjectGroups.js';

// Open or closed, remembered on this device per section and group, the way
// the SCHED rail keeps its sections (#2232).
const OPEN_KEY = (key) => `day-planner-inbox-filter-open-${key}`;
const useRemembered = (key, defaultOpen) => useRememberedOpen(OPEN_KEY(key), defaultOpen);

/** A section of the popover (Status, Type, Projects, Tags): its header folds it. */
const Section = ({ storageKey, title, count, textSecondary, hoverBg, children }) => {
  const [open, toggle] = useRemembered(`section-${storageKey}`, true);
  return (
    <div data-inbox-filter-section={storageKey}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`w-full flex items-center justify-between -mx-1 px-1 py-0.5 mb-1.5 rounded ${hoverBg} transition-colors`}
      >
        <span className={`text-[10px] font-semibold uppercase tracking-wider ${textSecondary}`}>
          {title}{count ? <span className="ml-1.5 text-blue-500">{count}</span> : null}
        </span>
        {open ? <ChevronDown size={12} className={textSecondary} /> : <ChevronRight size={12} className={textSecondary} />}
      </button>
      {open && children}
    </div>
  );
};

/**
 * An area, a goal or the standalone projects: a chip that selects every
 * project in it (filled when all are, outlined when some are), and a chevron
 * that folds what it holds.
 */
const ProjectGroup = ({ storageKey, defaultOpen, label, ids, selected, onSelect, chip, textSecondary, hoverBg, labelClass = '', children }) => {
  const { t } = useTranslation();
  const [open, toggle] = useRemembered(storageKey, defaultOpen);
  const state = selectionState(selected, ids);
  return (
    <div data-inbox-filter-group={storageKey}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t(open ? 'inbox.filter.collapseGroup' : 'inbox.filter.expandGroup', { name: label })}
          className={`p-0.5 rounded ${hoverBg} ${textSecondary} transition-colors`}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          data-group-state={state}
          onClick={() => onSelect(ids)}
          title={t('inbox.filter.selectGroup', { name: label })}
          className={`${chip(state)} ${labelClass}`}
        >
          {label}<span className="ml-1 opacity-70">{ids.length}</span>
        </button>
      </div>
      {open && <div className="pl-5 pt-1.5 flex flex-col gap-1.5">{children}</div>}
    </div>
  );
};

/**
 * Popover for inbox filtering. Attach a ref to the trigger button and pass it
 * as `buttonRef` so the popover can position itself below it.
 */
const InboxFilterPopover = ({ open, onClose, buttonRef }) => {
  const {
    darkMode, textPrimary, textSecondary, cardBg, borderClass, hoverBg,
    unscheduledTasks,
    hideCompletedInbox, setHideCompletedInbox,
    hideProjectTasksInbox, setHideProjectTasksInbox,
    hideStandaloneTasksInbox, setHideStandaloneTasksInbox,
    inboxTagFilter, setInboxTagFilter,
    inboxProjectFilter, setInboxProjectFilter,
  } = useDayPlannerCtx();
  const { t } = useTranslation();
  const { goalsProjectsEnabled, projects, goals, areas } = useFeaturesCtx();

  const popoverRef = useRef(null);

  // Position below the trigger button, spanning the inbox container width
  useEffect(() => {
    if (!open || !buttonRef?.current || !popoverRef.current) return;
    const btnRect = buttonRef.current.getBoundingClientRect();
    const container = buttonRef.current.closest('[data-inbox-container]');
    const pop = popoverRef.current;
    if (container) {
      const cRect = container.getBoundingClientRect();
      pop.style.top = `${btnRect.bottom + 6}px`;
      pop.style.left = `${cRect.left}px`;
      pop.style.width = `${cRect.width}px`;
    } else {
      // Fallback: align to button
      const vw = window.innerWidth;
      let left = Math.min(btnRect.right - pop.offsetWidth, vw - pop.offsetWidth - 8);
      if (left < 8) left = 8;
      pop.style.top = `${btnRect.bottom + 6}px`;
      pop.style.left = `${left}px`;
    }
  }, [open, buttonRef]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Tags and projects present in inbox tasks
  const inboxTags = useMemo(() => {
    const tagSet = new Set();
    unscheduledTasks.filter(notBucketed).forEach(t => extractTags(t.title).forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [unscheduledTasks]);

  // Areas, their goals and the goals' projects, then standalone projects (#2232).
  const projectGroups = useMemo(() => (goalsProjectsEnabled
    ? groupInboxProjects({ projects: projects || [], goals: goals || [], areas: areas || [] })
    : { areas: [], standalone: [], hasAreas: false }
  ), [projects, goals, areas, goalsProjectsEnabled]);
  const hasProjects = projectGroups.areas.length > 0 || projectGroups.standalone.length > 0;

  const isNonDefault =
    hideCompletedInbox ||
    hideStandaloneTasksInbox ||
    (goalsProjectsEnabled && !hideProjectTasksInbox) ||
    inboxTagFilter.length > 0 ||
    inboxProjectFilter.length > 0;

  const toggleTag = (tag) => {
    setInboxTagFilter(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const toggleProject = (id) => {
    setInboxProjectFilter(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };
  const toggleGroup = (ids) => setInboxProjectFilter(prev => toggleProjectGroup(prev, ids));

  const clearAll = () => {
    setHideCompletedInbox(false);
    setHideProjectTasksInbox(true); // restore default
    setHideStandaloneTasksInbox(false);
    setInboxTagFilter([]);
    setInboxProjectFilter([]);
  };

  if (!open) return null;

  const chipBase = 'inline-flex items-center text-xs px-2.5 py-1 rounded-full font-medium transition-colors cursor-pointer select-none';
  const chipOn = darkMode ? 'bg-blue-600 text-white' : 'bg-blue-600 text-white';
  const chipOff = darkMode ? 'bg-white/10 text-gray-300 hover:bg-white/20' : 'bg-stone-100 text-stone-600 hover:bg-stone-200';

  // A group's chip: filled when every project in it is selected, outlined when some are.
  const groupChip = (state) => `${chipBase} ${state === 'all' ? chipOn
    : state === 'some' ? `${chipOff} ring-1 ring-inset ring-blue-500` : chipOff}`;
  const themed = { textSecondary, hoverBg };
  const projectChips = (list) => (
    <div className="flex gap-1.5 flex-wrap">
      {list.map(p => (
        <button
          key={p.id}
          className={`${chipBase} ${inboxProjectFilter.includes(p.id) ? chipOn : chipOff}`}
          onClick={() => toggleProject(p.id)}
        >
          {p.title}
        </button>
      ))}
    </div>
  );
  // A goal folds closed unless one of its projects is selected, so a long
  // list opens as its goals; an area stays open.
  const goalGroup = (goal) => {
    const ids = projectIdsOf(goal);
    return (
      <ProjectGroup
        key={goal.id}
        storageKey={`goal-${goal.id}`}
        defaultOpen={selectionState(inboxProjectFilter, ids) !== 'none'}
        label={goal.title}
        ids={ids}
        selected={inboxProjectFilter}
        onSelect={toggleGroup}
        chip={groupChip}
        {...themed}
      >
        {projectChips(goal.projects)}
      </ProjectGroup>
    );
  };

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[79]" onClick={onClose} />

      {/* Popover */}
      <div
        ref={popoverRef}
        className={`fixed z-[80] rounded-xl shadow-2xl border ${cardBg} ${borderClass} overflow-hidden`}
        style={{ top: 0, left: 0 }} // overwritten by effect
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-3 py-2.5 border-b ${borderClass}`}>
          <span className={`text-sm font-semibold ${textPrimary}`}>{t('common.filterInbox')}</span>
          <div className="flex items-center gap-1">
            {isNonDefault && (
              <button
                onClick={clearAll}
                className={`text-xs px-2 py-0.5 rounded ${hoverBg} ${textSecondary} transition-colors`}
              >
                {t('sched.clearAll')}
              </button>
            )}
            <button onClick={onClose} className={`p-1 rounded ${hoverBg} transition-colors`} aria-label={t('common.close')}>
              <X size={13} className={textSecondary} />
            </button>
          </div>
        </div>

        <div className="p-3 flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
          {/* Status */}
          <Section storageKey="status" title={t('common.status')} count={hideCompletedInbox ? 1 : 0} {...themed}>
            <div className="flex gap-1.5 flex-wrap">
              <button
                className={`${chipBase} ${!hideCompletedInbox ? chipOn : chipOff}`}
                onClick={() => setHideCompletedInbox(false)}
              >
                {t('inbox.filter.incompleteAndComplete', { defaultValue: 'Incomplete & Complete' })}
              </button>
              <button
                className={`${chipBase} ${hideCompletedInbox ? chipOn : chipOff}`}
                onClick={() => setHideCompletedInbox(true)}
              >
                {t('inbox.filter.incompleteOnly', { defaultValue: 'Incomplete only' })}
              </button>
            </div>
          </Section>

          {/* Type */}
          {goalsProjectsEnabled && (
            <Section storageKey="type" title={t('common.type')} {...themed}>
              <div className="flex gap-1.5 flex-wrap">
                <button
                  className={`${chipBase} ${!hideProjectTasksInbox ? chipOn : chipOff}`}
                  onClick={() => setHideProjectTasksInbox(prev => !prev)}
                  title={t('inbox.filter.projectTasksHint', { defaultValue: 'Tasks linked to a project' })}
                >
                  {t('inbox.filter.projectTasks', { defaultValue: 'Project tasks' })}
                </button>
                <button
                  className={`${chipBase} ${!hideStandaloneTasksInbox ? chipOn : chipOff}`}
                  onClick={() => setHideStandaloneTasksInbox(prev => !prev)}
                  title={t('inbox.filter.standaloneHint', { defaultValue: 'Tasks not linked to any project' })}
                >
                  {t('sched.standalone')}
                </button>
              </div>
            </Section>
          )}

          {/* Projects, by area and goal (#2232) */}
          {hasProjects && (
            <Section storageKey="projects" title={t('sched.projects')} count={inboxProjectFilter.length} {...themed}>
              <div className="flex flex-col gap-1.5">
                {projectGroups.areas.map(area => (projectGroups.hasAreas ? (
                  <ProjectGroup
                    key={area.id ?? 'no-area'}
                    storageKey={`area-${area.id ?? 'none'}`}
                    defaultOpen
                    label={area.title ?? t('goals.noDefinedArea')}
                    ids={projectIdsOf(area)}
                    selected={inboxProjectFilter}
                    onSelect={toggleGroup}
                    chip={groupChip}
                    labelClass="uppercase tracking-wide"
                    {...themed}
                  >
                    {area.goals.map(goalGroup)}
                  </ProjectGroup>
                ) : (
                  <React.Fragment key="goals">{area.goals.map(goalGroup)}</React.Fragment>
                )))}
                {projectGroups.standalone.length > 0 && (
                  <ProjectGroup
                    storageKey="standalone"
                    defaultOpen={projectGroups.areas.length === 0 || selectionState(inboxProjectFilter, projectGroups.standalone.map(p => p.id)) !== 'none'}
                    label={t('sched.standalone')}
                    ids={projectGroups.standalone.map(p => p.id)}
                    selected={inboxProjectFilter}
                    onSelect={toggleGroup}
                    chip={groupChip}
                    {...themed}
                  >
                    {projectChips(projectGroups.standalone)}
                  </ProjectGroup>
                )}
              </div>
            </Section>
          )}

          {/* Tags */}
          {inboxTags.length > 0 && (
            <Section storageKey="tags" title={t('sched.tags')} count={inboxTagFilter.length} {...themed}>
              <div className="flex gap-1.5 flex-wrap">
                {inboxTags.map(tag => (
                  <button
                    key={tag}
                    className={`${chipBase} ${inboxTagFilter.includes(tag) ? chipOn : chipOff}`}
                    onClick={() => toggleTag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </Section>
          )}

        </div>
      </div>
    </>,
    document.body
  );
};

export default InboxFilterPopover;
