import React, { useMemo } from 'react';
import { Archive, CheckCircle2, Circle, Layers, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { archivedProjectContents, restoredStatus } from '../../utils/archiveCascade.js';

const shortDate = (iso, lang) => {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(lang, { year: 'numeric', month: 'short', day: 'numeric' });
};

// A read-only look at an archived project (#2260): what it held when it was
// archived, without restoring it. The completed tasks are the ones the archive
// hid; the open ones were moved out so they stayed visible, and are listed
// where they are now. Restore is offered here too. Escape is handled by the
// Goals space's own handler, which owns Escape for what it opens.
const ArchivedProjectReview = ({ project, onClose }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, tasks = [], unscheduledTasks = [] } = useDayPlannerCtx();
  const { goals = [], updateProject } = useFeaturesCtx();
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const { completed, detached } = useMemo(
    () => archivedProjectContents(project, [...tasks, ...unscheduledTasks]),
    [project, tasks, unscheduledTasks],
  );
  if (!project) return null;
  const goal = project.goalId ? goals.find(g => g.id === project.goalId) : null;
  const archivedAt = shortDate(project.archiveRecord?.archivedAt, locale);
  const rowClass = 'flex items-start gap-2 px-2 py-1.5 text-sm';

  const taskRow = (task) => (
    <li key={task.id} className={rowClass}>
      {task.completed
        ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0 text-emerald-500" />
        : <Circle size={14} className={`mt-0.5 flex-shrink-0 ${textSecondary}`} />}
      <span className={`flex-1 min-w-0 break-words ${task.completed ? `${textSecondary} line-through` : textPrimary}`}>{task.title}</span>
      {task.completed && task.completedAt && (
        <span className={`flex-shrink-0 text-xs ${textSecondary}`}>{shortDate(task.completedAt, locale)}</span>
      )}
    </li>
  );

  return (
    <div
      data-archived-review
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={project.title}
        className={`${cardBg} rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`flex items-start gap-2 px-5 pt-5 pb-3 border-b ${borderClass}`}>
          <Layers size={16} className="mt-1 flex-shrink-0 text-emerald-400" />
          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold ${textPrimary} break-words`}>{project.title}</h3>
            <p className={`text-xs ${textSecondary} flex items-center gap-1 mt-0.5`}>
              <Archive size={11} className="flex-shrink-0" />
              <span className="truncate">
                {[archivedAt ? t('goals.archivedOnDate', { date: archivedAt }) : t('common.archived'), goal?.title].filter(Boolean).join(' · ')}
              </span>
            </p>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className={`p-1 rounded ${textSecondary}`}>
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-3 py-3 flex flex-col gap-3">
          {project.description && (
            <p className={`px-2 text-sm ${textSecondary} whitespace-pre-wrap break-words`}>{project.description}</p>
          )}
          {completed.length === 0 && detached.length === 0 && (
            <p className={`px-2 text-sm ${textSecondary}`}>{t('goals.archivedNoTasks')}</p>
          )}
          {completed.length > 0 && (
            <section data-archived-completed>
              <h4 className={`px-2 mb-1 text-xs font-medium uppercase tracking-wider ${textSecondary}`}>
                {t('goals.archivedCompletedTasks', { count: completed.length })}
              </h4>
              <ul>{completed.map(taskRow)}</ul>
            </section>
          )}
          {detached.length > 0 && (
            <section data-archived-moved>
              <h4 className={`px-2 mb-1 text-xs font-medium uppercase tracking-wider ${textSecondary}`}>
                {t('goals.archivedMovedTasks', { count: detached.length })}
              </h4>
              <p className={`px-2 mb-1 text-xs ${textSecondary}`}>{t('goals.archivedMovedHint')}</p>
              <ul>{detached.map(taskRow)}</ul>
            </section>
          )}
        </div>

        <div className={`flex justify-end gap-2 px-5 py-3 border-t ${borderClass}`}>
          <button
            onClick={onClose}
            className={`px-3 py-1.5 rounded-lg text-sm ${textSecondary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`}
          >
            {t('common.close')}
          </button>
          <button
            onClick={() => { updateProject(project.id, { status: restoredStatus(project) }); onClose(); }}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-blue-600 text-white hover:bg-blue-700"
          >
            <RotateCcw size={13} /> {t('common.restore')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArchivedProjectReview;
