import React, { useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { extractTags } from '../utils/taskUtils.js';

/**
 * Popover for inbox filtering. Attach a ref to the trigger button and pass it
 * as `buttonRef` so the popover can position itself below it.
 */
const InboxFilterPopover = ({ open, onClose, buttonRef }) => {
  const {
    darkMode, textPrimary, textSecondary, cardBg, borderClass, hoverBg,
    goalsProjectsEnabled,
    projects, unscheduledTasks,
    hideCompletedInbox, setHideCompletedInbox,
    hideProjectTasksInbox, setHideProjectTasksInbox,
    hideStandaloneTasksInbox, setHideStandaloneTasksInbox,
    inboxTagFilter, setInboxTagFilter,
    inboxProjectFilter, setInboxProjectFilter,
  } = useDayPlannerCtx();

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
    unscheduledTasks.forEach(t => extractTags(t.title).forEach(tag => tagSet.add(tag)));
    return Array.from(tagSet).sort();
  }, [unscheduledTasks]);

  const inboxProjects = useMemo(() => {
    if (!goalsProjectsEnabled) return [];
    return projects.filter(p => p.status !== 'archived' && p.status !== 'completed');
  }, [projects, goalsProjectsEnabled]);

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

  const SectionLabel = ({ children }) => (
    <div className={`text-[10px] font-semibold uppercase tracking-wider ${textSecondary} mb-2`}>{children}</div>
  );

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
          <span className={`text-sm font-semibold ${textPrimary}`}>Filter Inbox</span>
          <div className="flex items-center gap-1">
            {isNonDefault && (
              <button
                onClick={clearAll}
                className={`text-xs px-2 py-0.5 rounded ${hoverBg} ${textSecondary} transition-colors`}
              >
                Clear all
              </button>
            )}
            <button onClick={onClose} className={`p-1 rounded ${hoverBg} transition-colors`}>
              <X size={13} className={textSecondary} />
            </button>
          </div>
        </div>

        <div className="p-3 flex flex-col gap-3">
          {/* Status */}
          <div>
            <SectionLabel>Status</SectionLabel>
            <div className="flex gap-1.5 flex-wrap">
              <button
                className={`${chipBase} ${!hideCompletedInbox ? chipOn : chipOff}`}
                onClick={() => setHideCompletedInbox(false)}
              >
                Incomplete &amp; Complete
              </button>
              <button
                className={`${chipBase} ${hideCompletedInbox ? chipOn : chipOff}`}
                onClick={() => setHideCompletedInbox(true)}
              >
                Incomplete only
              </button>
            </div>
          </div>

          {/* Type */}
          {goalsProjectsEnabled && (
            <div>
              <SectionLabel>Type</SectionLabel>
              <div className="flex gap-1.5 flex-wrap">
                <button
                  className={`${chipBase} ${!hideProjectTasksInbox ? chipOn : chipOff}`}
                  onClick={() => setHideProjectTasksInbox(prev => !prev)}
                  title="Tasks linked to a project"
                >
                  Project tasks
                </button>
                <button
                  className={`${chipBase} ${!hideStandaloneTasksInbox ? chipOn : chipOff}`}
                  onClick={() => setHideStandaloneTasksInbox(prev => !prev)}
                  title="Tasks not linked to any project"
                >
                  Standalone
                </button>
              </div>
            </div>
          )}

          {/* Projects */}
          {inboxProjects.length > 0 && (
            <div>
              <SectionLabel>Projects</SectionLabel>
              <div className="flex gap-1.5 flex-wrap">
                {inboxProjects.map(p => (
                  <button
                    key={p.id}
                    className={`${chipBase} ${inboxProjectFilter.includes(p.id) ? chipOn : chipOff}`}
                    onClick={() => toggleProject(p.id)}
                  >
                    {p.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {inboxTags.length > 0 && (
            <div>
              <SectionLabel>Tags</SectionLabel>
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
            </div>
          )}

        </div>
      </div>
    </>,
    document.body
  );
};

export default InboxFilterPopover;
