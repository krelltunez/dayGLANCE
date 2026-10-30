import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  CircleCheckBig,
  CircleDashed,
  ChevronLeft,
  ChevronRight,
  Edit2,
  Flag,
  FolderOpen,
  GitBranch,
  GripVertical,
  Layers,
  Link2,
  LogIn,
  Plus,
  RotateCcw,
  Compass,
  Search,
  Trash2,
  X,
  Zap,
  // hyperGLANCE icon picker icons
  BookOpen, GraduationCap, Brain, Calculator, FlaskConical, Pencil, Globe, Microscope, BookMarked,
  Briefcase, Code2, LineChart, Target, LayoutDashboard, Clipboard, Users, Mail, Rocket,
  Dumbbell, Heart, Activity, Apple, Moon, Bike, Leaf, Trophy, Flame,
  Music, Camera, Palette, Lightbulb, Wand2, Headphones, Mic, Film, Star, LayoutGrid,
} from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { noteLinkOf, noteLinkFromTitle, noteCreateFields } from '../../utils/obsidianProjectNotes.js';
import { isStreamPosture } from '../../utils/obsidianVaultPosture.js';
import { TASK_COLORS, TAILWIND_TO_HEX, hexToRgba, PROJECT_FALLBACK_COLOR, getProjectColor } from '../../utils/colorUtils.js';
import { dateToString } from '../../utils/taskUtils.js';
import { calculateGoalProgress } from '../../utils/goalProgress.js';
import { calculateProjectProgress } from '../../utils/projectProgress.js';
import { hasStalledChild, isProjectFlaggedStalled } from '../../utils/stalledBadge.js';
import { getActiveHGInstance } from '../../hooks/useHyperGlance.js';
import GoalCard from './GoalCard.jsx';
import { autoSizeTextarea } from '../../utils/autoSizeTextarea.js';
import GoalNotes from './GoalNotes.jsx';
import GoalTimeline, { DEFAULT_PERIOD, GoalRangeToggle } from './GoalTimeline.jsx';
import useProjectDrag from './useProjectDrag.js';
import { useTranslation } from 'react-i18next';
import GoalProgress from './GoalProgress.jsx';
import ProjectCard from '../projects/ProjectCard.jsx';
import ConfirmDialog from '../ConfirmDialog.jsx';
import ArchivedProjectReview from './ArchivedProjectReview.jsx';
import { groupArchivedProjects, restoredStatus } from '../../utils/archiveCascade.js';
import AspireModal from '../AspireModal.jsx';
import GoalsAddMenu from './GoalsAddMenu.jsx';
import UserAssignmentPicker from '../UserAssignmentPicker.jsx';
import { emitGoalCreate } from '../../intents/emitGoalCreate.js';
import { INTENT_CONFIG_KEY } from '../../intents/useIntentPoller.js';
import { enabledIntentTargets } from '../../intents/emitTargets.js';
import { sortProjectsByOrder } from '../../utils/projectOrder.js';
import { projectFocusTarget } from '../../utils/goalsLink.js';
import { CARD_SIZES, cardColumns, cardScale, clampCardSize } from '../../utils/cardSize.js';
import { keyboardSheet } from '../../utils/keyboardInset.js';

// ─── Tiny helpers ─────────────────────────────────────────────────────────────

// Layout effect on the client; a plain effect under server rendering (tests),
// where useLayoutEffect only warns.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// Phone Goals tab: whether the chevron has hidden the controls (localStorage).
const PHONE_CONTROLS_KEY = 'dayglance-goals-phone-controls-collapsed';

/** Returns the hex value for a Tailwind bg-* class, falling back to blue. */
const toHex = (bgClass) => TAILWIND_TO_HEX[bgClass] || '#3b82f6';

/** Sort projects within a group by sortOrder, preserving array order for items
 *  without it. Shared with the Goal widget's payload (utils/projectOrder.js). */
const sortByOrder = sortProjectsByOrder;

/** Returns a light background for a Tailwind bg-* class. */
const toLightBg = (bgClass, dark) => {
  const hex = toHex(bgClass);
  return dark ? hexToRgba(hex, 0.13) : hexToRgba(hex, 0.09);
};


// ─── Goal sorting helpers ─────────────────────────────────────────────────────

/**
 * 0 = completed  (top of the list / left side of the phone carousel)
 * 1 = overdue    (next)
 * 2 = active / upcoming / no date  (default selection)
 */
function categorizeGoal(goal) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (goal.status === 'completed') return 0;
  if (goal.targetDate && new Date(goal.targetDate + 'T00:00:00') < today) return 1;
  return 2;
}

function sortGoalsForCarousel(goals) {
  return [...goals].sort((a, b) => {
    const ca = categorizeGoal(a);
    const cb = categorizeGoal(b);
    if (ca !== cb) return ca - cb;
    if (!a.targetDate && !b.targetDate) return 0;
    if (!a.targetDate) return 1;
    if (!b.targetDate) return -1;
    return (
      new Date(a.targetDate + 'T00:00:00') - new Date(b.targetDate + 'T00:00:00')
    );
  });
}

function findDefaultActiveIdx(sortedGoals) {
  const idx = sortedGoals.findIndex(g => categorizeGoal(g) === 2);
  return idx === -1 ? 0 : idx;
}

// ─── Goal form (create / edit) ────────────────────────────────────────────────

export const GoalForm = ({ initial, childProjects = [], onSave, onCancel, onDelete, mobile, showLifeGlanceCheckbox = false }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg, isMobile } =
    useDayPlannerCtx();
  const { multiUserEnabled, users, areas = [] } = useFeaturesCtx();
  const { t } = useTranslation();

  const [title, setTitle] = useState(initial?.title || '');
  // A NEW goal's description only. An existing goal's description is edited
  // in the notes box on its detail (#2076), as a project's is in the Project
  // Planner, which also handles a description that lives in a linked note.
  const [description, setDescription] = useState('');
  const [areaId, setAreaId] = useState(initial?.areaId || '');
  // New goals default their start date to today; existing goals keep whatever
  // they have (blank for goals created before this field existed).
  const [startDate, setStartDate] = useState(
    initial?.startDate ?? (initial ? '' : dateToString(new Date()))
  );
  const [targetDate, setTargetDate] = useState(initial?.targetDate || '');
  const [color, setColor] = useState(initial?.color || TASK_COLORS[0].class);
  // New goals inherit the selected area's color until the user explicitly
  // picks one (copy-at-creation: editing an existing goal never auto-changes).
  const [colorTouched, setColorTouched] = useState(!!initial);
  const [status, setStatus] = useState(initial?.status || 'active');
  const [assignedUserSyncIds, setAssignedUserSyncIds] = useState(initial?.assignedUserSyncIds || []);
  const [hideStalled, setHideStalled] = useState(initial?.hideStalled || false);
  const [trackInLifeGlance, setTrackInLifeGlance] = useState(false);
  const [createNote, setCreateNote] = useState(false);

  // "Completed" only available when all child projects are completed (or none exist)
  const activeChildProjects = childProjects.filter(p => p.status !== 'archived');
  const canComplete = activeChildProjects.length === 0 || activeChildProjects.every(p => p.status === 'completed');

  // A goal that already lives in lifeGLANCE (came from it, or was already shared)
  // shows a read-only indicator instead of the share checkbox. The checkbox is
  // offered for BOTH new goals and existing goals not yet shared.
  const alreadyShared = !!(initial && (initial.source_app === 'app.lifeglance' || initial.synced_to_lifeglance));

  const sortedAreas = [...areas].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const startAfterTarget = !!(startDate && targetDate && startDate > targetDate);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    // description is edited on the goal's detail once it exists; omitting it
    // here preserves the existing value on save (updateGoal merges).
    // A [[wikilink]] typed into the title names the goal's note (owner,
    // 2026-10-03): the link leaves the title and rides the save as the
    // path to link. Linking an existing note never creates one.
    const fromTitle = noteLinkFromTitle(title);
    const savedTitle = fromTitle ? fromTitle.title : title.trim();
    const linkNotePath = fromTitle?.path;
    onSave({ title: savedTitle, ...(initial ? {} : { description: description.trim() }), areaId: areaId || undefined, startDate: startDate || undefined, targetDate: targetDate || undefined, color, status, assignedUserSyncIds, hideStalled, trackInLifeGlance: showLifeGlanceCheckbox && !alreadyShared && trackInLifeGlance, createNote: !initial && createNote && !linkNotePath, linkNotePath });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`${mobile ? '' : `${cardBg} rounded-2xl shadow-2xl max-w-sm`} p-5 w-full flex flex-col gap-4`}
      onClick={e => e.stopPropagation()}
    >
      <h3 className={`text-base font-semibold ${textPrimary}`}>
        {initial ? t('goals.editGoal') : t('goals.newGoal')}
      </h3>

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.titleRequired')}</label>
        <input
          autoFocus={!initial && !isMobile}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('goals.goalTitlePlaceholder')}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
        />
      </div>

      {/* Description: new goals only (see the description state above). */}
      {!initial && (
        <div className="flex flex-col gap-1">
          <label className={`text-xs font-medium ${textSecondary}`}>{t('common.description')}</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            ref={autoSizeTextarea}
            onInput={e => autoSizeTextarea(e.currentTarget)}
            placeholder={t('goals.optionalDescription')}
            rows={2}
            className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-[60vh] ${isMobile ? 'resize-none' : 'resize-y'} ${
              darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
            }`}
          />
        </div>
      )}

      {/* Area */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('goals.area')}</label>
        <select
          value={areaId}
          onChange={e => {
            const nextAreaId = e.target.value;
            setAreaId(nextAreaId);
            if (!colorTouched) {
              const area = nextAreaId ? areas.find(a => a.id === nextAreaId) : null;
              setColor(area?.color || TASK_COLORS[0].class);
            }
          }}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
          }`}
        >
          <option value="">{t('goals.noDefinedArea')}</option>
          {sortedAreas.map(a => (
            <option key={a.id} value={a.id}>{a.name || t('goals.untitledArea')}</option>
          ))}
        </select>
      </div>

      {/* Start / Target dates — one row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1 min-w-0">
          <label className={`text-xs font-medium ${textSecondary}`}>{t('goals.startDate')}</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className={`w-full min-w-0 px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
            }`}
          />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <label className={`text-xs font-medium ${textSecondary}`}>{t('common.targetDate')}</label>
          <input
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            className={`w-full min-w-0 px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
            }`}
          />
        </div>
        {startAfterTarget && (
          <p className="text-xs text-amber-500 col-span-2">{t('goals.startAfterTarget')}</p>
        )}
      </div>

      {/* Color */}
      <div className="flex flex-col gap-1.5">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.color')}</label>
        <div className="grid grid-cols-9 gap-2 w-full">
          {TASK_COLORS.map(c => (
            <button
              key={c.class}
              type="button"
              onClick={() => { setColor(c.class); setColorTouched(true); }}
              className={`w-7 h-7 rounded-full ${c.class} transition-transform ${
                color === c.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-110'
              }`}
              aria-label={t(`colors.${c.name.toLowerCase()}`)}
            />
          ))}
        </div>
      </div>

      {/* Preview */}
      <div
        className="h-1.5 rounded-full w-full"
        style={{ background: toHex(color) }}
      />

      {/* Assigned users — multi-user only */}
      <UserAssignmentPicker
        enabled={multiUserEnabled}
        users={users}
        value={assignedUserSyncIds}
        onChange={setAssignedUserSyncIds}
        darkMode={darkMode}
        borderClass={borderClass}
        textSecondary={textSecondary}
      />

      {/* Status — edit only */}
      {initial && (
        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-medium ${textSecondary}`}>{t('common.status')}</label>
          <div className={`flex rounded-lg border ${borderClass} overflow-hidden`}>
            {[
              { value: 'active', label: t('common.active') },
              { value: 'completed', label: t('common.completed'), disabled: !canComplete },
              { value: 'archived', label: t('common.archived') },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => !opt.disabled && setStatus(opt.value)}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-r last:border-r-0 ${borderClass} ${
                  status === opt.value
                    ? 'bg-blue-600 text-white'
                    : opt.disabled
                    ? `${textSecondary} opacity-30 cursor-not-allowed`
                    : `${textSecondary} ${hoverBg}`
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {!canComplete && (
            <p className={`text-xs ${textSecondary} opacity-60`}>
              {t('goals.completeProjectsFirst')}
            </p>
          )}
        </div>
      )}

      {/* Hide Stalled flags — per-goal opt-out for slow-burn goals. Suppresses
          the Stalled badge on this goal's projects and the goal's stalled-based
          caution indicator (overdue caution is unaffected). */}
      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideStalled}
            onChange={e => setHideStalled(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-500"
          />
          <span className={`text-sm ${textSecondary}`}>{t('goals.hideStalledLabel', 'Hide Stalled flags for this goal')}</span>
        </label>
        <p className={`text-xs ${textSecondary} opacity-60 ml-6`}>
          {t('goals.hideStalledHint', 'Hides the Stalled badge on this goal and all of its child projects.')}
        </p>
      </div>

      {/* Track in lifeGLANCE — checkbox when not yet shared (new OR existing goal),
          read-only indicator once it already lives in lifeGLANCE. */}
      {showLifeGlanceCheckbox && !alreadyShared && (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={trackInLifeGlance}
            onChange={e => setTrackInLifeGlance(e.target.checked)}
            className="w-4 h-4 rounded accent-blue-500"
          />
          <span className={`text-sm ${textSecondary}`}>{t('goals.trackInLifeGlance')}</span>
        </label>
      )}
      {alreadyShared && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Link2 size={14} className="text-blue-400 flex-shrink-0" />
          <span className="text-sm text-blue-400">
            {initial.source_app === 'app.lifeglance' ? t('goals.fromLifeGlance') : t('goals.trackedInLifeGlance')}
          </span>
        </div>
      )}

      {/* Obsidian note (companion §4.3, ruling E): goals ride the same link machinery */}
      {initial ? <NoteLinkRow kind="goal" id={initial.id} /> : <CreateNoteCheckbox checked={createNote} onChange={setCreateNote} />}

      {/* Actions */}
      <div className="flex gap-2 items-center">
        {initial && onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              darkMode
                ? 'text-red-400 hover:bg-red-900/20'
                : 'text-red-500 hover:bg-red-50'
            }`}
          >
            {t('goals.deleteGoal')}
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            className={`px-3 py-1.5 text-sm rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {initial ? t('common.save') : t('goals.createGoal')}
          </button>
        </div>
      </div>
    </form>
  );
};

// ─── hyperGLANCE icon lookup map ──────────────────────────────────────────────

// ─── Project form (create / edit) ─────────────────────────────────────────────

/**
 * NoteLinkRow — a project's or goal's Obsidian note (companion spec §4.3).
 * Links an EXISTING vault note by path (the plugin writes the id key), opens
 * it, unlinks it, and shows the missing state with a relink (ruling F). Reads
 * the live entity so the row reflects the link as soon as it lands.
 *
 * An unlinked entity can also have its note CREATED from here (owner,
 * 2026-10-19): the same intent the new-entity checkbox sends, with the fields
 * read from the record, so the plugin's layout and template apply and the
 * link lands through the observation stream like any other. Plugin only, as
 * the checkbox is; without a stream the button is disabled and says why.
 */
const NoteLinkRow = ({ kind = 'project', id }) => {
  const { darkMode, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  const { projects, goals } = useFeaturesCtx();
  const { obsidianConfig, linkProjectNote, unlinkProjectNote, openInObsidian, createProjectNote, bridgeHeartbeatRef } = useSyncCtx();
  const project = ((kind === 'goal' ? goals : projects) || []).find(e => e.id === id);
  const link = noteLinkOf(project);
  const [path, setPath] = useState(link?.name || '');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const pluginInUse = isStreamPosture(bridgeHeartbeatRef?.current);
  const canCreate = !link && !!createProjectNote;
  const create = () => {
    setError('');
    if (createProjectNote?.(kind, project.id, noteCreateFields(kind, project))) setCreating(true);
    else setError('Could not ask the bridge plugin to create the note. Check that the vault is paired and the plugin is running.');
  };
  if (!project || (!obsidianConfig?.enabled && !link)) return null;
  const inputCls = `px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
    darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
  }`;
  const btnCls = `px-2.5 py-1.5 text-xs rounded-lg border ${borderClass} ${textPrimary} hover:bg-blue-500/10`;
  const submit = () => {
    setError('');
    if (!linkProjectNote?.(kind, project.id, path)) {
      setError('Could not link. Enter the vault path of an existing note, with the Obsidian vault enabled in Settings.');
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label className={`text-xs font-medium ${textSecondary}`}>Obsidian note</label>
      {link && !link.missing ? (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className={`${textPrimary} truncate flex-1 min-w-0`} title={link.path}>{link.name}</span>
            <button type="button" className={btnCls} onClick={() => openInObsidian?.(link.name)}>Open</button>
            <button type="button" className={btnCls} onClick={() => unlinkProjectNote?.(kind, project.id)}>Unlink</button>
          </div>
          {link.pending && (
            <div data-note-link-pending className={`text-[11px] ${textSecondary}`}>
              Linked here. The dayGLANCE bridge plugin writes the link into the note once it is paired; until then, renaming the note in Obsidian breaks it.
            </div>
          )}
        </>
      ) : (
        <>
          {link?.missing && (
            <div className="text-xs text-amber-600 dark:text-amber-400">
              The linked note is missing from the vault ({link.name}). Relink it, or unlink it.
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={path}
              onChange={e => setPath(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
              placeholder="Projects/House"
              className={`${inputCls} flex-1 min-w-0`}
            />
            <button type="button" className={btnCls} onClick={submit}>{link?.missing ? 'Relink' : 'Link'}</button>
            {link?.missing && (
              <button type="button" className={btnCls} onClick={() => unlinkProjectNote?.(kind, project.id)}>Unlink</button>
            )}
            {canCreate && !creating && (
              <button
                type="button"
                className={`${btnCls} ${pluginInUse ? '' : 'opacity-60 cursor-not-allowed'}`}
                disabled={!pluginInUse}
                onClick={create}
                data-create-note-existing={pluginInUse ? 'available' : 'needs-plugin'}
                title={pluginInUse ? "Create the note where the bridge plugin's layout puts it" : 'Needs the dayGLANCE bridge plugin paired with this vault'}
              >
                Create in Obsidian
              </button>
            )}
          </div>
          {creating ? (
            <div data-create-note-existing="queued" className={`text-[11px] ${textSecondary}`}>
              Creating the note in Obsidian. The link appears here once the bridge plugin has applied it; any notes in the box above move into the note.
            </div>
          ) : (
            <div className={`text-[11px] ${textSecondary}`}>
              Vault path of an existing note, or type its [[wikilink]] into the title above. With the dayGLANCE bridge plugin paired, the link is written into the note{canCreate ? ', and Create in Obsidian makes a new note where the plugin\'s layout puts it' : ''}.
            </div>
          )}
          {error && <div className="text-xs text-red-500">{error}</div>}
        </>
      )}
    </div>
  );
};

/**
 * "Create a note in Obsidian" for a NEW project or goal (rulings D and E);
 * shown only with the vault enabled. The creation is the plugin's (the
 * intent needs a stream), so without one the box is disabled and says why
 * rather than accepting a tick that would do nothing (owner, 2026-10-04).
 */
const CreateNoteCheckbox = ({ checked, onChange }) => {
  const { textSecondary } = useDayPlannerCtx();
  const { obsidianConfig, createProjectNote, bridgeHeartbeatRef } = useSyncCtx();
  if (!obsidianConfig?.enabled || !createProjectNote) return null;
  const pluginInUse = isStreamPosture(bridgeHeartbeatRef?.current);
  return (
    <div className="flex flex-col gap-0.5">
      <label className={`flex items-center gap-2 text-xs ${textSecondary} ${pluginInUse ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'} select-none`} data-create-note={pluginInUse ? 'available' : 'needs-plugin'}>
        <input type="checkbox" checked={pluginInUse && !!checked} disabled={!pluginInUse} onChange={e => onChange(e.target.checked)} className="rounded" />
        Create a note in Obsidian (where the bridge plugin's layout puts it)
      </label>
      {!pluginInUse && (
        <span className={`text-[11px] ${textSecondary}`}>
          Needs the dayGLANCE bridge plugin paired with this vault. Without it, create the note in Obsidian and link it by typing its [[wikilink]] into the title.
        </span>
      )}
    </div>
  );
};

export const ProjectForm = ({ initial, goals, defaultGoalId, onSave, onCancel, mobile }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg, tasks, unscheduledTasks, use24HourClock, isMobile, isTablet } =
    useDayPlannerCtx();
  const { multiUserEnabled, users } = useFeaturesCtx();
  const { t } = useTranslation();

  const [title, setTitle] = useState(initial?.title || '');
  const [goalId, setGoalId] = useState(initial?.goalId || defaultGoalId || '');
  const [status, setStatus] = useState(initial?.status || 'active');
  // The project's own target date (local calendar date, absent = none). This
  // is not a task field: project tasks keep their own deadlines. The name and
  // wording follow goals, whose date is a targetDate.
  const [targetDate, setTargetDate] = useState(initial?.targetDate || '');
  // Copy-at-creation inheritance: a new project defaults its color and assigned
  // users from the selected goal (standalone default: blue / nobody) and keeps
  // following the goal picker until the user explicitly overrides. Editing an
  // existing project never auto-changes either field.
  const initialGoal = (initial?.goalId || defaultGoalId)
    ? goals.find(g => g.id === (initial?.goalId || defaultGoalId))
    : null;
  const [color, setColor] = useState(initial?.color || initialGoal?.color || PROJECT_FALLBACK_COLOR);
  const [colorTouched, setColorTouched] = useState(!!initial);
  const [assignedUserSyncIds, setAssignedUserSyncIds] = useState(
    initial?.assignedUserSyncIds || (initial ? [] : initialGoal?.assignedUserSyncIds || [])
  );
  const [usersTouched, setUsersTouched] = useState(!!initial);
  const [createNote, setCreateNote] = useState(false);

  // "Completed" only available when all project tasks are completed (or none exist)
  const projectTasks = initial
    ? [...tasks, ...unscheduledTasks].filter(t => t.projectId === initial.id && !t.archived)
    : [];
  const canComplete = projectTasks.length === 0 || projectTasks.every(t => t.completed);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    // description and hyperglance are managed in the Project Planner now;
    // omitting them here preserves existing values on save (updateProject merges).
    // A [[wikilink]] typed into the title names the project's note (owner,
    // 2026-10-03): the link leaves the title and rides the save as the
    // path to link. Linking an existing note never creates one.
    const fromTitle = noteLinkFromTitle(title);
    onSave({
      title: fromTitle ? fromTitle.title : title.trim(), goalId: goalId || undefined, status, color, assignedUserSyncIds,
      targetDate: targetDate || undefined,
      createNote: !initial && createNote && !fromTitle, linkNotePath: fromTitle?.path,
    });
  };

  const activeGoals = goals.filter(g => g.status !== 'archived');

  return (
    <form
      onSubmit={handleSubmit}
      className={`${mobile ? '' : `${cardBg} rounded-2xl shadow-2xl max-w-md`} p-5 w-full flex flex-col gap-4`}
      onClick={e => e.stopPropagation()}
    >
      <h3 className={`text-base font-semibold ${textPrimary}`}>
        {initial ? t('goals.editProject') : t('goals.newProject')}
      </h3>

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.titleRequired')}</label>
        <input
          autoFocus={!initial && !isMobile}
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t('goals.projectTitlePlaceholder')}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
        />
      </div>

      {/* Goal */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('goals.goalOptional')}</label>
        <select
          value={goalId}
          onChange={e => {
            const nextGoalId = e.target.value;
            setGoalId(nextGoalId);
            const goal = nextGoalId ? goals.find(g => g.id === nextGoalId) : null;
            if (!colorTouched) setColor(goal?.color || PROJECT_FALLBACK_COLOR);
            if (!usersTouched) setAssignedUserSyncIds(goal?.assignedUserSyncIds || []);
          }}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
          }`}
        >
          <option value="">{t('goals.noGoalStandalone')}</option>
          {activeGoals.map(g => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
      </div>

      {/* Target date — the project's own due date, independent of its tasks' */}
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`} htmlFor="project-target-date">{t('common.targetDate')}</label>
        <div className="flex items-center gap-2">
          <input
            id="project-target-date"
            data-project-target-date
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            className={`flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
            }`}
          />
          {targetDate && (
            <button
              type="button"
              onClick={() => setTargetDate('')}
              className={`px-2.5 py-1.5 text-xs rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
            >
              {t('common.clear')}
            </button>
          )}
        </div>
      </div>

      {/* Obsidian note (companion §4.3): link an existing note, or create one with the project */}
      {initial ? <NoteLinkRow kind="project" id={initial.id} /> : <CreateNoteCheckbox checked={createNote} onChange={setCreateNote} />}

      {/* Color — defaults to the goal's color (blue when standalone) until overridden */}
      <div className="flex flex-col gap-1.5">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.color')}</label>
        <div className="grid grid-cols-9 gap-2 w-full">
          {TASK_COLORS.map(c => (
            <button
              key={c.class}
              type="button"
              onClick={() => { setColor(c.class); setColorTouched(true); }}
              className={`w-7 h-7 rounded-full ${c.class} transition-transform ${
                color === c.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-110'
              }`}
              aria-label={t(`colors.${c.name.toLowerCase()}`)}
            />
          ))}
        </div>
      </div>

      {/* Assigned users — multi-user only */}
      <UserAssignmentPicker
        enabled={multiUserEnabled}
        users={users}
        value={assignedUserSyncIds}
        onChange={ids => { setAssignedUserSyncIds(ids); setUsersTouched(true); }}
        darkMode={darkMode}
        borderClass={borderClass}
        textSecondary={textSecondary}
      />

      {/* Status — edit only */}
      {initial && (
        <div className="flex flex-col gap-1.5">
          <label className={`text-xs font-medium ${textSecondary}`}>{t('common.status')}</label>
          <div className={`flex rounded-lg border ${borderClass} overflow-hidden`}>
            {[
              { value: 'active', label: t('common.active') },
              { value: 'completed', label: t('common.completed'), disabled: !canComplete },
              { value: 'archived', label: t('common.archived') },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => !opt.disabled && setStatus(opt.value)}
                className={`flex-1 py-2 text-sm font-medium transition-colors border-r last:border-r-0 ${borderClass} ${
                  status === opt.value
                    ? 'bg-blue-600 text-white'
                    : opt.disabled
                    ? `${textSecondary} opacity-30 cursor-not-allowed`
                    : `${textSecondary} ${hoverBg}`
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {!canComplete && (
            <p className={`text-xs ${textSecondary} opacity-60`}>
              {t('goals.completeTasksFirst')}
            </p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className={`px-3 py-1.5 text-sm rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
        >
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={!title.trim()}
          className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {initial ? t('common.save') : t('goals.createProject')}
        </button>
      </div>
    </form>
  );
};

// ─── Overlay backdrop for inline forms ────────────────────────────────────────

// The phone form sheet sits on the soft keyboard rather than under it.
const FORM_SHEET = keyboardSheet('85vh');
export const FormOverlay = ({ children, onClose, mobile, cardBg }) => {
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [onClose]);

  if (mobile) {
    return (
      <div
        className="fixed inset-0 z-[60] flex flex-col justify-end"
        style={FORM_SHEET.overlay}
        onClick={onClose}
      >
        <div className="bg-black/50 absolute inset-0" />
        <div
          className={`relative ${cardBg} rounded-t-2xl shadow-xl overflow-y-auto`}
          style={{ ...FORM_SHEET.sheet, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          onClick={e => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-black/50"
      onClick={onClose}
    >
      <div className="min-h-full flex items-center justify-center py-8">
        {children}
      </div>
    </div>
  );
};

// ─── Goal sidebar row (Goals & Projects space) ───────────────────────────────
// One goal in the space's sidebar list: a bar in the goal colour, the title,
// the area and days left, and a thin progress bar with the percentage. The
// selected row is highlighted. Every row is also a drop target for reassigning
// a project dragged from the main area (this replaced dropping on the old
// carousel's mini cards): data-move-goal carries the same semantics the touch
// path resolves via elementFromPoint (useProjectDrag).

const GoalSidebarRow = ({ goal, selected, onSelect, dropActive, onDragOver, onDragLeave, onDrop }) => {
  const { darkMode, textPrimary, textSecondary, hoverBg, tasks, unscheduledTasks, recurringTasks, currentTimeMinutes } = useDayPlannerCtx();
  const { projects, areas = [], isVisibleForUser } = useFeaturesCtx();
  const { t } = useTranslation();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const hex = toHex(goal.color || 'bg-blue-500');
  const isCompleted = goal.status === 'completed';
  const area = goal.areaId ? areas.find(a => a.id === goal.areaId) : null;

  let daysLabel = null;
  let labelColor = textSecondary;
  let isOverdue = false;
  if (goal.targetDate) {
    const diff = Math.ceil(
      (new Date(goal.targetDate + 'T00:00:00') - today) / 86400000
    );
    daysLabel = diff === 0
      ? t('goals.dueToday')
      : diff < 0
        ? t('goals.daysOverdue', { count: Math.abs(diff) })
        : t('goals.daysLeft', { count: diff });
    if (diff <= 7) labelColor = 'text-amber-500';
    if (diff < 0) isOverdue = true;
  }

  const allTasks = useMemo(() => [...tasks, ...unscheduledTasks].filter(isVisibleForUser), [tasks, unscheduledTasks, isVisibleForUser]);
  const childProjects = useMemo(() => projects.filter(p => p.goalId === goal.id && p.status !== 'archived'), [projects, goal.id]);
  const hasStalledProject = useMemo(
    () => hasStalledChild(goal, childProjects, allTasks, recurringTasks, currentTimeMinutes),
    [goal, childProjects, allTasks, recurringTasks, currentTimeMinutes]
  );
  const showCaution = !isCompleted && (isOverdue || hasStalledProject);
  const goalProgress = useMemo(() => calculateGoalProgress(goal.id, childProjects, allTasks), [goal.id, childProjects, allTasks]);
  const pct = Math.round(goalProgress * 100);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-goal-row={goal.id}
      data-move-goal={goal.id}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`w-full flex items-stretch gap-2.5 p-2.5 rounded-lg border text-left transition-colors select-none ${
        selected
          ? (darkMode ? 'bg-blue-900/30 border-blue-700/60' : 'bg-blue-50 border-blue-200')
          : `border-transparent ${hoverBg}`
      } ${dropActive ? 'ring-2 ring-blue-500' : ''}`}
      style={{ opacity: isCompleted ? 0.55 : 1 }}
    >
      <span className="w-[3px] rounded-sm flex-shrink-0 self-stretch" style={{ background: hex }} />
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`text-sm font-semibold ${textPrimary} leading-tight truncate flex-1 min-w-0`}>
            {goal.title}
          </span>
          {(goal.source_app === 'app.lifeglance' || goal.synced_to_lifeglance) && (
            <span title={t('goals.linkedWithLifeGlance')} className={`flex-shrink-0 ${textSecondary} opacity-60`}>
              <Link2 size={11} />
            </span>
          )}
          {showCaution && <AlertTriangle size={11} className="text-amber-500 flex-shrink-0" />}
        </span>
        <span className={`flex items-center gap-1.5 text-[11px] ${textSecondary} min-w-0`}>
          {area && (
            <>
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${area.color || 'bg-blue-500'}`} />
              <span className="truncate">{area.name || t('goals.untitledArea')}</span>
            </>
          )}
          {area && (daysLabel || isCompleted) && <span className="opacity-50">·</span>}
          {isCompleted
            ? <span className="text-emerald-500 whitespace-nowrap">{t('common.completed')}</span>
            : daysLabel && <span className={`whitespace-nowrap ${labelColor}`}>{daysLabel}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className={`flex-1 h-1 rounded-full overflow-hidden ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}>
            <span className="block h-full rounded-full transition-all" style={{ width: `${pct}%`, background: hex }} />
          </span>
          <span className={`text-[11px] ${pct >= 100 ? 'text-green-500' : textSecondary}`}>{pct}%</span>
        </span>
      </span>
    </button>
  );
};

// The space is wider than the old modal, so its cards are wider and fold their
// task list later. Cards ALWAYS span the available width: the column count is
// measured (as many SPACE_CARD_MIN columns as fit; 3 across at ~1000px, 4 at
// ~1400px) and the columns share the row equally. Only when there are fewer
// cards than columns is the row capped, at SPACE_CARD_MAX per card, so one or
// two cards do not stretch across the whole area.
//
// Measured in JS rather than `repeat(auto-fit, minmax(min, max))` because with
// a fixed max the browser counts columns by the MAX (CSS Grid §7.2.3.2), which
// gave two 420px columns and dead space at laptop widths.
//
// The card size (Settings, utils/cardSize.js) scales the whole grid with CSS
// zoom: the columns are counted from the real width at the scaled card and
// gap, and the grid inside the zoom is laid out exactly as at Normal.
const SPACE_CARD_MIN = 300;
const SPACE_CARD_MAX = 560;
const SPACE_CARD_GAP = 16;
const SPACE_VISIBLE_TASKS = 6;
const GOAL_CARD_WIDTH = 420;
const useSpaceCardScale = () => cardScale(useDayPlannerCtx().spaceCardSize);
const useGridColumns = (ref, scale = 1) => {
  const [cols, setCols] = useState(3);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const update = () => setCols(cardColumns(el.clientWidth, { min: SPACE_CARD_MIN, gap: SPACE_CARD_GAP, scale }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, scale]);
  return cols;
};
const cardGridStyle = (cols, count, justify = 'center') => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${Math.max(1, Math.min(cols, count))}, minmax(0, 1fr))`,
  gap: `${SPACE_CARD_GAP}px`,
  alignItems: 'start',
  maxWidth: count < cols ? `${count * SPACE_CARD_MAX + (count - 1) * SPACE_CARD_GAP}px` : undefined,
  marginLeft: justify === 'center' ? 'auto' : undefined,
  marginRight: justify === 'center' ? 'auto' : undefined,
});
// Column stacking: cards are dealt into the columns in order (first card to
// the first column, second to the second, … wrapping), and each column stacks
// its cards with no vertical gaps. Cards keep their natural height, a short
// card never leaves a hole under it, and the order is deterministic — it only
// changes with the column count, never with card heights (unlike masonry).
// Reading order still runs left-to-right along the top.
const dealIntoColumns = (items, cols) => {
  const n = Math.max(1, Math.min(cols, items.length));
  const columns = Array.from({ length: n }, () => []);
  items.forEach((item, i) => columns[i % n].push(item));
  return columns;
};
const CardColumns = ({ items, cols, justify, renderItem, scale = 1, className = '' }) => (
  <div style={scale === 1 ? undefined : { zoom: scale }} className={className} data-card-scale={scale}>
    <div style={cardGridStyle(cols, items.length, justify)} data-card-grid data-columns={Math.max(1, Math.min(cols, items.length))}>
      {dealIntoColumns(items, cols).map((column, c) => (
        <div key={c} className="flex flex-col min-w-0" style={{ gap: `${SPACE_CARD_GAP}px` }} data-card-column>
          {column.map(renderItem)}
        </div>
      ))}
    </div>
  </div>
);

// ─── Project card group (one goal's projects, or the standalone projects) ────
// Active cards first, completed ones compact below. Each slot is a within-group
// reorder target (drop before this card); the group itself appends. The grip
// on every card picks it up for both paths (useProjectDrag.dragHandleProps).

const ProjectCardGroup = ({ projects, goalId, drag, projectCardRefs, onEditProject, onMoveToClick, justify = 'center', focusedProjectId = null }) => {
  const { moveProject } = useFeaturesCtx();
  const { dragProjectId, dropInsertBeforeId, setDropInsertBeforeId, endDrag, dragHandleProps } = drag;
  const goalAttr = goalId ?? '';
  const activeProjs = projects.filter(p => p.status !== 'completed');
  const doneProjs = projects.filter(p => p.status === 'completed');
  const groupRef = useRef(null);
  const scale = useSpaceCardScale();
  const cols = useGridColumns(groupRef, scale);

  const wrapCard = (proj, compact) => (
    <div
      key={proj.id}
      data-proj-id={proj.id}
      data-move-goal={goalAttr}
      data-move-before={proj.id}
      className={`relative w-full transition-opacity ${dragProjectId === proj.id ? 'opacity-40' : ''} ${
        (dropInsertBeforeId === proj.id && dragProjectId && dragProjectId !== proj.id) || focusedProjectId === proj.id
          ? 'ring-2 ring-blue-500 rounded-xl' : ''
      }`}
      onDragOver={e => {
        e.preventDefault();
        e.stopPropagation();
        if (dragProjectId && dragProjectId !== proj.id) setDropInsertBeforeId(proj.id);
      }}
      onDrop={e => {
        e.preventDefault();
        if (!dragProjectId) return;
        moveProject(dragProjectId, goalId, proj.id);
        endDrag();
      }}
    >
      {dragProjectId && dragProjectId !== proj.id && (
        <div className="absolute inset-0 z-10 rounded-xl" />
      )}
      <ProjectCard
        ref={el => { projectCardRefs.current[proj.id] = el; }}
        project={proj}
        onEditClick={() => onEditProject?.(proj)}
        onMoveToClick={onMoveToClick}
        compact={compact}
        dragHandleProps={dragHandleProps(proj.id)}
        wide
        visibleCount={SPACE_VISIBLE_TASKS}
      />
    </div>
  );

  return (
    <div
      ref={groupRef}
      className="relative z-10"
      data-move-goal={goalAttr}
      onDragOver={e => { e.preventDefault(); }}
      onDrop={e => {
        e.preventDefault();
        if (!dragProjectId || dropInsertBeforeId) return; // card-level handled it
        moveProject(dragProjectId, goalId);
        endDrag();
      }}
    >
      {activeProjs.length > 0 && (
        <CardColumns items={activeProjs} cols={cols} justify={justify} scale={scale} className="mb-3" renderItem={proj => wrapCard(proj, false)} />
      )}
      {doneProjs.length > 0 && (
        <CardColumns items={doneProjs} cols={cols} justify={justify} scale={scale} renderItem={proj => wrapCard(proj, true)} />
      )}
    </div>
  );
};

// ─── Goal list view (Goals & Projects space, List mode) ──────────────────────
// The selected goal's card, centred, then dashed connector lines down to its
// project cards in a row. The lines are measured from the card refs; the
// ResizeObserver on the container re-measures when cards grow (tasks expand)
// and the layout effect when the selected goal changes.

const GoalListView = ({ goal, goalProjects, drag, goalCardRefs, projectCardRefs, onEditGoal, onEditProject, onNewProject, onMoveToClick, focusedProjectId = null }) => {
  const { textSecondary, borderClass } = useDayPlannerCtx();
  const scale = useSpaceCardScale();
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const [svgLines, setSvgLines] = useState([]);
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 });

  const recalc = useCallback(() => {
    if (!containerRef.current) return;
    const base = containerRef.current.getBoundingClientRect();
    const lines = [];
    const goalEl = goalCardRefs.current[goal.id];
    if (goalEl) {
      const gr = goalEl.getBoundingClientRect();
      const gx = gr.left - base.left + gr.width / 2;
      const gy = gr.top - base.top + gr.height;
      const goalHex = toHex(goal.color || 'bg-blue-500');
      for (const proj of goalProjects) {
        const projEl = projectCardRefs.current[proj.id];
        if (!projEl) continue;
        const pr = projEl.getBoundingClientRect();
        const px = pr.left - base.left + pr.width / 2;
        const py = pr.top - base.top;
        const midY = gy + (py - gy) * 0.5;
        lines.push({
          d: `M ${gx} ${gy} C ${gx} ${midY} ${px} ${midY} ${px} ${py}`,
          color: goalHex,
        });
      }
    }
    setSvgLines(lines);
    setSvgSize({ w: base.width, h: base.height });
  }, [goal, goalProjects, goalCardRefs, projectCardRefs]);

  useIsoLayoutEffect(() => {
    recalc();
  }, [recalc]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [recalc]);

  return (
    <div ref={containerRef} className="relative min-h-[200px]" data-goal-list-view={goal.id}>
      {/* SVG overlay — behind cards (z-0), non-interactive */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: svgSize.w,
          height: svgSize.h,
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'visible',
        }}
      >
        {svgLines.map((line, i) => (
          <path
            key={i}
            d={line.d}
            stroke={line.color}
            strokeWidth={2}
            strokeOpacity={0.55}
            fill="none"
            strokeDasharray="6 4"
          />
        ))}
      </svg>

      {/* Selected goal card, centred */}
      <div className="relative z-10 max-w-full mx-auto mb-10" style={{ width: `${Math.round(GOAL_CARD_WIDTH * scale)}px` }}>
        <div style={scale === 1 ? undefined : { zoom: scale }}>
          <GoalCard
            ref={el => { goalCardRefs.current[goal.id] = el; }}
            goal={goal}
            projects={goalProjects}
            onEdit={() => onEditGoal(goal)}
            onNewProject={() => onNewProject(goal.id)}
            compactEmpty
          />
        </div>
      </div>

      {goalProjects.length > 0 ? (
        <ProjectCardGroup
          projects={goalProjects}
          goalId={goal.id}
          drag={drag}
          projectCardRefs={projectCardRefs}
          onEditProject={onEditProject}
          onMoveToClick={onMoveToClick}
          focusedProjectId={focusedProjectId}
        />
      ) : (
        <div className={`relative z-10 w-[420px] max-w-full mx-auto rounded-xl border border-dashed ${borderClass} px-6 py-8 flex flex-col items-center gap-2`}>
          <FolderOpen size={20} className={`${textSecondary} opacity-60`} />
          <p className={`text-sm ${textSecondary}`}>{t('goals.noProjectsLinked')}</p>
          <button
            type="button"
            onClick={() => onNewProject(goal.id)}
            className="flex items-center gap-1 text-sm text-emerald-500 hover:text-emerald-600 transition-colors"
          >
            <Plus size={13} /> {t('common.addProject')}
          </button>
        </div>
      )}
    </div>
  );
};

// ─── "Move to…" list ─────────────────────────────────────────────────────────
// The goals a project can be reassigned to, plus Standalone; the current home
// is shown but disabled. Shared by the phone's bottom sheet and the desktop
// space's overlay (the ProjectCard "Move to…" button feeds both).

const MoveToList = ({ project, goals, onMove }) => {
  const { textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      {goals.map(g => {
        const hex = toHex(g.color || 'bg-blue-500');
        const isCurrent = project.goalId === g.id;
        return (
          <button
            key={g.id}
            type="button"
            disabled={isCurrent}
            onClick={() => onMove(g.id)}
            className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
              isCurrent ? 'opacity-40 cursor-default' : hoverBg
            }`}
          >
            <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: hex }} />
            <span className={`text-sm ${textPrimary}`}>{g.title}</span>
            {isCurrent && <span className={`ml-auto text-xs ${textSecondary}`}>{t('goals.current')}</span>}
          </button>
        );
      })}
      <button
        type="button"
        disabled={!project.goalId}
        onClick={() => onMove(null)}
        className={`flex items-center gap-2.5 w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
          !project.goalId ? 'opacity-40 cursor-default' : hoverBg
        }`}
      >
        <Layers size={12} className={`flex-shrink-0 ${textSecondary}`} />
        <span className={`text-sm ${textPrimary}`}>{t('goals.standalone')}</span>
        {!project.goalId && <span className={`ml-auto text-xs ${textSecondary}`}>{t('goals.current')}</span>}
      </button>
    </div>
  );
};

// ─── Goals & Projects space sidebar ──────────────────────────────────────────
// Same width and position as the calendar sidebar. Two tabs, styled like the
// GLANCE/inbox tabs: Goals (area filter + Manage Areas, the goal list, Add
// Goal) and Projects (STANDALONE projects only — goal-linked projects are
// reached through their goal — with Add Project). Only goals have areas and
// target dates, which is why the filter lives on the Goals tab alone.

// ─── Project sidebar row (Projects tab) ──────────────────────────────────────
// Deliberately not a copy of the goal row: a small progress RING in the
// project colour (done/total tasks), the title, then a meta line with the
// done/total count, a Stalled badge, and the next hyperGLANCE session. The
// focused row (click, or Up/Down) is highlighted and its card scrolled into
// view in the main area.

const ProjectSidebarRow = ({ project, focused, onSelect }) => {
  const { darkMode, textPrimary, textSecondary, hoverBg, tasks, unscheduledTasks, recurringTasks, currentTimeMinutes } = useDayPlannerCtx();
  const { goals, isVisibleForUser } = useFeaturesCtx();
  const { t } = useTranslation();
  const hex = toHex(getProjectColor(project, project.goalId ? goals.find(g => g.id === project.goalId) : null));
  const isCompleted = project.status === 'completed';
  const allTasks = useMemo(() => [...tasks, ...unscheduledTasks].filter(isVisibleForUser), [tasks, unscheduledTasks, isVisibleForUser]);
  const projectTasks = useMemo(() => allTasks.filter(tk => tk.projectId === project.id && !tk.archived), [allTasks, project.id]);
  const done = projectTasks.filter(tk => tk.completed).length;
  const total = projectTasks.length;
  const progress = calculateProjectProgress(project.id, allTasks);
  // The card's gate, so the row never flags what the card does not (standalone
  // projects are never flagged; see utils/stalledBadge.js).
  const stalled = isProjectFlaggedStalled(project, project.goalId ? goals.find(g => g.id === project.goalId) : null, allTasks, recurringTasks, currentTimeMinutes);
  const session = !isCompleted && project.hyperglance?.enabled ? getActiveHGInstance(project, currentTimeMinutes) : null;
  const noteLink = noteLinkOf(project);
  // 18px ring: r=7 → circumference ≈ 44
  const C = 2 * Math.PI * 7;
  const pct = isCompleted ? 1 : (progress ?? 0);

  return (
    <button
      type="button"
      data-project-row={project.id}
      aria-pressed={focused}
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-2 py-2.5 rounded-lg border text-left transition-colors ${
        focused
          ? (darkMode ? 'bg-blue-900/30 border-blue-700/60' : 'bg-blue-50 border-blue-200')
          : `border-transparent ${hoverBg}`
      }`}
      style={{ opacity: isCompleted ? 0.55 : 1 }}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" className="flex-shrink-0" aria-hidden="true">
        <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" stroke={hex} strokeOpacity="0.2" />
        {(pct > 0 || isCompleted) && (
          <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" stroke={hex} strokeLinecap="round"
            strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 9 9)" />
        )}
        {isCompleted && <path d="M5.5 9.2l2.3 2.3 4.7-4.8" fill="none" stroke={hex} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      </svg>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`flex-1 min-w-0 truncate text-sm font-medium ${textPrimary}`}>{project.title}</span>
          {noteLink && (
            <span className={`flex-shrink-0 ${noteLink.missing ? 'text-amber-500' : `${textSecondary} opacity-50`}`} title={noteLink.name}>
              {noteLink.missing ? <AlertTriangle size={11} /> : <BookOpen size={11} />}
            </span>
          )}
        </span>
        <span className={`flex items-center gap-2 text-[11px] ${textSecondary} min-w-0`}>
          <span className="whitespace-nowrap">{done}/{total}</span>
          {stalled && (
            <span className="flex items-center gap-0.5 text-amber-500 whitespace-nowrap">
              <AlertTriangle size={10} /> {t('goals.stalled')}
            </span>
          )}
          {session && (
            <span className={`flex items-center gap-0.5 whitespace-nowrap ${session.isOverdue ? 'text-orange-400' : ''}`} style={session.isOverdue ? {} : { color: project.hyperglance.color || '#4f46e5' }}>
              <Zap size={10} /> {session.isOverdue ? t('common.overdue') : session.date === dateToString(new Date()) ? t('common.today') : session.date.slice(5)}
            </span>
          )}
        </span>
      </span>
    </button>
  );
};

const GoalSpaceSidebar = ({
  tab, onTabChange,
  goals, goalCount, selectedGoalId, onSelectGoal,
  standaloneProjects, standaloneCount, focusedProjectId, onProjectRowClick,
  projectQuery, onProjectQueryChange, filterInputRef,
  drag, onManageAreas,
}) => {
  const { darkMode, cardBg, borderClass, textSecondary } = useDayPlannerCtx();
  const { moveProject } = useFeaturesCtx();
  const { t } = useTranslation();
  const { dragProjectId, dropZoneTarget, setDropZoneTarget, endDrag } = drag;

  const tabClass = (active) =>
    `flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold transition-colors border-b-2 ${
      active ? 'text-blue-500 border-blue-500' : `${textSecondary} border-transparent`
    }`;
  const countClass = `text-[11px] font-normal ${textSecondary}`;

  return (
    <div
      data-goals-sidebar
      className={`${cardBg} border-r ${borderClass} flex flex-col flex-shrink-0 relative`}
      style={{ width: '340px', height: '100%' }}
    >
      <div role="tablist" aria-label={t('goals.dashboardTitle')} className={`flex border-b ${borderClass} flex-shrink-0`}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'goals'}
          onClick={() => onTabChange('goals')}
          style={{ height: 'var(--header-row-h)' }}
          className={tabClass(tab === 'goals')}
        >
          <Flag size={16} /> {t('goals.goals')} <span className={countClass}>{goalCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'projects'}
          onClick={() => onTabChange('projects')}
          style={{ height: 'var(--header-row-h)' }}
          className={tabClass(tab === 'projects')}
        >
          <Layers size={16} /> {t('goals.projects')} <span className={countClass}>{standaloneCount}</span>
        </button>
      </div>

      {tab === 'goals' ? (
        <div className="px-3 pt-3 flex-shrink-0">
          <AreaFilter onManageAreas={onManageAreas} iconOnly />
        </div>
      ) : (
        /* Project filter: '/' focuses it; Escape clears it (GoalDashboard's
           Escape chain). */
        <div className="px-3 pt-3 flex-shrink-0">
          <ProjectFilterField value={projectQuery} onChange={onProjectQueryChange} inputRef={filterInputRef} keyHint />
        </div>
      )}

      <div className={`flex-1 overflow-y-auto px-2 py-2 ${darkMode ? 'dark-scrollbar' : ''}`}>
        {tab === 'goals' ? (
          goals.length === 0 ? (
            <p className={`text-xs ${textSecondary} opacity-60 text-center px-4 py-6`}>{t('goals.noGoalsYet')}</p>
          ) : (
            <div className="flex flex-col gap-1">
              {goals.map(g => (
                <GoalSidebarRow
                  key={g.id}
                  goal={g}
                  selected={g.id === selectedGoalId}
                  onSelect={() => onSelectGoal(g.id)}
                  dropActive={!!dragProjectId && dropZoneTarget === g.id}
                  onDragOver={e => { e.preventDefault(); setDropZoneTarget(g.id); }}
                  onDragLeave={() => setDropZoneTarget(undefined)}
                  onDrop={e => { e.preventDefault(); if (dragProjectId) moveProject(dragProjectId, g.id); endDrag(); }}
                />
              ))}
              {/* Standalone drop target — only while a card is being dragged */}
              {dragProjectId && (
                <div
                  data-move-goal=""
                  onDragOver={e => { e.preventDefault(); setDropZoneTarget(null); }}
                  onDragLeave={() => setDropZoneTarget(undefined)}
                  onDrop={e => { e.preventDefault(); moveProject(dragProjectId, null); endDrag(); }}
                  className={`mt-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border-2 border-dashed text-xs font-medium transition-colors ${
                    dropZoneTarget === null ? 'border-emerald-500 text-emerald-500' : `${borderClass} ${textSecondary}`
                  }`}
                >
                  <Layers size={12} /> {t('goals.dropToStandalone')}
                </div>
              )}
            </div>
          )
        ) : (
          standaloneProjects.length === 0 ? (
            <p className={`text-xs ${textSecondary} opacity-60 text-center px-4 py-6`}>{t(projectQuery ? 'goals.noProjectsMatch' : 'goals.noStandaloneProjects')}</p>
          ) : (
            <div className="flex flex-col">
              <p className={`px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider ${textSecondary}`}>
                {t('goals.standalone')}
              </p>
              {/* hairline between rows for definition; the focused row keeps its rounded highlight */}
              {standaloneProjects.map((p, i) => (
                <React.Fragment key={p.id}>
                  {i > 0 && <div data-row-divider className={`h-px mx-2 ${darkMode ? 'bg-gray-700/70' : 'bg-stone-200'}`} />}
                  <ProjectSidebarRow project={p} focused={p.id === focusedProjectId} onSelect={() => onProjectRowClick(p.id)} />
                </React.Fragment>
              ))}
            </div>
          )
        )}
      </div>

    </div>
  );
};

// ─── Mobile carousel layout (phone Goals tab) ─────────────────────────────────

// ─── Shared toolbar pieces (desktop toolbar/sidebar and the phone tab) ────────

// Open | Completed for the standalone projects, with counts: the desktop
// toolbar's control, and the phone's Projects tab's.
// `compact` drops the icons (the words and counts stay): the phone's Projects
// row, while the filter field shares it.
// The card size in the space's toolbar: the same device setting Settings
// offers (utils/cardSize.js), in reach where the cards are.
export const CardSizeToggle = () => {
  const { spaceCardSize, setSpaceCardSize, darkMode, borderClass, textSecondary } = useDayPlannerCtx();
  const { t } = useTranslation();
  if (typeof setSpaceCardSize !== 'function') return null;
  return (
    <label className={`shrink-0 flex items-center gap-1.5 text-xs ${textSecondary}`} title={t('cardSize.label')}>
      <LayoutGrid size={13} aria-hidden="true" />
      <select
        data-card-size-toggle
        aria-label={t('cardSize.label')}
        value={clampCardSize(spaceCardSize)}
        onChange={e => setSpaceCardSize(e.target.value)}
        className={`px-2 py-1 text-xs rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
      >
        {CARD_SIZES.map(({ id }) => <option key={id} value={id}>{t(`cardSize.${id}`)}</option>)}
      </select>
    </label>
  );
};

export const ProjectsStatusToggle = ({ value, onChange, openCount, completedCount, className = '', compact = false }) => {
  const { darkMode, textSecondary, borderClass } = useDayPlannerCtx();
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('goals.projects')} className={`shrink-0 flex rounded-lg border ${borderClass} overflow-hidden ${className}`}>
      {[
        { key: 'open', label: t('goals.openProjects'), count: openCount, Icon: CircleDashed },
        { key: 'completed', label: t('common.completed'), count: completedCount, Icon: CircleCheckBig },
      ].map(({ key, label, count, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={`flex items-center gap-1.5 ${compact ? 'px-2' : 'px-2.5'} py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              active
                ? 'bg-blue-600 text-white'
                : `${textSecondary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`
            }`}
          >
            {!compact && <Icon size={13} />} {label}
            {/* count badge: white on the blue (active) button, blue on the plain one */}
            <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center ${
              active ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'
            }`}>{count}</span>
          </button>
        );
      })}
    </div>
  );
};

// The project filter: the GLANCE panel's search field look. On desktop '/'
// focuses it and Escape clears it (GoalDashboard's Escape chain), and the
// field says so; the phone has no keys, so no hint.
//
// A text input, not type="search": the browser draws its own clear button in
// a search input, which sat next to this one's X as a second, brighter one.
// enterKeyHint keeps the phone keyboard's Search key.
//
// `dense`: the height of the Open | Completed toggle beside it (the phone's
// Projects row), so opening the filter does not make the row jump.
export const ProjectFilterField = ({ value, onChange, inputRef, keyHint = false, onBlur, dense = false }) => {
  const { darkMode, textSecondary } = useDayPlannerCtx();
  const { t } = useTranslation();
  return (
    <label className={`flex items-center gap-2 px-3 ${dense ? 'h-8' : 'py-2'} rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'}`}>
      <Search size={15} className="flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={t('goals.filterProjects')}
        aria-label={t('goals.filterProjects')}
        data-project-filter
        className={`flex-1 min-w-0 bg-transparent text-sm outline-none ${darkMode ? 'text-gray-100 placeholder-gray-500' : 'text-stone-900 placeholder-stone-400'}`}
      />
      {value ? (
        <button type="button" onClick={() => { onChange(''); inputRef?.current?.focus(); }} className="flex-shrink-0 p-0.5 rounded hover:opacity-70" aria-label={t('common.clear')}>
          <X size={13} />
        </button>
      ) : keyHint ? (
        <span className={`text-xs ${textSecondary}`}>/</span>
      ) : null}
    </label>
  );
};

// ─── Phone: Goals | Projects ──────────────────────────────────────────────────
// The desktop sidebar's tab row as a segmented control, with its counts: every
// active goal, and the OPEN standalone projects (the sidebar counts the same).
//
// The chevron beside it hides the controls under it (the area / view row and
// the goal chips, or Open | Completed and the filter) to give the cards the
// room. A dot on it says a hidden control is narrowing what is shown.
export const MobileGoalsTabs = ({ tab, onTabChange, goalCount, openCount, controlsCollapsed = false, onToggleControls, filtersActive = false }) => {
  const { darkMode, textSecondary, borderClass } = useDayPlannerCtx();
  const { t } = useTranslation();
  const tabClass = (active) =>
    `flex-1 flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-medium transition-colors ${
      active ? 'bg-blue-600 text-white' : `${textSecondary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`
    }`;
  const badgeClass = (active) =>
    `min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold flex items-center justify-center ${
      active ? 'bg-white text-blue-600' : 'bg-blue-600 text-white'
    }`;
  const toggleLabel = controlsCollapsed ? t('goals.showFilters') : t('goals.hideFilters');
  return (
    <div className="flex items-stretch gap-2">
      <div data-goals-tabs role="tablist" aria-label={t('goals.dashboardTitle')} className={`flex-1 min-w-0 flex rounded-lg border ${borderClass} overflow-hidden`}>
        <button type="button" role="tab" aria-selected={tab === 'goals'} onClick={() => onTabChange('goals')} className={tabClass(tab === 'goals')}>
          <Flag size={13} className="flex-shrink-0" /> <span className="truncate">{t('goals.goals')}</span> <span className={badgeClass(tab === 'goals')}>{goalCount}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'projects'} onClick={() => onTabChange('projects')} className={tabClass(tab === 'projects')}>
          <Layers size={13} className="flex-shrink-0" /> <span className="truncate">{t('goals.projects')}</span> <span className={badgeClass(tab === 'projects')}>{openCount}</span>
        </button>
      </div>
      {onToggleControls && (
        <button
          type="button"
          data-controls-toggle
          aria-expanded={!controlsCollapsed}
          aria-label={filtersActive && controlsCollapsed ? `${toggleLabel} · ${t('goals.filtersActive')}` : toggleLabel}
          title={toggleLabel}
          onClick={onToggleControls}
          className={`relative flex-shrink-0 w-9 flex items-center justify-center rounded-lg border ${borderClass} ${textSecondary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} transition-colors`}
        >
          <ChevronDown size={16} className={`transition-transform duration-200 ${controlsCollapsed ? '' : 'rotate-180'}`} />
          {filtersActive && controlsCollapsed && (
            <span data-filters-active className="absolute top-1 right-1 w-2 h-2 rounded-full bg-blue-500" />
          )}
        </button>
      )}
    </div>
  );
};

// ─── Phone: the Goals tab's body ─────────────────────────────────────────────
//
// The phone has no sidebar, so the desktop space's shape is folded into one
// column: under the Goals | Projects control (MobileGoalsTabs, the sidebar's
// tab row), on Goals a chip strip of the goals (the sidebar's list — each chip
// a colour swatch and the title, the selected one highlighted) over a swipeable
// carousel with one page per goal, and on Projects the Open | Completed toggle,
// the filter field and the standalone cards. The goal page draws the REAL
// GoalCard, full width, so the phone can never show a different goal than the
// desktop does (the stalled-badge mismatch came from a second copy).
//
// Creation lives in the FAB stack GoalDashboard floats over this (Add Goal /
// Add Project by tab, Aspire above when enabled), like the desktop space.

const MobileDashboard = ({
  tab,
  onTabChange,
  goals,            // the area-filtered goals, carousel order
  allGoals,         // every active goal, for a focus request the filter hides
  activeProjects,
  standaloneProjects,   // after Open | Completed and the filter field
  openCount,
  completedCount,
  projectsFilter,
  onProjectsFilterChange,
  projectQuery,
  onProjectQueryChange,
  onEditGoal,
  onEditProject,
  onNewProject,
  isActive = false,
  controlsCollapsed = false,
  onPageGoalChange,   // the carousel's goal, for the "+" (GoalsAddMenu)
}) => {
  const { darkMode, textPrimary, textSecondary, hoverBg, cardBg, borderClass } = useDayPlannerCtx();
  const {
    moveProject, goalsDashboardFocusId, setGoalsDashboardFocusId, setGoalsAreaFilter,
    goalsDashboardFocusProjectId, setGoalsDashboardFocusProjectId,
    goalsDashboardFocusTab, setGoalsDashboardFocusTab,
  } = useFeaturesCtx();
  const { t } = useTranslation();

  const scrollRef = useRef(null);
  const chipsRef = useRef(null);
  const projectsRef = useRef(null);
  // The project a link brought into view (the Project widget's tap): ringed
  // for a moment so the eye finds it on the page.
  const [flashProjectId, setFlashProjectId] = useState(null);
  const swipeRef = useRef(null); // { startX, startY, locked }
  const pageRef = useRef(0);    // mirror of `page` for use inside event handlers

  // ── Touch drag state (within-page reorder) ──────────────────────────────────
  const touchDragRef = useRef({ active: false, fromId: null, overId: null });
  const [touchDragId, setTouchDragId] = useState(null);
  const [touchOverId, setTouchOverId] = useState(null);

  // ── "Move to…" sheet state ──────────────────────────────────────────────────
  const [moveToProject, setMoveToProject] = useState(null);

  // ── Projects filter: a button until tapped, then a field (focused) ──────────
  const [filterOpen, setFilterOpen] = useState(false);
  const filterInputRef = useRef(null);
  useEffect(() => { if (filterOpen) filterInputRef.current?.focus(); }, [filterOpen]);

  // The selection is a goal id, like the desktop space's, not a page index:
  // the list arrives after the first render (the data loads) and changes
  // under the carousel (the area filter, an edit), and an index would then
  // point at a different goal. Until a swipe, a chip or a link picks one, it
  // is the default the sidebar uses: the first active goal.
  const [selectedId, setSelectedId] = useState(null);
  const page = useMemo(() => {
    const i = selectedId ? goals.findIndex(g => g.id === selectedId) : -1;
    return i >= 0 ? i : findDefaultActiveIdx(goals);
  }, [goals, selectedId]);
  const setPage = (i) => { const g = goals[i]; if (g) setSelectedId(g.id); };
  const totalPages = goals.length;
  const totalPagesRef = useRef(totalPages);
  useEffect(() => { totalPagesRef.current = totalPages; }, [totalPages]);
  useEffect(() => { pageRef.current = page; }, [page]);
  const pageGoalId = goals[page]?.id ?? null;
  useEffect(() => { onPageGoalChange?.(pageGoalId); }, [pageGoalId, onPageGoalChange]);

  // A swipe or a chip picks its goal the moment it is committed: the chip
  // lights up first and the pages then slide to it. While that slide runs,
  // the page under the fold is the OLD goal for the first half, so the scroll
  // must not steer the selection (onScroll) and the selection must not snap
  // the scroll (the sync below) until it arrives. The timer is the backstop
  // for a slide that is interrupted and never lands exactly.
  const slideTargetRef = useRef(null);
  const slideTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(slideTimerRef.current), []);
  const goToPage = (idx) => {
    const el = scrollRef.current;
    const goal = goals[idx];
    if (!el || !goal) return;
    setSelectedId(goal.id);
    slideTargetRef.current = idx;
    clearTimeout(slideTimerRef.current);
    slideTimerRef.current = setTimeout(() => { slideTargetRef.current = null; }, 900);
    el.scrollTo?.({ left: idx * el.clientWidth, behavior: 'smooth' });
  };
  const onCarouselScroll = (e) => {
    const el = e.target;
    if (!el.clientWidth) return;
    const target = slideTargetRef.current;
    if (target !== null) {
      if (Math.abs(el.scrollLeft - target * el.clientWidth) < 2) slideTargetRef.current = null;
      return;
    }
    const p = Math.round(el.scrollLeft / el.clientWidth);
    if (p !== page) setPage(p);
  };

  // The selected chip follows the page, AFTER the highlight has painted (an
  // effect, not a layout effect): the new chip lights up, then the strip
  // glides just far enough to show it. Instant when the strip comes into view
  // (the tab forward, the chevron reopened), where there is nothing to watch. The strip scrolls itself rather than
  // scrollIntoView, which would also scroll the page's other ancestors.
  const wasShownRef = useRef(false);
  useEffect(() => {
    const shown = isActive && !controlsCollapsed;
    const justShown = shown && !wasShownRef.current;
    wasShownRef.current = shown;
    const strip = chipsRef.current;
    if (!shown || !strip || !strip.clientWidth) return;
    const chip = strip.querySelector(`[data-goal-chip="${CSS.escape(goals[page]?.id ?? '')}"]`);
    if (!chip) return;
    const pad = 12;
    const left = chip.offsetLeft - pad;
    const right = chip.offsetLeft + chip.offsetWidth + pad - strip.clientWidth;
    const to = left < strip.scrollLeft ? left : right > strip.scrollLeft ? right : null;
    if (to === null) return;
    strip.scrollTo?.({ left: Math.max(0, to), behavior: justShown ? 'auto' : 'smooth' });
  }, [isActive, page, goals, controlsCollapsed]);

  // Goal focus request (a goal ring on the GLANCE tab, the Goal widget's
  // tap): its page. A goal the area filter hides widens the filter first and
  // waits for the list to include it; a goal that is gone drops the request.
  useEffect(() => {
    if (!goalsDashboardFocusId || !isActive) return;
    const idx = goals.findIndex(g => g.id === goalsDashboardFocusId);
    if (idx === -1) {
      if (allGoals.some(g => g.id === goalsDashboardFocusId)) { setGoalsAreaFilter('all'); return; }
      setGoalsDashboardFocusId(null);
      return;
    }
    onTabChange('goals');
    setSelectedId(goals[idx].id);
    setGoalsDashboardFocusId(null);
  }, [goalsDashboardFocusId, isActive, goals]); // eslint-disable-line react-hooks/exhaustive-deps

  // Panel request (utils/goalsLink.js, a link with tab= and no id): just the
  // tab. Declared before the focus effects below in the desktop space, and the
  // focus effects run after this one, so a request carrying both lands on the
  // focus's tab.
  useEffect(() => {
    if (!goalsDashboardFocusTab || !isActive) return;
    onTabChange(goalsDashboardFocusTab);
    setGoalsDashboardFocusTab(null);
  }, [goalsDashboardFocusTab, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Project focus request (utils/goalsLink.js): its goal's page, or the
  // Projects tab on the Open/Completed list it is on with no text filter,
  // then its card scrolled into view once the page or list has rendered. A
  // project with no card here is dropped (the tab still opens). The timers
  // live in a ref, not the effect's cleanup: clearing the request re-runs
  // this effect, and a cleanup would cancel them at once.
  const flashTimersRef = useRef([]);
  useEffect(() => () => flashTimersRef.current.forEach(clearTimeout), []);
  useEffect(() => {
    if (!goalsDashboardFocusProjectId || !isActive) return;
    const target = projectFocusTarget(goalsDashboardFocusProjectId, { projects: activeProjects, goals: allGoals });
    if (!target) { setGoalsDashboardFocusProjectId(null); return; }
    const { project, goalId } = target;
    if (goalId) {
      const idx = goals.findIndex(g => g.id === goalId);
      if (idx === -1) { setGoalsAreaFilter('all'); return; }
      onTabChange('goals');
      setSelectedId(goalId);
    } else {
      onTabChange('projects');
      onProjectsFilterChange(project.status === 'completed' ? 'completed' : 'open');
      onProjectQueryChange('');
    }
    setGoalsDashboardFocusProjectId(null);
    const id = project.id;
    setFlashProjectId(id);
    const scroll = setTimeout(() => {
      const root = goalId ? scrollRef.current : projectsRef.current;
      const card = root?.querySelector(`[data-mobile-proj-id="${CSS.escape(id)}"]`);
      card?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 350);
    const clear = setTimeout(() => setFlashProjectId(cur => (cur === id ? null : cur)), 2400);
    flashTimersRef.current.forEach(clearTimeout);
    flashTimersRef.current = [scroll, clear];
  }, [goalsDashboardFocusProjectId, isActive, goals]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the carousel on the selected page (instant, no animation) whenever
  // the two disagree: when it mounts (first load, back from the Projects tab,
  // back from Roadmap), when the Goals tab comes forward (the dashboard stays
  // mounted, display:none, behind the other tabs, where it measures 0 wide),
  // when the data or the filter moves the selected goal, and when a link
  // selects one. A swipe or a chip scrolls first and the selection follows
  // the scroll (onScroll), so they never fight.
  const carouselMounted = tab === 'goals' && goals.length > 0;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!isActive || !carouselMounted || !el || !el.clientWidth) return;
    if (slideTargetRef.current === page) return;   // a slide is on its way there
    if (Math.round(el.scrollLeft / el.clientWidth) === page) return;
    el.scrollLeft = page * el.clientWidth;
  }, [isActive, carouselMounted, page, goals]);

  // ── Touch drag handlers (within-page project reorder) ────────────────────────
  const handleGripTouchStart = useCallback((e, projId, goalId) => {
    e.preventDefault(); // block text selection on long-press
    touchDragRef.current = { active: true, fromId: projId, overId: null, goalId };
    setTouchDragId(projId);
  }, []);

  const handleGripTouchMove = useCallback((e) => {
    if (!touchDragRef.current.active) return;
    e.preventDefault();
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el?.closest('[data-mobile-proj-id]');
    if (card) {
      const overId = card.getAttribute('data-mobile-proj-id');
      if (overId && overId !== touchDragRef.current.fromId) {
        touchDragRef.current.overId = overId;
        setTouchOverId(overId);
      }
    }
  }, []);

  const handleGripTouchEnd = useCallback((e, goalId) => {
    if (!touchDragRef.current.active) return;
    const { fromId, overId } = touchDragRef.current;
    touchDragRef.current = { active: false, fromId: null, overId: null, goalId: null };
    setTouchDragId(null);
    setTouchOverId(null);
    if (fromId && overId && fromId !== overId) {
      moveProject(fromId, goalId ?? null, overId);
    }
  }, [moveProject]);

  // JS swipe handler attached with { passive: false } so we can call
  // preventDefault() on horizontal gestures. This is necessary in Android
  // WebView where CSS touch-action on vertically-scrollable children does
  // not reliably propagate horizontal gestures to the scroll-snap container.
  //
  // Listeners are registered/unregistered based on isActive so they are only
  // attached when the carousel is actually visible. On real Android WebView,
  // registering a passive:false listener on a display:none element (at first
  // mount while another tab is shown) causes the WebView to not route touch
  // events to the element later when it becomes visible.
  const carouselShown = isActive && carouselMounted;
  useEffect(() => {
    if (!carouselShown) return;
    const el = scrollRef.current;
    if (!el) return;

    const onStart = (e) => {
      const t = e.touches[0];
      swipeRef.current = { startX: t.clientX, startY: t.clientY, locked: null };
    };

    const onMove = (e) => {
      const s = swipeRef.current;
      if (!s) return;
      const t = e.touches[0];
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;
      if (s.locked === null && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        s.locked = Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
      }
      if (s.locked === 'h') {
        e.preventDefault(); // block vertical / native WebView back-gesture
      }
    };

    const onEnd = (e) => {
      const s = swipeRef.current;
      swipeRef.current = null;
      if (!s || s.locked !== 'h') return;
      const dx = e.changedTouches[0].clientX - s.startX;
      if (Math.abs(dx) < 40) return; // too small — treat as tap
      if (dx < 0) goToPage(Math.min(totalPagesRef.current - 1, pageRef.current + 1));
      else         goToPage(Math.max(0, pageRef.current - 1));
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove',  onMove,  { passive: false });
    el.addEventListener('touchend',   onEnd,   { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove',  onMove);
      el.removeEventListener('touchend',   onEnd);
    };
  }, [carouselShown]); // eslint-disable-line react-hooks/exhaustive-deps

  // A project card on either tab: the same wrapper (reorder ring, link flash).
  const projectCard = (proj, goalId, compact = false) => (
    <div
      key={proj.id}
      data-mobile-proj-id={proj.id}
      className={`transition-opacity ${touchDragId === proj.id ? 'opacity-40' : ''} ${
        (touchOverId === proj.id && touchDragId && touchDragId !== proj.id) || flashProjectId === proj.id
          ? 'ring-2 ring-blue-500 rounded-xl' : ''
      }`}
    >
      <ProjectCard
        project={proj}
        onEditClick={() => onEditProject?.(proj)}
        onMoveToClick={() => setMoveToProject(proj)}
        compact={compact}
        dragHandleProps={{
          onTouchStart: (e) => handleGripTouchStart(e, proj.id, goalId),
          onTouchMove: handleGripTouchMove,
          onTouchEnd: (e) => handleGripTouchEnd(e, goalId),
        }}
      />
    </div>
  );

  const emptyState = (title, hint, cta) => (
    <div className="flex flex-col flex-1 items-center justify-center gap-3 px-6 py-10">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-700' : 'bg-stone-100'}`}>
        <GitBranch size={28} className={textSecondary} />
      </div>
      <p className={`text-sm font-medium ${textPrimary}`}>{title}</p>
      {hint && <p className={`text-xs ${textSecondary} text-center`}>{hint}</p>}
      {cta}
    </div>
  );

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {tab === 'goals' ? (
        goals.length === 0 ? (
          emptyState(t('goals.noGoalsYet'), t('goals.emptyHint'))
        ) : (
          <>
            {/* The goal chips: the sidebar's list, laid on its side. Hidden
                with the other controls (the chevron); swiping still works. */}
            {!controlsCollapsed && (
            <div
              ref={chipsRef}
              data-goal-chips
              className="relative flex gap-1.5 px-3 pb-3 overflow-x-auto flex-shrink-0"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              {goals.map((g, i) => {
                const active = i === page;
                const done = g.status === 'completed';
                return (
                  <button
                    key={g.id}
                    type="button"
                    data-goal-chip={g.id}
                    aria-pressed={active}
                    onClick={() => goToPage(i)}
                    className={`flex-shrink-0 flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full border text-xs font-medium transition-colors max-w-[11rem] ${
                      active
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : `${borderClass} ${textSecondary} ${hoverBg}`
                    }`}
                    style={{ opacity: done && !active ? 0.55 : 1 }}
                  >
                    <span className="w-1.5 h-3.5 rounded-sm flex-shrink-0" style={{ background: toHex(g.color || 'bg-blue-500') }} />
                    <span className="truncate">{g.title}</span>
                  </button>
                );
              })}
            </div>
            )}

            {/* Carousel: one page per goal */}
            <div
              ref={scrollRef}
              className="goal-carousel flex-1 min-h-0 flex overflow-x-auto overflow-y-hidden"
              style={{
                scrollSnapType: 'x mandatory',
                WebkitOverflowScrolling: 'touch',
                scrollbarWidth: 'none',
                msOverflowStyle: 'none',
              }}
              onScroll={onCarouselScroll}
            >
              {goals.map((goal) => {
                const children = sortByOrder(activeProjects.filter(p => p.goalId === goal.id));
                const activeProjs = children.filter(p => p.status !== 'completed');
                const doneProjs = children.filter(p => p.status === 'completed');
                return (
                  <div
                    key={goal.id}
                    data-goal-page={goal.id}
                    className="flex-shrink-0 w-full h-full overflow-y-auto overflow-x-hidden px-4 pb-24"
                    style={{ scrollSnapAlign: 'start' }}
                  >
                    {/* The goal's card: the desktop's, full width */}
                    <div className="mt-1 mb-4">
                      <GoalCard
                        goal={goal}
                        projects={children}
                        onEdit={() => onEditGoal(goal)}
                        onNewProject={() => onNewProject(goal.id)}
                        compactEmpty
                      />
                    </div>

                    {/* Child project cards */}
                    {children.length === 0 ? (
                      <div className="flex flex-col items-center gap-2 py-8">
                        <FolderOpen size={24} className={textSecondary} />
                        <p className={`text-sm ${textSecondary}`}>{t('goals.noProjectsYet')}</p>
                        <button
                          onClick={() => onNewProject(goal.id)}
                          className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-600"
                        >
                          <Layers size={14} /> {t('common.addProject')}
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {activeProjs.map(proj => projectCard(proj, goal.id))}
                        {doneProjs.map(proj => projectCard(proj, goal.id, true))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )
      ) : (
        <>
          {/* Projects tab: Open | Completed and the filter on ONE row. The
              filter is a field-shaped "Filter" button in the rest of the row
              until it is tapped (or holds text), then the field itself, the toggle dropping its
              icons to make room. Where a language's labels still leave it
              less than 7rem it wraps to its own line instead. */}
          {!controlsCollapsed && (
            <div data-projects-controls className="flex flex-wrap items-center gap-2 px-3 pb-3 flex-shrink-0">
              <ProjectsStatusToggle
                value={projectsFilter}
                onChange={onProjectsFilterChange}
                openCount={openCount}
                completedCount={completedCount}
                compact={filterOpen || !!projectQuery}
              />
              {filterOpen || projectQuery ? (
                <div className="flex-1 min-w-[7rem]">
                  <ProjectFilterField
                    value={projectQuery}
                    onChange={onProjectQueryChange}
                    inputRef={filterInputRef}
                    onBlur={() => { if (!projectQuery) setFilterOpen(false); }}
                    dense
                  />
                </div>
              ) : (
                // The field's own look and height, holding the rest of the row,
                // so it reads as the filter it opens into. Where a language's
                // toggle leaves little room the word truncates, down to the
                // icon alone; it never wraps.
                <button
                  type="button"
                  data-open-filter
                  onClick={() => setFilterOpen(true)}
                  aria-label={t('goals.filterProjects')}
                  title={t('goals.filterProjects')}
                  className={`flex-1 min-w-[2.25rem] h-8 flex items-center gap-2 px-3 rounded-lg text-left transition-colors ${
                    darkMode ? 'bg-white/10 text-gray-500 hover:bg-white/15' : 'bg-black/5 text-stone-400 hover:bg-black/10'
                  }`}
                >
                  <Search size={15} className={`flex-shrink-0 ${darkMode ? 'text-gray-400' : ''}`} />
                  <span className="min-w-0 truncate text-sm">{t('goals.filterButton')}</span>
                </button>
              )}
            </div>
          )}
          <div ref={projectsRef} data-standalone-list className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 pb-24">
            {standaloneProjects.length > 0 ? (
              <div className="flex flex-col gap-3">
                {standaloneProjects.map(proj => projectCard(proj, null, proj.status === 'completed'))}
              </div>
            ) : projectQuery.trim() ? emptyState(t('goals.noProjectsMatch'), null, null)
              : projectsFilter === 'completed' ? emptyState(t('goals.noCompletedProjects'), null, null)
              : emptyState(
                t('goals.noStandaloneProjects'),
                null,
                <button type="button" onClick={() => onNewProject(null)} className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-600 transition-colors">
                  <Layers size={14} /> {t('goals.addStandaloneProject')}
                </button>
              )}
          </div>
        </>
      )}

      {/* "Move to…" bottom sheet */}
      {moveToProject && (
        <div
          className="fixed inset-0 z-[70] flex flex-col justify-end"
          onClick={() => setMoveToProject(null)}
        >
          <div className="absolute inset-0 bg-black/50" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl px-4 pt-4 pb-8 border-t ${borderClass}`}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className={`text-sm font-semibold ${textPrimary}`}>
                {t('goals.moveProjectTo', { project: moveToProject.title })}
              </span>
              <button onClick={() => setMoveToProject(null)} className={`p-1 rounded-lg ${hoverBg}`}>
                <X size={16} className={textSecondary} />
              </button>
            </div>
            <MoveToList
              project={moveToProject}
              goals={goals}
              onMove={(goalId) => { moveProject(moveToProject.id, goalId); setMoveToProject(null); }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Dashboard controls (area filter + view toggle) ───────────────────────────
// Two pieces because the desktop space splits them: the area filter sits in
// the sidebar's Goals tab (only goals have areas) and the List/Roadmap toggle
// in the main area's toolbar. The phone keeps them in one row (GoalControls).

export const AreaFilter = ({ onManageAreas, iconOnly = false }) => {
  const { darkMode, textSecondary, borderClass } = useDayPlannerCtx();
  const { areas = [], goalsAreaFilter, setGoalsAreaFilter } = useFeaturesCtx();
  const { t } = useTranslation();
  const sorted = [...areas].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return (
    <div className={`flex items-center gap-2 ${iconOnly ? 'w-full' : 'contents'}`}>
      <select
        value={goalsAreaFilter}
        onChange={e => setGoalsAreaFilter(e.target.value)}
        aria-label={t('goals.area')}
        className={`${iconOnly ? 'min-w-0 shrink flex-1' : 'flex-1 min-w-[9rem]'} px-2.5 py-1.5 text-xs font-medium rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          darkMode ? 'bg-gray-700 text-gray-100' : 'bg-white text-stone-900'
        }`}
      >
        <option value="all">{t('goals.allAreas')}</option>
        <option value="uncategorized">{t('goals.noDefinedArea')}</option>
        {sorted.map(a => (
          <option key={a.id} value={a.id}>{a.name || t('goals.untitledArea')}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={onManageAreas}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg shrink-0 ${textSecondary} border ${borderClass} ${
          darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'
        } transition-colors`}
        title={t('goals.manageAreas')}
        aria-label={t('goals.manageAreas')}
      >
        <FolderOpen size={13} /> {!iconOnly && <span className="hidden sm:inline">{t('goals.manageAreas')}</span>}
      </button>
    </div>
  );
};

// `compact` drops the icons (the words stay): the phone's area row.
export const ViewToggle = ({ className = '', compact = false }) => {
  const { darkMode, textSecondary, borderClass } = useDayPlannerCtx();
  const { goalsViewMode, setGoalsViewMode } = useFeaturesCtx();
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t('goals.list')} className={`shrink-0 flex rounded-lg border ${borderClass} overflow-hidden ${className}`}>
      {[
        { key: 'list', label: t('goals.list'), Icon: LayoutDashboard },
        { key: 'timeline', label: t('goals.roadmap'), Icon: LineChart },
      ].map(({ key, label, Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={goalsViewMode === key}
          onClick={() => setGoalsViewMode(key)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
            goalsViewMode === key
              ? 'bg-blue-600 text-white'
              : `${textSecondary} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`
          }`}
        >
          {!compact && <Icon size={13} />} {label}
        </button>
      ))}
    </div>
  );
};

// The phone's row: the area select (never below 9rem, so its label is not
// cut mid-word), Manage Areas, and List | Roadmap in words only. Where a
// language's labels leave the select less than that, List | Roadmap wraps
// onto its own line (French, Spanish, Ukrainian at 360px; German at 320px)
// rather than squeezing the select. The chevron hides the row either way.
const GoalControls = ({ onManageAreas }) => (
  <div data-goal-controls className="flex flex-wrap items-center gap-2 mb-4">
    <AreaFilter onManageAreas={onManageAreas} />
    <ViewToggle compact />
  </div>
);

// ─── Archived goals & projects (collapsible footer) ───────────────────────────

// `anchored`: pinned at the bottom of its column, expanding UPWARD (the lists
// render above the toggle, capped and scrollable) — the desktop space.
// `stacked`: goals above projects instead of side by side — the phone, where
// two columns of titles with Restore buttons are too narrow to read.
const ArchivedSection = ({ archivedGoals, archivedProjects, onReviewProject, grid = false, anchored = false, stacked = false }) => {
  const { darkMode, borderClass, textSecondary, hoverBg } = useDayPlannerCtx();
  const { goals = [], updateGoal, updateProject } = useFeaturesCtx();
  const { t } = useTranslation();
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = archivedGoals.length + archivedProjects.length;
  if (archivedCount === 0) return null;
  const listClass = grid ? 'grid grid-cols-2 gap-1' : 'flex flex-col gap-1';
  const restoreClass = `flex-shrink-0 flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded ${
    darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'
  }`;
  const toggle = (
    <button
      onClick={() => setShowArchived(v => !v)}
      aria-expanded={showArchived}
      className={`flex items-center gap-2 text-xs ${textSecondary} ${hoverBg} px-3 py-2 transition-colors w-full`}
    >
      <Archive size={13} className="flex-shrink-0" />
      <span className="font-medium">{t('goals.archivedCount', { count: archivedCount })}</span>
      <ChevronDown size={13} className={`ml-auto flex-shrink-0 transition-transform duration-200 ${showArchived === !anchored ? 'rotate-180' : ''}`} />
    </button>
  );
  return (
    <div data-archived-section className={`border-t ${borderClass} flex-shrink-0 ${anchored ? 'flex flex-col-reverse' : ''}`}>
      {toggle}
      {showArchived && (
        <div className={`flex ${stacked ? 'flex-col gap-3 px-3 pb-3 max-h-[40vh] overflow-y-auto' : 'gap-4'} ${anchored ? `px-3 pt-3 pb-1 max-h-[40vh] overflow-y-auto border-b ${borderClass}` : 'mt-2'}`}>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>{t('goals.goals')}</p>
            {archivedGoals.length === 0 ? (
              <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>{t('goals.noArchivedGoals')}</p>
            ) : (
              <div className={listClass}>
                {archivedGoals.map(g => (
                  <div key={g.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${hoverBg} min-w-0`}>
                    <Flag size={11} className="text-blue-400 flex-shrink-0" />
                    <span className={`text-xs ${textSecondary} flex-1 min-w-0 truncate`}>{g.title}</span>
                    <button onClick={() => updateGoal(g.id, { status: restoredStatus(g) })} className={restoreClass}>
                      <RotateCcw size={9} /> {t('common.restore')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className={`${stacked ? 'h-px' : 'w-px self-stretch'} ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-medium ${textSecondary} opacity-60 uppercase tracking-wider mb-1.5 px-2`}>{t('goals.projects')}</p>
            {archivedProjects.length === 0 ? (
              <p className={`text-xs ${textSecondary} opacity-40 px-2 py-1`}>{t('goals.noArchivedProjects')}</p>
            ) : (
              // Grouped by goal (#2260); a project's title opens it for review.
              <div className="flex flex-col gap-2">
                {groupArchivedProjects(archivedProjects, goals).map(group => (
                  <div key={group.goal?.id ?? 'none'} data-archived-group>
                    <p className={`flex items-center gap-1 text-[11px] ${textSecondary} opacity-70 px-2 mb-0.5 min-w-0`}>
                      {group.goal && <Flag size={9} className="text-blue-400 flex-shrink-0" />}
                      <span className="truncate">{group.goal ? group.goal.title : t('goals.standalone')}</span>
                    </p>
                    <div className={listClass}>
                      {group.projects.map(p => (
                        <div key={p.id} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${hoverBg} min-w-0`}>
                          <Layers size={11} className="text-emerald-400 flex-shrink-0" />
                          <button
                            onClick={() => onReviewProject?.(p.id)}
                            title={t('goals.reviewArchived')}
                            className={`text-xs ${textSecondary} flex-1 min-w-0 truncate text-left hover:underline`}
                          >
                            {p.title}
                          </button>
                          <button onClick={() => updateProject(p.id, { status: restoredStatus(p) })} className={restoreClass}>
                            <RotateCcw size={9} /> {t('common.restore')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Manage Areas modal ────────────────────────────────────────────────────────

const ManageAreas = ({ onClose }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { areas = [], addArea, updateArea, deleteArea, reorderAreas } = useFeaturesCtx();
  const { t } = useTranslation();
  const [paletteForId, setPaletteForId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const sorted = [...areas].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const move = (idx, dir) => {
    const next = [...sorted];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    reorderAreas(next.map(a => a.id));
  };

  return (
    <form
      onClick={e => e.stopPropagation()}
      onSubmit={e => e.preventDefault()}
      className={`${cardBg} rounded-2xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4`}
    >
      <div className="flex items-center justify-between">
        <h3 className={`text-base font-semibold ${textPrimary}`}>{t('goals.manageAreas')}</h3>
        <button type="button" onClick={onClose} className={`p-1.5 rounded-lg ${hoverBg}`} aria-label={t('common.close')}>
          <X size={16} className={textSecondary} />
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className={`text-xs ${textSecondary} opacity-60`}>{t('goals.noAreasYet')}</p>
      ) : (
        <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
          {sorted.map((area, idx) => (
            <div key={area.id} className={`flex flex-col gap-2 p-2 rounded-lg border ${borderClass}`}>
              <div className="flex items-center gap-2">
                {/* Color swatch (toggles palette) */}
                <button
                  type="button"
                  onClick={() => setPaletteForId(paletteForId === area.id ? null : area.id)}
                  className={`w-6 h-6 rounded-full flex-shrink-0 ${area.color || 'bg-blue-500'} ring-1 ring-black/10`}
                  aria-label={t('goals.areaColor')}
                />
                {/* Name */}
                <input
                  value={area.name}
                  onChange={e => updateArea(area.id, { name: e.target.value })}
                  placeholder={t('goals.areaName')}
                  className={`flex-1 min-w-0 px-2 py-1.5 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
                  }`}
                />
                {/* Reorder */}
                <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0}
                  className={`p-1 rounded ${hoverBg} ${textSecondary} disabled:opacity-30`} aria-label={t('goals.moveUp')}>
                  <ChevronDown size={14} className="rotate-180" />
                </button>
                <button type="button" onClick={() => move(idx, 1)} disabled={idx === sorted.length - 1}
                  className={`p-1 rounded ${hoverBg} ${textSecondary} disabled:opacity-30`} aria-label={t('goals.moveDown')}>
                  <ChevronDown size={14} />
                </button>
                {/* Delete */}
                <button type="button" onClick={() => setConfirmDeleteId(area.id)}
                  className={`p-1 rounded ${darkMode ? 'text-red-400 hover:bg-red-900/20' : 'text-red-500 hover:bg-red-50'}`} aria-label={t('goals.deleteArea')}>
                  <Trash2 size={14} />
                </button>
              </div>
              {/* Palette */}
              {paletteForId === area.id && (
                <div className="grid grid-cols-9 gap-2 px-1 pb-1">
                  {TASK_COLORS.map(c => (
                    <button
                      key={c.class}
                      type="button"
                      onClick={() => { updateArea(area.id, { color: c.class }); setPaletteForId(null); }}
                      className={`w-6 h-6 rounded-full ${c.class} transition-transform ${
                        area.color === c.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-110'
                      }`}
                      aria-label={t(`colors.${c.name.toLowerCase()}`)}
                    />
                  ))}
                </div>
              )}
              {/* Inline delete confirm */}
              {confirmDeleteId === area.id && (
                <div className="flex items-center gap-2 px-1">
                  <span className={`text-xs ${textSecondary}`}>{t('goals.deleteAreaConfirm')}</span>
                  <button type="button" onClick={() => { deleteArea(area.id); setConfirmDeleteId(null); }}
                    className="ml-auto text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700">{t('common.delete')}</button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)}
                    className={`text-xs px-2 py-1 rounded ${hoverBg} ${textSecondary}`}>{t('common.cancel')}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => addArea({ name: '' })}
        className={`flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-dashed ${borderClass} ${textSecondary} ${hoverBg} transition-colors`}
      >
        <Plus size={15} /> {t('goals.addAreaCta')}
      </button>
    </form>
  );
};

// ─── Area form (create / edit a single area) ──────────────────────────────────

const AreaForm = ({ initial, onClose }) => {
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg } = useDayPlannerCtx();
  const { addArea, updateArea, deleteArea } = useFeaturesCtx();
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name || '');
  const [color, setColor] = useState(initial?.color || TASK_COLORS[0].class);

  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    if (initial) updateArea(initial.id, { name: n, color });
    else addArea({ name: n, color });
    onClose();
  };

  return (
    <form onSubmit={submit} onClick={e => e.stopPropagation()} className={`${cardBg} rounded-2xl shadow-2xl max-w-sm p-5 w-full flex flex-col gap-4`}>
      <h3 className={`text-base font-semibold ${textPrimary}`}>{initial ? t('goals.editArea') : t('goals.newArea')}</h3>
      <div className="flex flex-col gap-1">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('goals.areaName')}</label>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('goals.areaName')}
          className={`px-3 py-2 text-sm rounded-lg border ${borderClass} focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            darkMode ? 'bg-gray-700 text-gray-100 placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'
          }`}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={`text-xs font-medium ${textSecondary}`}>{t('common.color')}</label>
        <div className="grid grid-cols-9 gap-2 w-full">
          {TASK_COLORS.map(c => (
            <button
              key={c.class}
              type="button"
              onClick={() => setColor(c.class)}
              className={`w-7 h-7 rounded-full ${c.class} transition-transform ${
                color === c.class ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-110'
              }`}
              aria-label={t(`colors.${c.name.toLowerCase()}`)}
            />
          ))}
        </div>
      </div>
      <div className="flex gap-2 items-center">
        {initial && (
          <button
            type="button"
            onClick={() => { deleteArea(initial.id); onClose(); }}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${darkMode ? 'text-red-400 hover:bg-red-900/20' : 'text-red-500 hover:bg-red-50'}`}
          >
            {t('goals.deleteArea')}
          </button>
        )}
        <div className="flex gap-2 ml-auto">
          <button type="button" onClick={onClose} className={`px-3 py-1.5 text-sm rounded-lg ${hoverBg} ${textSecondary} transition-colors`}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!name.trim()} className="px-4 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
            {initial ? t('common.save') : t('common.addArea')}
          </button>
        </div>
      </div>
    </form>
  );
};

// ─── Goal detail panel (roadmap) ──────────────────────────────────────────────
// Shown beneath the roadmap chart when a bar is clicked: the goal's header card
// (edit / add project) plus its child ProjectCards — identical to the List view,
// including inline tasks. Supports drag-reorder of projects WITHIN this goal only.

const GoalDetailPanel = ({ goal, projects, onEditGoal, onEditProject, onNewProject, onClose }) => {
  const { darkMode, borderClass, textPrimary, textSecondary, hoverBg, isMobile } = useDayPlannerCtx();
  const { moveProject } = useFeaturesCtx();
  const { t } = useTranslation();

  const childProjects = useMemo(
    () => sortByOrder(projects.filter(p => p.goalId === goal.id && p.status !== 'archived')),
    [projects, goal.id]
  );
  const activeProjs = childProjects.filter(p => p.status !== 'completed');
  const doneProjs = childProjects.filter(p => p.status === 'completed');

  // ── Within-goal reorder: HTML5 drag (desktop) + touch drag (iOS) ─────────────
  const [dragId, setDragId] = useState(null);
  const [beforeId, setBeforeId] = useState(null);
  const touchRef = useRef({ active: false, projId: null, beforeId: null });

  const endDrag = useCallback(() => { setDragId(null); setBeforeId(null); }, []);
  const startDrag = useCallback((e, id) => {
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => setDragId(id), 0);
  }, []);
  const finishTouch = useCallback(() => {
    const st = touchRef.current;
    touchRef.current = { active: false, projId: null, beforeId: null };
    if (st.active && st.projId) moveProject(st.projId, goal.id, st.beforeId || null);
    endDrag();
  }, [moveProject, goal.id, endDrag]);
  const startTouch = useCallback((id) => () => {
    touchRef.current = { active: true, projId: id, beforeId: null };
    setDragId(id);
    const onMove = (me) => {
      const st = touchRef.current;
      if (!st.active) return;
      me.preventDefault();
      const tch = me.touches[0];
      if (!tch) return;
      const el = document.elementFromPoint(tch.clientX, tch.clientY);
      const target = el?.closest('[data-detail-before]');
      const b = target?.getAttribute('data-detail-before');
      const nb = b && b !== st.projId ? b : null;
      st.beforeId = nb;
      setBeforeId(nb);
    };
    const preventDrag = (de) => de.preventDefault();
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('dragstart', preventDrag);
      finishTouch();
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('dragstart', preventDrag);
  }, [finishTouch]);

  const dragHandle = (proj) => ({
    draggable: true,
    onDragStart: (e) => startDrag(e, proj.id),
    onDragEnd: endDrag,
    onTouchStart: startTouch(proj.id),
  });
  const wrapCard = (proj, jsx) => (
    <div
      key={proj.id}
      data-detail-before={proj.id}
      className={`relative w-full transition-opacity ${dragId === proj.id ? 'opacity-40' : ''} ${
        beforeId === proj.id && dragId && dragId !== proj.id ? 'ring-2 ring-blue-500 rounded-xl' : ''
      }`}
      onDragOver={e => { e.preventDefault(); e.stopPropagation(); if (dragId && dragId !== proj.id) setBeforeId(proj.id); }}
      onDrop={e => { e.preventDefault(); if (!dragId) return; moveProject(dragId, goal.id, proj.id); endDrag(); }}
    >
      {jsx}
    </div>
  );

  const listClass = 'flex flex-col gap-4';
  const listRef = useRef(null);
  const scale = useSpaceCardScale();
  const cols = useGridColumns(listRef, scale);

  return (
    <div className={`mt-5 border-t ${borderClass} pt-4`}>
      {/* Title + actions (the bar above already shows dates/progress/area) */}
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${textPrimary} truncate min-w-0`}>{goal.title}</span>
          <button
            onClick={() => onEditGoal(goal)}
            className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-blue-500 hover:text-blue-600 px-1.5 py-1 rounded transition-colors"
          >
            <Edit2 size={13} /> {t('goals.editGoal')}
          </button>
          <button
            onClick={() => onNewProject(goal.id)}
            className="flex-shrink-0 flex items-center gap-1 text-xs font-medium text-emerald-500 hover:text-emerald-600 px-1.5 py-1 rounded transition-colors"
          >
            <Layers size={13} /> {t('common.addProject')}
          </button>
          <button onClick={onClose} className={`ml-auto flex-shrink-0 p-1.5 rounded-lg ${hoverBg}`} aria-label={t('common.close')}>
            <X size={15} className={textSecondary} />
          </button>
        </div>
        {/* Keyed by goal: switching goals flushes this one's notes and loads the next. */}
        <GoalNotes key={goal.id} goal={goal} className="mt-2" />
      </div>

      {/* Child projects — identical to List view (inline tasks), reorderable within the goal */}
      <div
        ref={listRef}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (!dragId || beforeId) return; moveProject(dragId, goal.id); endDrag(); }}
      >
        {(() => {
          const activeCard = proj => wrapCard(proj,
            <ProjectCard project={proj} onEditClick={() => onEditProject(proj)} dragHandleProps={dragHandle(proj)} wide={!isMobile} visibleCount={isMobile ? 3 : SPACE_VISIBLE_TASKS} />
          );
          const doneCard = proj => wrapCard(proj,
            <ProjectCard project={proj} onEditClick={() => onEditProject(proj)} compact dragHandleProps={dragHandle(proj)} wide={!isMobile} />
          );
          if (isMobile) {
            return (
              <>
                {activeProjs.length > 0 && <div className={`${listClass} mb-3`}>{activeProjs.map(activeCard)}</div>}
                {doneProjs.length > 0 && <div className={listClass}>{doneProjs.map(doneCard)}</div>}
              </>
            );
          }
          return (
            <>
              {activeProjs.length > 0 && <CardColumns items={activeProjs} cols={cols} justify="center" scale={scale} className="mb-3" renderItem={activeCard} />}
              {doneProjs.length > 0 && <CardColumns items={doneProjs} cols={cols} justify="center" scale={scale} renderItem={doneCard} />}
            </>
          );
        })()}
      </div>
    </div>
  );
};

/**
 * GoalDashboard — the Goals & Projects feature's screen, in one of two modes:
 *
 *   embedded — the phone's Goals tab (MobileLayout): the desktop space folded
 *              into one column (MobileDashboard: Goals | Projects, goal chips
 *              over a carousel of full-width GoalCards, the standalone list
 *              with Open | Completed and a filter), the same FAB stack as the
 *              space (Aspire, then Add Goal / Add Project by tab), and the
 *              mobile (bottom-sheet) forms.
 *   desktop  — the Goals & Projects SPACE on desktop and tablet
 *              (DesktopLayout, docs/goals-space-spec.md): a sidebar and a main
 *              area rendered as siblings in the layout's flex row, exactly
 *              where the calendar sidebar and grid sit. The sidebar lists the
 *              goals (or the standalone projects); the main area shows the
 *              selected goal with its project cards, the roadmap, or the
 *              standalone grid. Forms use the desktop presentation.
 *
 * `isActive` says whether the screen is on screen: the Escape chain below and
 * the focus request (goalsDashboardFocusId) only act while it is.
 */
const GoalDashboard = ({ embedded = false, desktop = false, isActive = false, initialSidebarTab = 'goals' }) => {
  const {
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    showAddTask, setShowAddTask, setShowNewTaskDeadlinePicker,
    isMobile,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    expandedNotesTaskId, setExpandedNotesTaskId,
  } = useDayPlannerCtx();
  const {
    goals, projects, setProjects,
    areas = [], goalsAreaFilter, setGoalsAreaFilter, goalsViewMode,
    goalsDashboardFocusId, setGoalsDashboardFocusId,
    goalsDashboardFocusProjectId, setGoalsDashboardFocusProjectId,
    goalsDashboardFocusTab, setGoalsDashboardFocusTab,
    addGoal, updateGoal, deleteGoal,
    addProject, updateProject, moveProject,
    plannerProjectId, setPlannerProjectId,
    isVisibleForUser,
    aspireEnabled = false,
  } = useFeaturesCtx();
  // Workspace creation (companion §4.3, rulings D and E): the plugin creates and links the note.
  const { createProjectNote, linkProjectNote } = useSyncCtx();
  const { t } = useTranslation();

  const [goalForm, setGoalForm] = useState(null);
  const [projectForm, setProjectForm] = useState(null);
  const [areaForm, setAreaForm] = useState(null); // { editing: area|null }
  const [confirmDialog, setConfirmDialog] = useState(null); // { title, message, onConfirm }
  const [reviewProjectId, setReviewProjectId] = useState(null); // an archived project opened for review (#2260)
  const [showManageAreas, setShowManageAreas] = useState(false);
  const [selectedRoadmapGoalId, setSelectedRoadmapGoalId] = useState(null); // roadmap detail panel
  const [roadmapPeriod, setRoadmapPeriod] = useState(DEFAULT_PERIOD); // Range: the toolbar's on desktop
  // Desktop space: which sidebar tab is up, which goal is selected, and the
  // project a "Move to…" picker is open for.
  const [sidebarTab, setSidebarTab] = useState(initialSidebarTab);
  const [selectedGoalId, setSelectedGoalId] = useState(null);
  const [moveToProject, setMoveToProject] = useState(null);
  // Projects tab: Open | Completed, so finished standalone projects do not take
  // up the main area (the Goals tab keeps completed children compact under the
  // active ones, since they count toward the goal).
  const [projectsFilter, setProjectsFilter] = useState('open');
  // Projects tab: the highlighted row (click, or Up/Down); its card is ringed
  // and scrolled into view in the main area.
  const [focusedProjectId, setFocusedProjectId] = useState(null);
  // Projects tab filter field: title match, applied after Open | Completed.
  const [projectQuery, setProjectQuery] = useState('');
  const filterInputRef = useRef(null);
  // Aspire (experimental): the placeholder modal opened from the FAB stack.
  const [showAspire, setShowAspire] = useState(false);
  // The Goals tab's "+" choice (GoalsAddMenu, #2133), and the phone carousel's
  // page goal, which MobileDashboard reports so the "+" can name it.
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [mobilePageGoalId, setMobilePageGoalId] = useState(null);
  const plusRef = useRef(null);
  // Phone: the controls under Goals | Projects hidden by its chevron. A
  // per-device preference; storage can be missing or throw (private mode,
  // tests), and then it simply starts expanded.
  const [controlsCollapsed, setControlsCollapsed] = useState(() => {
    try { return localStorage.getItem(PHONE_CONTROLS_KEY) === '1'; } catch { return false; }
  });
  const toggleControls = () => setControlsCollapsed(v => {
    const next = !v;
    try { localStorage.setItem(PHONE_CONTROLS_KEY, next ? '1' : '0'); } catch { /* keep it for this session */ }
    return next;
  });

  // If the saved filter points at an area that no longer exists (deleted on this
  // or another device), fall back to "All" so the dashboard isn't stuck empty.
  useEffect(() => {
    if (goalsAreaFilter && goalsAreaFilter !== 'all' && goalsAreaFilter !== 'uncategorized'
        && !areas.some(a => a.id === goalsAreaFilter)) {
      setGoalsAreaFilter('all');
    }
  }, [goalsAreaFilter, areas, setGoalsAreaFilter]);

  // Show the "Track in lifeGLANCE" checkbox whenever ANY intents transport is
  // enabled — WebDAV, iCloud, OR GLANCEvault — not just WebDAV. emitGoalCreate
  // delivers over whichever targets are enabled, so the share UI must follow the
  // same enablement, otherwise a vault-only user can't share goals.
  const hasIntentsTarget = useMemo(() => {
    let cfg = null;
    try {
      const raw = localStorage.getItem(INTENT_CONFIG_KEY);
      cfg = raw ? JSON.parse(raw) : null;
    } catch { cfg = null; }
    return enabledIntentTargets(cfg).length > 0;
  }, []);

  // Refs for SVG line calculation (desktop only)
  const goalCardRefs = useRef({});
  const projectCardRefs = useRef({});
  const drag = useProjectDrag({ moveProject, projectCardRefs });

  // Multi-user: filter goals and projects independently by assignment (empty =
  // everybody). Goals are NOT hidden just because their visible children are
  // filtered out, so shared family goals stay put regardless of who owns the
  // child projects.
  const visibleGoals = useMemo(() => goals.filter(isVisibleForUser), [goals, isVisibleForUser]);
  const visibleProjects = useMemo(() => projects.filter(isVisibleForUser), [projects, isVisibleForUser]);
  const activeGoals = useMemo(() => visibleGoals.filter(g => g.status !== 'archived'), [visibleGoals]);
  const activeProjects = useMemo(() => visibleProjects.filter(p => p.status !== 'archived'), [visibleProjects]);

  // Area filter (dashboard-level). Standalone projects are area-agnostic and are
  // NOT filtered — activeProjects is passed through whole so they always show.
  const filteredGoals = useMemo(() => {
    if (!goalsAreaFilter || goalsAreaFilter === 'all') return activeGoals;
    if (goalsAreaFilter === 'uncategorized') {
      return activeGoals.filter(g => !g.areaId || !areas.some(a => a.id === g.areaId));
    }
    return activeGoals.filter(g => g.areaId === goalsAreaFilter);
  }, [activeGoals, goalsAreaFilter, areas]);

  // Roadmap detail-panel selection: clear it when the goal leaves the filtered
  // view or when we switch away from the roadmap.
  useEffect(() => {
    if (selectedRoadmapGoalId && (goalsViewMode !== 'timeline' || !filteredGoals.some(g => g.id === selectedRoadmapGoalId))) {
      setSelectedRoadmapGoalId(null);
    }
  }, [selectedRoadmapGoalId, goalsViewMode, filteredGoals]);
  const selectedRoadmapGoal = filteredGoals.find(g => g.id === selectedRoadmapGoalId) || null;
  const toggleRoadmapGoal = (id) => setSelectedRoadmapGoalId(cur => (cur === id ? null : id));
  const archivedGoals = useMemo(() => visibleGoals.filter(g => g.status === 'archived'), [visibleGoals]);
  const archivedProjects = useMemo(() => visibleProjects.filter(p => p.status === 'archived'), [visibleProjects]);

  // ── Desktop space: sidebar list + selection ─────────────────────────────────
  // The sidebar lists the goals in the same set and order the carousel used
  // (sortGoalsForCarousel over the area-filtered goals). The selection falls
  // back to findDefaultActiveIdx (first active goal) whenever the selected goal
  // is gone or filtered out.
  const sortedGoals = useMemo(() => sortGoalsForCarousel(filteredGoals), [filteredGoals]);
  const sortedAllGoals = useMemo(() => sortGoalsForCarousel(activeGoals), [activeGoals]);
  const standaloneProjects = useMemo(() => sortByOrder(activeProjects.filter(p => !p.goalId)), [activeProjects]);
  const openStandalone = useMemo(() => standaloneProjects.filter(p => p.status !== 'completed'), [standaloneProjects]);
  const completedStandalone = useMemo(() => standaloneProjects.filter(p => p.status === 'completed'), [standaloneProjects]);
  const shownStandalone = useMemo(() => {
    const byStatus = projectsFilter === 'completed' ? completedStandalone : openStandalone;
    const q = projectQuery.trim().toLowerCase();
    return q ? byStatus.filter(p => (p.title || '').toLowerCase().includes(q)) : byStatus;
  }, [projectsFilter, completedStandalone, openStandalone, projectQuery]);
  const selectedGoal = useMemo(
    () => sortedGoals.find(g => g.id === selectedGoalId) || sortedGoals[findDefaultActiveIdx(sortedGoals)] || null,
    [sortedGoals, selectedGoalId]
  );
  const selectedGoalProjects = useMemo(
    () => sortByOrder(selectedGoal ? activeProjects.filter(p => p.goalId === selectedGoal.id) : []),
    [selectedGoal, activeProjects]
  );
  const selectGoal = (id) => {
    setSelectedGoalId(id);
    // A project ringed by a link belongs to the goal it was on.
    if (sidebarTab === 'goals') setFocusedProjectId(null);
    // In Roadmap the sidebar does not switch the view; it opens that goal's
    // detail panel under the chart instead.
    if (goalsViewMode === 'timeline') setSelectedRoadmapGoalId(id);
  };

  // The goal the Goals tab's "+" offers to add a project to: the one on
  // screen. The Roadmap's open detail panel, else the phone carousel's page,
  // else the sidebar selection (both fall back to the first active goal). None
  // in the Roadmap with no goal open, or with no goals at all: then the "+"
  // adds a goal directly, as it always did, with no menu in the way.
  const fabGoal = sidebarTab !== 'goals' ? null
    : goalsViewMode === 'timeline' ? selectedRoadmapGoal
      : embedded ? (sortedGoals.find(g => g.id === mobilePageGoalId) || sortedGoals[findDefaultActiveIdx(sortedGoals)] || null)
        : selectedGoal;
  // A menu naming a goal that is no longer on screen is closed, not retargeted.
  useEffect(() => { setAddMenuOpen(false); }, [sidebarTab, fabGoal?.id]);

  // Focus request from outside the space (a goal ring in the calendar sidebar,
  // a project card's future session…): select that goal. The phone's carousel
  // consumes the same id itself (MobileDashboard), so only the desktop space
  // handles it here. Widens the area filter if it would hide the goal.
  useEffect(() => {
    if (!desktop || !isActive || !goalsDashboardFocusId) return;
    const goal = activeGoals.find(g => g.id === goalsDashboardFocusId);
    if (goal) {
      setSidebarTab('goals');
      setSelectedGoalId(goal.id);
      if (goalsViewMode === 'timeline') setSelectedRoadmapGoalId(goal.id);
      if (!filteredGoals.some(g => g.id === goal.id)) setGoalsAreaFilter('all');
    }
    setGoalsDashboardFocusId(null);
  }, [goalsDashboardFocusId, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollProjectIntoView = (projectId) => {
    projectCardRefs.current[projectId]?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  };
  const focusProject = (projectId) => {
    setFocusedProjectId(projectId);
    scrollProjectIntoView(projectId);
  };

  // Project focus request (utils/goalsLink.js, the Project widget's tap):
  // select where the project lives — its goal on the Goals tab (widening the
  // area filter, and in Roadmap opening that goal's panel), or the Projects
  // tab with the Open/Completed list it is on and no text filter — then ring
  // its card and scroll to it once that list has rendered. The phone's
  // carousel consumes the same request itself (MobileDashboard).
  // Panel request (utils/goalsLink.js): the sidebar tab alone.
  useEffect(() => {
    if (!desktop || !isActive || !goalsDashboardFocusTab) return;
    setSidebarTab(goalsDashboardFocusTab);
    setGoalsDashboardFocusTab(null);
  }, [goalsDashboardFocusTab, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!desktop || !isActive || !goalsDashboardFocusProjectId) return;
    const target = projectFocusTarget(goalsDashboardFocusProjectId, { projects: activeProjects, goals: activeGoals });
    setGoalsDashboardFocusProjectId(null);
    if (!target) return;
    const { project, goalId } = target;
    if (goalId) {
      setSidebarTab('goals');
      setSelectedGoalId(goalId);
      if (goalsViewMode === 'timeline') setSelectedRoadmapGoalId(goalId);
      if (!filteredGoals.some(g => g.id === goalId)) setGoalsAreaFilter('all');
    } else {
      setSidebarTab('projects');
      setProjectsFilter(project.status === 'completed' ? 'completed' : 'open');
      setProjectQuery('');
    }
    setFocusedProjectId(project.id);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollProjectIntoView(project.id)));
  }, [goalsDashboardFocusProjectId, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sidebar keyboard hooks for the global shortcut handler (useKeyboardShortcuts):
  // Up/Down move the selection on the current tab, ',' / '.' pick the tab.
  // Registered only while the space is active so the calendar never sees them.
  // The handlers close over the current render (tab, lists, selection), so they
  // live in a ref refreshed every render; the registration effect only runs when
  // the space's active state changes and calls through that ref.
  const { goalsSpaceKeysRef } = useFeaturesCtx();
  const keysImplRef = useRef(null);
  keysImplRef.current = {
      setTab: setSidebarTab,
      // 'n': the "+" — on the Goals tab its menu (project in the goal on
      // screen, or a goal), or a goal when there is none to name; a new
      // standalone project on Projects
      newItem: () => {
        if (sidebarTab === 'goals') {
          if (fabGoal) setAddMenuOpen(true);
          else setGoalForm({ editing: null });
        } else setProjectForm({ editing: null, defaultGoalId: null });
      },
      // '/': the project filter (switching to the Projects tab if needed)
      focusFilter: () => {
        setSidebarTab('projects');
        requestAnimationFrame(() => filterInputRef.current?.focus());
      },
      moveSelection: (delta) => {
        if (sidebarTab === 'goals') {
          if (sortedGoals.length === 0) return;
          const idx = sortedGoals.findIndex(g => g.id === selectedGoal?.id);
          const next = sortedGoals[Math.min(sortedGoals.length - 1, Math.max(0, idx + delta))];
          if (next) selectGoal(next.id);
        } else {
          if (shownStandalone.length === 0) return;
          const idx = shownStandalone.findIndex(p => p.id === focusedProjectId);
          const next = shownStandalone[idx === -1 ? (delta > 0 ? 0 : shownStandalone.length - 1) : Math.min(shownStandalone.length - 1, Math.max(0, idx + delta))];
          if (next) focusProject(next.id);
        }
      },
      // Enter: the selected project's PLANNER (Projects tab)
      openSelected: () => {
        if (sidebarTab !== 'projects' || !focusedProjectId) return false;
        setPlannerProjectId(focusedProjectId);
        return true;
      },
  };
  useEffect(() => {
    if (!desktop || !isActive || !goalsSpaceKeysRef) return undefined;
    goalsSpaceKeysRef.current = {
      setTab: (tab) => keysImplRef.current?.setTab(tab),
      newItem: () => keysImplRef.current?.newItem(),
      focusFilter: () => keysImplRef.current?.focusFilter(),
      moveSelection: (delta) => keysImplRef.current?.moveSelection(delta),
      openSelected: () => keysImplRef.current?.openSelected() ?? false,
    };
    return () => { goalsSpaceKeysRef.current = null; };
  }, [desktop, isActive, goalsSpaceKeysRef]);

  const handleSaveGoal = (fields) => {
    const { trackInLifeGlance, createNote, linkNotePath, ...goalFields } = fields;
    if (goalForm.editing) {
      // Archiving cascades to the goal's projects inside updateGoal, and a
      // restore puts them back (utils/archiveCascade.js, #2260).
      // Sharing an EXISTING, not-yet-shared goal: mark it synced and emit a
      // create so lifeGLANCE mirrors it. Guarded so we never re-emit for a goal
      // already shared or one that originated in lifeGLANCE.
      const shareNow = trackInLifeGlance
        && !goalForm.editing.synced_to_lifeglance
        && goalForm.editing.source_app !== 'app.lifeglance';
      updateGoal(goalForm.editing.id, { ...goalFields, ...(shareNow ? { synced_to_lifeglance: true } : {}) });
      if (shareNow) emitGoalCreate({ ...goalForm.editing, ...goalFields, synced_to_lifeglance: true });
      if (linkNotePath) linkProjectNote?.('goal', goalForm.editing.id, linkNotePath);
    } else {
      const newGoal = addGoal({ ...goalFields, ...(trackInLifeGlance ? { synced_to_lifeglance: true } : {}) });
      if (trackInLifeGlance) emitGoalCreate(newGoal);
      // The title's wikilink links the note it names; the checkbox creates one. The link wins when both are set.
      if (linkNotePath && newGoal?.id) linkProjectNote?.('goal', newGoal.id, linkNotePath, { description: newGoal.description });
      else if (createNote && newGoal?.id) createProjectNote?.('goal', newGoal.id, { title: newGoal.title, description: newGoal.description });
      // A goal created from the space is the one to look at next.
      if (newGoal?.id) setSelectedGoalId(newGoal.id);
    }
    setGoalForm(null);
  };

  const handleDeleteGoal = (goalId) => {
    setGoalForm(null);
    setConfirmDialog({
      title: t('goals.deleteGoal'),
      message: t('goals.deleteGoalConfirm'),
      onConfirm: () => {
        // The goal's projects are reparented to standalone by the context's
        // deleteGoal itself (App.jsx wires it through utils/deleteCascade.js),
        // so every deletion path — this dashboard, a lifeGLANCE intent, an
        // MCP-undo replay — leaves no project pointing at a deleted goal.
        deleteGoal(goalId);
        setConfirmDialog(null);
      },
    });
  };

  const handleSaveProject = (allFields) => {
    const { createNote, linkNotePath, ...fields } = allFields;
    if (projectForm.editing) {
      // Archiving cascades to the project's tasks inside updateProject, and a
      // restore puts them back (utils/archiveCascade.js, #2260).
      updateProject(projectForm.editing.id, fields);
      if (linkNotePath) linkProjectNote?.('project', projectForm.editing.id, linkNotePath);
    } else {
      const created = addProject(fields);
      if (linkNotePath && created?.id) linkProjectNote?.('project', created.id, linkNotePath);
      else if (createNote && created?.id) createProjectNote?.('project', created.id, { title: created.title, goalId: created.goalId, description: created.description });
    }
    setProjectForm(null);
  };

  // Escape key — capture phase so this fires before useModalClose and other
  // handlers. While the screen is on screen it owns Escape for the things it
  // opened, in priority order: notes panel → task editor → PLANNER → forms →
  // Manage Areas → "Move to…". When none of them is open the key is left
  // alone, for whatever app-level modal is up (Settings, Spotlight, help…).
  // Escape NEVER leaves the space (spec D11): the switcher and `g` do that.
  useEffect(() => {
    if (!isActive) return;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      // A task notes/subtasks overlay (e.g. opened from a SCHED/planner card)
      // sits above everything and closes itself — leave ESC to it.
      if (document.querySelector('.sched-notes-panel')) return;
      // So does an open deadline picker (a project card or PLANNER row).
      if (document.querySelector('.deadline-picker-popover')) return;
      // And a field that cancels itself on Escape (the planner's title
      // rename, #2132): the key cancels the edit, not the planner.
      if (document.activeElement?.closest?.('[data-owns-escape]')) return;
      let close = null;
      // The project filter field: Escape clears it and gives focus back.
      const filterEl = filterInputRef.current;
      if (filterEl && document.activeElement === filterEl) {
        close = () => { setProjectQuery(''); filterEl.blur(); };
      }
      else if (expandedNotesTaskId) close = () => setExpandedNotesTaskId(null);
      else if (showAddTask) {
        // Close task edit modal without leaving the space
        close = () => { setShowAddTask(false); setShowNewTaskDeadlinePicker(false); };
      }
      // The PLANNER (z-70) sits above the space, below the editor: it closes
      // after the editor and before the forms.
      else if (plannerProjectId) close = () => setPlannerProjectId(null);
      else if (reviewProjectId) close = () => setReviewProjectId(null);
      else if (goalForm) close = () => setGoalForm(null);
      else if (projectForm) close = () => setProjectForm(null);
      else if (areaForm) close = () => setAreaForm(null);
      else if (showManageAreas) close = () => setShowManageAreas(false);
      else if (moveToProject) close = () => setMoveToProject(null);
      else if (showAspire) close = () => setShowAspire(false);
      if (!close) return;
      e.stopImmediatePropagation(); // prevent all other keydown listeners
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', handler, true); // capture phase
    return () => document.removeEventListener('keydown', handler, true);
  }, [isActive, goalForm, projectForm, areaForm, showManageAreas, moveToProject, showAspire, showAddTask, expandedNotesTaskId,
      plannerProjectId, reviewProjectId, setPlannerProjectId,
      setShowAddTask, setShowNewTaskDeadlinePicker, setExpandedNotesTaskId]);

  if (!embedded && !desktop) return null;

  const onEditGoal = goal => setGoalForm({ editing: goal });
  const onEditProject = proj => setProjectForm({ editing: proj, defaultGoalId: null });
  const onNewProject = defaultGoalId => setProjectForm({ editing: null, defaultGoalId: defaultGoalId ?? null });

  const roadmap = (
    <>
      <GoalTimeline
        goals={filteredGoals}
        projects={activeProjects}
        areas={areas}
        selectedGoalId={selectedRoadmapGoalId}
        onSelectGoal={toggleRoadmapGoal}
        periodKey={roadmapPeriod}
        onPeriodChange={setRoadmapPeriod}
        showRange={!desktop}
      />
      {selectedRoadmapGoal && (
        <GoalDetailPanel
          goal={selectedRoadmapGoal}
          projects={activeProjects}
          onEditGoal={onEditGoal}
          onEditProject={onEditProject}
          onNewProject={onNewProject}
          onClose={() => setSelectedRoadmapGoalId(null)}
        />
      )}
    </>
  );

  const formOverlays = (
    <>
      {goalForm && (
        <FormOverlay onClose={() => setGoalForm(null)} mobile={!desktop} cardBg={cardBg}>
          <GoalForm
            initial={goalForm.editing}
            childProjects={goalForm.editing ? projects.filter(p => p.goalId === goalForm.editing.id) : []}
            onSave={handleSaveGoal}
            onCancel={() => setGoalForm(null)}
            onDelete={goalForm.editing ? () => handleDeleteGoal(goalForm.editing.id) : undefined}
            mobile={!desktop}
            showLifeGlanceCheckbox={hasIntentsTarget}
          />
        </FormOverlay>
      )}
      {projectForm && (
        <FormOverlay onClose={() => setProjectForm(null)} mobile={!desktop} cardBg={cardBg}>
          <ProjectForm
            initial={projectForm.editing}
            goals={goals}
            defaultGoalId={projectForm.defaultGoalId}
            onSave={handleSaveProject}
            onCancel={() => setProjectForm(null)}
            mobile={!desktop}
          />
        </FormOverlay>
      )}
      {areaForm && (
        <FormOverlay onClose={() => setAreaForm(null)} mobile={!desktop} cardBg={cardBg}>
          <AreaForm initial={areaForm.editing} onClose={() => setAreaForm(null)} />
        </FormOverlay>
      )}
      {showManageAreas && (
        <FormOverlay onClose={() => setShowManageAreas(false)} mobile={!desktop} cardBg={cardBg}>
          <ManageAreas onClose={() => setShowManageAreas(false)} />
        </FormOverlay>
      )}
      {reviewProjectId && (
        <ArchivedProjectReview
          project={archivedProjects.find(p => p.id === reviewProjectId)}
          onClose={() => setReviewProjectId(null)}
        />
      )}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </>
  );

  // The FAB stack both layouts float over their content: Aspire (when on)
  // above a contextual + — on the Goals tab a choice between a project in the
  // goal on screen and a new goal (GoalsAddMenu), or a goal straight away when
  // there is no goal to name; Add Project on Projects.
  const goalsTab = sidebarTab === 'goals';
  const plusLabel = !goalsTab ? t('common.addProject') : fabGoal ? t('common.add') : t('common.addGoal');
  const onPlus = () => {
    if (!goalsTab) onNewProject(null);
    else if (fabGoal) setAddMenuOpen(open => !open);
    else setGoalForm({ editing: null });
  };
  const fabStack = (className) => (
    <div data-goals-fabs className={`${className} z-10 flex flex-col items-center gap-2 pointer-events-none`}>
      {aspireEnabled && (
        <button
          type="button"
          onClick={() => setShowAspire(true)}
          className={`pointer-events-auto w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${
            darkMode ? 'bg-gray-700 text-amber-300 hover:bg-gray-600' : 'bg-stone-200 text-amber-500 hover:bg-stone-300'
          }`}
          title={t('aspire.title')}
          aria-label={t('aspire.title')}
          data-aspire-fab
        >
          <Compass size={24} />
        </button>
      )}
      <div className="relative">
        {addMenuOpen && fabGoal && (
          <GoalsAddMenu
            goalTitle={fabGoal.title}
            onAddProject={() => onNewProject(fabGoal.id)}
            onAddGoal={() => setGoalForm({ editing: null })}
            onClose={() => setAddMenuOpen(false)}
            darkMode={darkMode}
            anchorRef={plusRef}
          />
        )}
        <button
          ref={plusRef}
          type="button"
          onClick={onPlus}
          className="pointer-events-auto w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center transition-colors"
          title={desktop ? `${plusLabel} (N)` : undefined}
          aria-label={plusLabel}
          aria-haspopup={goalsTab && fabGoal ? 'menu' : undefined}
          aria-expanded={goalsTab && fabGoal ? addMenuOpen : undefined}
          data-goals-plus
        >
          <Plus size={28} />
        </button>
      </div>
    </div>
  );

  // ── Embedded mode: renders as inline tab content (mobile Goals tab) ──────
  if (embedded) {
    return (
      <>
        {/* Body. The FABs float over the content's bottom-right corner, above
            the Archived footer (so an expanded archive never slides under
            them), like the space's; the pages pad their bottoms so the last
            card scrolls clear of them. */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="relative flex-1 flex flex-col min-h-0">
          <div className="px-3 pt-3 pb-3 flex-shrink-0">
            <MobileGoalsTabs
              tab={sidebarTab}
              onTabChange={setSidebarTab}
              goalCount={activeGoals.length}
              openCount={openStandalone.length}
              controlsCollapsed={controlsCollapsed}
              onToggleControls={toggleControls}
              filtersActive={goalsTab
                ? !!goalsAreaFilter && goalsAreaFilter !== 'all'
                : projectsFilter === 'completed' || !!projectQuery.trim()}
            />
          </div>
          {/* Area filter, Manage Areas and List | Roadmap: goals only (D8, D9) */}
          {goalsTab && !controlsCollapsed && (
            <div className="px-3 flex-shrink-0">
              <GoalControls onManageAreas={() => setShowManageAreas(true)} />
            </div>
          )}
          {goalsTab && goalsViewMode === 'timeline' ? (
            <div className="flex-1 overflow-y-auto px-3 pb-24">
              {roadmap}
            </div>
          ) : (
            <MobileDashboard
              tab={sidebarTab}
              onTabChange={setSidebarTab}
              goals={sortedGoals}
              allGoals={sortedAllGoals}
              activeProjects={activeProjects}
              standaloneProjects={shownStandalone}
              openCount={openStandalone.length}
              completedCount={completedStandalone.length}
              projectsFilter={projectsFilter}
              onProjectsFilterChange={setProjectsFilter}
              projectQuery={projectQuery}
              onProjectQueryChange={setProjectQuery}
              onEditGoal={onEditGoal}
              onEditProject={onEditProject}
              onNewProject={onNewProject}
              isActive={isActive}
              controlsCollapsed={controlsCollapsed}
              onPageGoalChange={setMobilePageGoalId}
            />
          )}
          {fabStack('absolute bottom-4 right-4')}
          </div>
          <ArchivedSection archivedGoals={archivedGoals} archivedProjects={archivedProjects} onReviewProject={setReviewProjectId} stacked />
        </div>
        {formOverlays}
        {showAspire && <AspireModal onClose={() => setShowAspire(false)} />}
      </>
    );
  }

  // ── Desktop mode: the Goals & Projects space (sidebar + main area) ────────
  const emptyState = (title, hint, cta) => (
    <div className="relative z-10 flex flex-col items-center justify-center py-16 gap-3">
      <div className={`w-14 h-14 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-700' : 'bg-stone-100'}`}>
        <GitBranch size={28} className={textSecondary} />
      </div>
      <p className={`text-sm font-medium ${textPrimary}`}>{title}</p>
      {hint && <p className={`text-xs ${textSecondary} text-center max-w-xs`}>{hint}</p>}
      {cta}
    </div>
  );

  return (
    <>
      <GoalSpaceSidebar
        tab={sidebarTab}
        onTabChange={setSidebarTab}
        goals={sortedGoals}
        goalCount={activeGoals.length}
        selectedGoalId={selectedGoal?.id ?? null}
        onSelectGoal={selectGoal}
        standaloneProjects={shownStandalone}
        standaloneCount={openStandalone.length}
        focusedProjectId={focusedProjectId}
        onProjectRowClick={focusProject}
        projectQuery={projectQuery}
        onProjectQueryChange={setProjectQuery}
        filterInputRef={filterInputRef}
        drag={drag}
        onManageAreas={() => setShowManageAreas(true)}
      />

      {/* border-x like the calendar area, so the divider between the sidebar and
          the main area is the same 2px it is in the Calendar space. */}
      <div data-goals-main className={`flex-1 min-w-0 flex flex-col min-h-0 ${cardBg} border-x ${borderClass}`}>
        {/* Toolbar: List | Roadmap on the Goals tab, Open | Completed on the
            Projects tab. Creating things lives in the "+" (a choice of a
            project in the goal on screen or a new goal on the Goals tab, Add
            Project on Projects), the goal card ("+ Add") and Manage Areas
            ("Add area").
            content-box height: the row is 46px PLUS its border, exactly like
            the sidebar's tab row, so the two bottom lines meet. */}
        <div className={`flex items-center gap-3 px-5 border-b ${borderClass} flex-shrink-0`} style={{ height: 'var(--header-row-h)', boxSizing: 'content-box' }}>
          {goalsTab ? (
            <ViewToggle />
          ) : (
            <ProjectsStatusToggle
              value={projectsFilter}
              onChange={setProjectsFilter}
              openCount={openStandalone.length}
              completedCount={completedStandalone.length}
            />
          )}
          <div className="flex-1" />
          {/* Right side: the Roadmap's Range, or the card size where there
              are cards to size (List and Projects). */}
          {goalsTab && goalsViewMode === 'timeline'
            ? <GoalRangeToggle value={roadmapPeriod} onChange={setRoadmapPeriod} />
            : <CardSizeToggle />}
        </div>

        {/* The main area scrolls on its own; the sidebar, header and the
            Archived footer stay put. The FAB column floats over the scroll
            area's bottom-right corner (above the Archived footer), the way the
            calendar's + / Frames FABs float over the timeline; the content has
            bottom padding so the last row can scroll clear of it. */}
        <div className="relative flex-1 min-h-0 flex flex-col">
        <div className={`flex-1 overflow-y-auto overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''}`}>
          <div className="p-6 pb-28">
            {goalsTab ? (
              goalsViewMode === 'timeline' ? roadmap
              : selectedGoal ? (
                <GoalListView
                  goal={selectedGoal}
                  goalProjects={selectedGoalProjects}
                  drag={drag}
                  goalCardRefs={goalCardRefs}
                  projectCardRefs={projectCardRefs}
                  onEditGoal={onEditGoal}
                  onEditProject={onEditProject}
                  onNewProject={onNewProject}
                  onMoveToClick={setMoveToProject}
                  focusedProjectId={focusedProjectId}
                />
              ) : emptyState(t('goals.noGoalsYet'), t('goals.emptyHint'))
            ) : shownStandalone.length > 0 ? (
              <ProjectCardGroup
                projects={shownStandalone}
                goalId={null}
                drag={drag}
                projectCardRefs={projectCardRefs}
                onEditProject={onEditProject}
                onMoveToClick={setMoveToProject}
                justify="start"
                focusedProjectId={focusedProjectId}
              />
            ) : projectQuery.trim() ? emptyState(
              t('goals.noProjectsMatch'),
              null,
              null
            ) : projectsFilter === 'completed' ? emptyState(
              t('goals.noCompletedProjects'),
              null,
              null
            ) : emptyState(
              t('goals.noStandaloneProjects'),
              null,
              <button type="button" onClick={() => onNewProject(null)} className="flex items-center gap-1.5 text-sm text-emerald-500 hover:text-emerald-600 transition-colors">
                <Layers size={14} /> {t('goals.addStandaloneProject')}
              </button>
            )}
          </div>
        </div>
        {/* FABs — stacked bottom-right like the timeline's; the + is contextual
            to the tab (Add Goal / Add Project, also `n`). Add more above it. */}
        {fabStack('absolute bottom-6 right-6')}
        </div>
        <ArchivedSection archivedGoals={archivedGoals} archivedProjects={archivedProjects} onReviewProject={setReviewProjectId} grid anchored />
      </div>

      {formOverlays}

      {showAspire && <AspireModal onClose={() => setShowAspire(false)} />}

      {/* "Move to…" picker (desktop presentation of the phone's bottom sheet) */}
      {moveToProject && (
        <FormOverlay onClose={() => setMoveToProject(null)} mobile={false} cardBg={cardBg}>
          <div onClick={e => e.stopPropagation()} className={`${cardBg} rounded-2xl shadow-2xl w-full max-w-sm p-5 flex flex-col gap-3`}>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-semibold ${textPrimary} truncate min-w-0`}>
                {t('goals.moveProjectTo', { project: moveToProject.title })}
              </span>
              <button type="button" onClick={() => setMoveToProject(null)} className={`p-1 rounded-lg ${hoverBg} flex-shrink-0`} aria-label={t('common.close')}>
                <X size={16} className={textSecondary} />
              </button>
            </div>
            <MoveToList
              project={moveToProject}
              goals={sortedAllGoals}
              onMove={(goalId) => { moveProject(moveToProject.id, goalId); setMoveToProject(null); }}
            />
          </div>
        </FormOverlay>
      )}
    </>
  );
};

export default GoalDashboard;
