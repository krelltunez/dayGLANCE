// BRIDGE STREAM, app side — inbound TASK-CREATE actions (companion spec
// 4.2.1, "Add to dayGLANCE" in Obsidian).
//
// The plugin turns a selection in a note into ONE inbox task by writing a
// `task_create` action row (BRIDGE_CREATE_ACTION_PREFIX, sealed under the
// pairing subkey like the sidebar's completion). dayGLANCE stays the only
// writer of the account's data plane: a running app builds the task through
// its own state, and DB sync carries it from there.
//
// WHO CONSUMES. Unlike task_complete (consumed inside the Obsidian cycle,
// which only a device with the vault folder runs), a create needs no vault:
// ANY paired device holding the account key applies it, a phone without
// folder access included (useBridgeTaskCreates). Its rows live under their
// own prefix and are read under their OWN cursor (CREATE_HWM_KEY), so the
// two consumers never see each other's rows: a folderless device consuming
// creates cannot move the completion cursor past a completion a folder
// device has yet to apply, and the completion consumer (which treats an
// unknown `act:` type as stale and deletes it) never sees a create.
//
// THE RULES, each covered by tests:
//  • ONE TASK PER ACTION, on any number of devices. The task's id is derived
//    from the actionId (bridgeCreatedTaskId): two devices applying the same
//    row build the same id, and sync merges them into one. The prefix is not
//    `obsidian-`, so nothing that reads an Obsidian-import id (the ghost-row
//    containment, the writeback target, the deletion keys) mistakes it for one.
//  • A PLAIN APP TASK. No importSource, obsidianBlockId, obsidianNotePath or
//    obsidianFileDate: the note-scoped deletion inference, the vault
//    writeback and the Obsidian merges treat it like a task typed into the
//    app. The `#obsidian` tag is stripped from the title (outside the links):
//    in dayGLANCE it means "write this line to today's daily note", which is
//    not what selecting text in a note asked for.
//  • NO RESURRECTION. An id that is tombstoned (deletedTaskIds, or the
//    Obsidian deletion keys), in the recycle bin, or retired onto a successor
//    is consumed without applying. A task that exists in any list is not
//    created again. And the task is stamped with the action's own time, not
//    the applying device's: a deletion made anywhere after the task first
//    appeared is newer, so a late device's copy loses to it in every merge
//    (dropResurrectedTasks, mergeArrayById) even before it hears of it.
//  • DELETE AFTER SAVE. A pass adds the task to state and leaves the row on
//    the stream (held: the cursor stops below it). A later pass deletes the
//    row only once the task reads back from the saved task lists, so a crash
//    between the apply and the save replays the action instead of losing the
//    task. The hook runs that pass a few seconds after the apply, past the
//    push-on-write debounce, so normally the task has also been pushed.
//  • TOO OLD TO TRUST. A row older than the tombstone window (60 days) is
//    consumed unapplied: a deletion that old is no longer remembered, so the
//    no-resurrection rule could not be kept, and the file tier's fence would
//    drop the task as a zombie anyway.

import { BRIDGE_CREATE_ACTION_PREFIX } from '@glance-apps/obsidian-format';
import { tombstoneCutoff } from '@glance-apps/dayglance-vault';
import { fetchBridgeActionRows, commitBridgeActionCursor, deleteBridgeActions } from './obsidianBridgeActions.js';
import { readRetiredTaskIds, resolveRetirement } from './retiredTaskIds.js';
import { TASK_COLORS } from './colorUtils.js';

export const CREATE_HWM_KEY = 'dayglance-bridge-act-create-hwm';
export const TASK_CREATE_TYPE = 'task_create';
// Not `obsidian-…`: see the header.
export const BRIDGE_CREATED_ID_PREFIX = 'bridge-add-';
const DEFAULT_DURATION = 30;
const SAVED_LIST_KEYS = ['day-planner-tasks', 'day-planner-unscheduled', 'day-planner-recurring-tasks', 'day-planner-recycle-bin'];

/** The created task's id for an actionId, or null when the actionId is not one a plugin mints. */
export function bridgeCreatedTaskId(actionId) {
  const s = typeof actionId === 'string' ? actionId : '';
  return /^[A-Za-z0-9-]{8,64}$/.test(s) ? `${BRIDGE_CREATED_ID_PREFIX}${s}` : null;
}

// A wikilink, kept whole, or something the title must not carry outside one.
const LINK_OR_STRIP = /(\[\[[^\]]*\]\])|(^|\s)(?:#obsidian\b|\^dg-[a-z0-9]+(?=\s|$))/gi;

/**
 * The title as the task carries it: one line, trimmed, without the
 * `#obsidian` command tag or a stray `^dg-` token (both only outside the
 * wikilinks, so a link to a stamped line keeps its block part). '' when
 * nothing is left.
 */
export function sanitizeBridgeTaskTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(LINK_OR_STRIP, (all, link, lead) => (link ? link : lead))
    .replace(/\s+/g, ' ')
    .trim();
}

const validDeadline = (d) => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
};
const validPriority = (p) => (Number.isInteger(p) && p >= 0 && p <= 3 ? p : 0);
const activeProject = (projectId, projects) => {
  if (projectId == null || projectId === '') return null;
  const p = (projects || []).find((x) => x && String(x.id) === String(projectId));
  return p && !p.deleted && p.status !== 'archived' && p.status !== 'completed' ? p : null;
};
// The vault is one person's capture surface (companion 4.2 decision 10): a
// task captured there is the vault viewer's. The plugin names its viewer;
// it is used only for a live member of a multi-user account.
const viewerToAssign = (viewer, { users, multiUserEnabled }) => {
  if (!multiUserEnabled || typeof viewer !== 'string' || !viewer) return null;
  return (users || []).some((u) => u && !u.deleted && String(u.syncId ?? u.id) === viewer) ? viewer : null;
};

/**
 * The inbox task a valid action creates, built the way the app builds one
 * (useTaskActions' add to the Inbox), or null when the action is unusable.
 */
export function buildBridgeCreatedTask(action, { projects = [], users = [], multiUserEnabled = false, nowMs = Date.now() } = {}) {
  if (!action || action.type !== TASK_CREATE_TYPE) return null;
  const id = bridgeCreatedTaskId(action.actionId);
  const title = sanitizeBridgeTaskTitle(action.title);
  if (!id || !title) return null;
  const createdMs = Date.parse(action.createdAt);
  const known = Number.isFinite(createdMs);
  const deadline = validDeadline(action.deadline);
  const project = activeProject(action.projectId, projects);
  const viewer = viewerToAssign(action.viewer, { users, multiUserEnabled });
  return {
    id,
    title,
    duration: DEFAULT_DURATION,
    color: TASK_COLORS[0].class,
    completed: false,
    isAllDay: false,
    notes: '',
    subtasks: [],
    priority: validPriority(action.priority),
    ...(deadline ? { deadline } : {}),
    ...(project ? { projectId: project.id } : {}),
    ...(viewer ? { assignedUserSyncIds: [viewer] } : {}),
    // When the user made it, as the plugin wrote it, so every device that
    // applies the action builds the same row. Unknown: the persist pass
    // stamps it, as for any task created here.
    ...(known ? { createdAt: action.createdAt } : {}),
    // The action's instant, never later than now (a fast clock elsewhere):
    // see NO RESURRECTION in the header.
    lastModified: new Date(known ? Math.min(createdMs, nowMs) : nowMs).toISOString(),
  };
}

const listHas = (list, id) => (list || []).some((t) => t && String(t.id) === id);

/**
 * Sort a batch into { apply, hold, consume } (pure).
 *  apply   [{ action, task }]  create the task now; the row is held too
 *  hold    [action]            leave the row on the stream, cursor below it
 *  consume [{ action, reason }]  delete the row; nothing (more) to do
 * `persistedIds` are the ids in the SAVED task lists (readSavedTaskIds).
 */
export function planBridgeTaskCreates(actions, {
  tasks = [], unscheduledTasks = [], recurringTasks = [], recycleBin = [],
  deletedTaskIds = {}, deletedObsidianKeys = {}, isRetired = null,
  persistedIds = new Set(), projects = [], users = [], multiUserEnabled = false,
  nowMs = Date.now(),
} = {}) {
  const apply = [], hold = [], consume = [];
  const cutoffMs = tombstoneCutoff(nowMs).getTime();
  for (const a of actions || []) {
    if (!a || a.type !== TASK_CREATE_TYPE) { consume.push({ action: a, reason: 'invalid' }); continue; }
    const id = bridgeCreatedTaskId(a.actionId);
    if (!id || !sanitizeBridgeTaskTitle(a.title)) { consume.push({ action: a, reason: 'invalid' }); continue; }
    if ((deletedTaskIds && deletedTaskIds[id]) || (deletedObsidianKeys && deletedObsidianKeys[id])) { consume.push({ action: a, reason: 'tombstoned' }); continue; }
    if (listHas(recycleBin, id)) { consume.push({ action: a, reason: 'binned' }); continue; }
    if (typeof isRetired === 'function' && isRetired(id)) { consume.push({ action: a, reason: 'retired' }); continue; }
    if (listHas(tasks, id) || listHas(unscheduledTasks, id) || listHas(recurringTasks, id)) {
      // Created already (here, or by a device that synced it here): the row
      // goes once the task is in the saved lists, not before.
      if (persistedIds.has(id)) consume.push({ action: a, reason: 'saved' });
      else hold.push(a);
      continue;
    }
    const created = Date.parse(a.createdAt || '');
    if (Number.isFinite(created) && created < cutoffMs) { consume.push({ action: a, reason: 'expired' }); continue; }
    const task = buildBridgeCreatedTask(a, { projects, users, multiUserEnabled, nowMs });
    if (!task) { consume.push({ action: a, reason: 'invalid' }); continue; }
    apply.push({ action: a, task });
    hold.push(a);
  }
  return { apply, hold, consume };
}

/** Append the created tasks a list lacks. Returns the SAME array when nothing is added. */
export function addBridgeCreatedTasks(list, created) {
  if (!Array.isArray(list) || !created?.length) return list;
  const have = new Set(list.filter(Boolean).map((t) => String(t.id)));
  const add = created.filter((t) => t && !have.has(String(t.id)));
  return add.length ? [...list, ...add] : list;
}

/** Every task id in the lists the persist pass has saved (what survives a restart). */
export function readSavedTaskIds() {
  const ids = new Set();
  for (const key of SAVED_LIST_KEYS) {
    try {
      const list = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(list)) for (const t of list) if (t && t.id != null) ids.add(String(t.id));
    } catch { /* an unreadable list confirms nothing: its rows stay held */ }
  }
  return ids;
}

const readBundle = (key) => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; } };

/** Task-create rows above this device's own create cursor (null when the stream is unavailable). */
export function fetchBridgeTaskCreates() {
  return fetchBridgeActionRows({ prefix: BRIDGE_CREATE_ACTION_PREFIX, cursorKey: CREATE_HWM_KEY });
}

/**
 * One consumer pass: fetch, plan against the live state and the saved
 * lists, apply, delete what is done, commit the cursor below what is held.
 * `read()` returns { tasks, unscheduledTasks, recurringTasks, recycleBin,
 * projects, users, multiUserEnabled } as they are now; `addToInbox(tasks)`
 * appends to the inbox through the app's setter. Resolves to
 * { applied, held, consumed } or null when the stream was unavailable.
 */
export async function runBridgeTaskCreatePass({ read, addToInbox, nowMs = Date.now() }) {
  const fetched = await fetchBridgeTaskCreates();
  if (!fetched) return null;
  const retired = readRetiredTaskIds();
  const plan = planBridgeTaskCreates(fetched.actions, {
    ...read(),
    deletedTaskIds: readBundle('day-planner-deleted-task-ids'),
    deletedObsidianKeys: readBundle('day-planner-deleted-obsidian-keys'),
    isRetired: (id) => !!resolveRetirement(retired, id),
    persistedIds: readSavedTaskIds(),
    nowMs,
  });
  if (plan.apply.length) {
    addToInbox(plan.apply.map((x) => x.task));
    console.info('[Obsidian] task(s) added from Obsidian:', plan.apply.map((x) => x.task.id).join(', '));
  }
  const unapplied = plan.consume.filter((c) => c.reason !== 'saved');
  if (unapplied.length) {
    console.info('[Obsidian] add-task action(s) consumed without creating:',
      unapplied.map((c) => `${c.action?.actionId ?? '?'} (${c.reason})`).join(', '));
  }
  // The rows go only AFTER the cursor math is settled and only for consumed
  // actions; held ones (created but not yet saved) stay listable.
  await deleteBridgeActions(plan.consume.map((c) => c.action).filter((a) => a?.entityId));
  commitBridgeActionCursor(fetched.maxSeq, plan.hold, CREATE_HWM_KEY);
  return { applied: plan.apply.length, held: plan.hold.length, consumed: plan.consume.length };
}
