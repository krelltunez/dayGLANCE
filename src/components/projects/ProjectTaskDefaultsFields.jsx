import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { normalizeTaskDefaults, taskDefaultsOf } from '../../utils/projectTaskDefaults.js';

// The project form's "New task defaults" (#2336): what a task created in the
// project starts with (utils/projectTaskDefaults.js). Controlled: the form
// holds the text as typed (`value`, from taskDefaultsForm) and stores it with
// taskDefaultsFromForm on save. Folded unless the project has some, so a
// project without defaults keeps the short form it always had.
//
// "Copy from…" fills the fields from another project's defaults.
//
// The goal and area forms use the same fields for the defaults they hold for
// NEW PROJECTS (projectTaskDefaults.js, seedTaskDefaults): their own title and
// hint, no "Copy from…", and an "Apply to projects" control below the fields
// (ApplyTaskDefaults) that replaces the open projects' defaults on save.

/** The form's text fields for a project's stored defaults. */
export function taskDefaultsForm(project) {
  const d = taskDefaultsOf(project);
  return {
    duration: d.duration ? String(d.duration) : '',
    tags: (d.tags || []).map((tag) => `#${tag}`).join(' '),
    notes: d.notes || '',
    subtasks: (d.subtasks || []).join('\n'),
    energy: d.energy || '',
  };
}

/** What the project stores for the form's text: undefined for nothing. */
export const taskDefaultsFromForm = (form) => normalizeTaskDefaults(form);

export default function ProjectTaskDefaultsFields({
  value, onChange, projects = [], selfId = null, darkMode, borderClass, textSecondary, hoverBg,
  title, hint, children,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(() => !!taskDefaultsFromForm(value));
  const set = (field) => (e) => onChange({ ...value, [field]: e.target.value });
  const inputClass = `px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
  }`;
  const sources = projects.filter((p) => p && p.id !== selfId && p.status !== 'archived' && normalizeTaskDefaults(p.taskDefaults));

  return (
    <div className="flex flex-col gap-2" data-project-task-defaults>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className={`flex items-center gap-1 text-xs font-medium ${textSecondary} self-start rounded ${hoverBg} -ml-1 px-1 py-0.5`}
        data-project-task-defaults-toggle
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title || t('goals.taskDefaults.title')}
      </button>
      {open && (
        <div className="flex flex-col gap-3 pl-1">
          <p className={`text-xs ${textSecondary}`}>{hint || t('goals.taskDefaults.hint')}</p>
          {sources.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const source = sources.find((p) => p.id === e.target.value);
                if (source) onChange(taskDefaultsForm(source));
              }}
              className={inputClass}
              aria-label={t('goals.taskDefaults.copyFrom')}
              data-project-task-defaults-copy
            >
              <option value="">{t('goals.taskDefaults.copyFrom')}</option>
              {sources.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          )}
          <label className="flex flex-col gap-1">
            <span className={`text-xs ${textSecondary}`}>{t('goals.taskDefaults.duration')}</span>
            <input
              type="number" min="1" max="1440" inputMode="numeric"
              value={value.duration} onChange={set('duration')}
              placeholder="30" className={`${inputClass} w-28`}
              data-project-task-defaults-duration
            />
          </label>
          {/* Energy: the task's own, as if set from its marker; empty leaves it to the title. */}
          <label className="flex flex-col gap-1">
            <span className={`text-xs ${textSecondary}`}>{t('goals.taskDefaults.energy')}</span>
            <select
              value={value.energy || ''} onChange={set('energy')}
              className={`${inputClass} w-56`}
              data-project-task-defaults-energy
            >
              <option value="">{t('goals.taskDefaults.energyAuto')}</option>
              <option value="effort">{t('strip.effort')}</option>
              <option value="restore">{t('strip.restore')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-xs ${textSecondary}`}>{t('goals.taskDefaults.tags')}</span>
            <input
              value={value.tags} onChange={set('tags')}
              placeholder={t('goals.taskDefaults.tagsPlaceholder')} className={inputClass}
              data-project-task-defaults-tags
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-xs ${textSecondary}`}>{t('goals.taskDefaults.notes')}</span>
            <textarea
              rows={3} value={value.notes} onChange={set('notes')}
              placeholder={t('goals.taskDefaults.notesPlaceholder')} className={`${inputClass} resize-y`}
              data-project-task-defaults-notes
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={`text-xs ${textSecondary}`}>{t('goals.taskDefaults.subtasks')}</span>
            <textarea
              rows={3} value={value.subtasks} onChange={set('subtasks')}
              placeholder={t('goals.taskDefaults.subtasksPlaceholder')} className={`${inputClass} resize-y`}
              data-project-task-defaults-subtasks
            />
          </label>
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * "Apply to open projects (N)…" under a goal's or an area's defaults: asks
 * first, inline, then `onApply` saves the form and replaces the projects'
 * defaults. Nothing to show without an open project to apply to.
 */
export function ApplyTaskDefaults({ count, confirmText, onApply, borderClass, textSecondary, hoverBg }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  if (!count) return null;
  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={`self-start text-xs font-medium px-2.5 py-1.5 rounded-lg border ${borderClass} ${textSecondary} ${hoverBg}`}
        data-apply-task-defaults
      >
        {t('goals.taskDefaults.applyToProjects', { count })}
      </button>
    );
  }
  return (
    <div className={`flex flex-col gap-2 rounded-lg border ${borderClass} p-2.5`} data-apply-task-defaults-confirm>
      <p className={`text-xs ${textSecondary}`}>{confirmText}</p>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setAsking(false)} className={`px-2.5 py-1 text-xs rounded-lg ${hoverBg} ${textSecondary}`}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          onClick={onApply}
          className="px-3 py-1 text-xs rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium"
          data-apply-task-defaults-save
        >
          {t('goals.taskDefaults.applySave')}
        </button>
      </div>
    </div>
  );
}
