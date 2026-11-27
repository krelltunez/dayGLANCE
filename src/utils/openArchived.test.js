// An open task is never archived (2026-11-27 field report: two open Inbox
// tasks carried `archived: true` and were visible nowhere but the collapsed
// Archived bar). The helpers, the reopen paths and the Inbox filter that
// reads the result.
import { describe, it, expect } from 'vitest';
import { unarchiveOpenTasks, repairTaskRows, reopenTask, detachOpenFromArchivedProjects } from './referentialIntegrity.js';
import { planProjectStatusChange } from './archiveCascade.js';
import { applySetCompletion, applyUndoOps } from './taskMutations.js';
import { filterInboxTasks, knownProjectIdsOf, hasMissingProject, inboxFromStorage } from './inboxFilter.js';
import { stampTimestamps } from './stampTimestamps.js';

const NOW = '2026-11-27T18:00:00.000Z';
const OLD = '2026-11-01T00:00:00.000Z';
const task = (id, extra = {}) => ({ id, title: id, notes: '', subtasks: [], completed: false, lastModified: OLD, ...extra });
const ids = (list) => list.map((t) => t.id);

describe('unarchiveOpenTasks', () => {
  it('clears archived on an open task with an explicit false, unstamped', () => {
    const [row] = unarchiveOpenTasks([task('a', { archived: true })]);
    expect(row.archived).toBe(false);
    expect(row.lastModified).toBe(OLD);
  });

  it('leaves completed archived tasks, unarchived tasks and holes alone, keeping the array identity', () => {
    const rows = [task('done', { completed: true, archived: true }), task('open'), task('f', { archived: false }), null];
    expect(unarchiveOpenTasks(rows)).toBe(rows);
  });

  it('is idempotent', () => {
    const once = unarchiveOpenTasks([task('a', { archived: true })]);
    expect(unarchiveOpenTasks(once)).toBe(once);
  });

  it('repairTaskRows composes it with the tombstone strip', () => {
    const [row] = repairTaskRows([task('a', { archived: true, projectId: 'gone' })], { gone: NOW });
    expect(row).not.toHaveProperty('projectId');
    expect(row.archived).toBe(false);
  });

  it('the save pass reads the repair as no edit: storage written after the repair, nothing re-stamps', () => {
    const repaired = unarchiveOpenTasks([task('a', { archived: true })]);
    // useDataPersistence writes the repaired list back before the save pass compares.
    const [stamped] = stampTimestamps(repaired, repaired, NOW);
    expect(stamped.lastModified).toBe(OLD);
    // And a stored copy that never had the key compares equal to the explicit false.
    const [fromAbsent] = stampTimestamps(repaired, [task('a')], NOW);
    expect(fromAbsent.lastModified).toBe(OLD);
  });
});

describe('a reopen clears a leftover archive', () => {
  it('reopenTask: explicit false only on a reopen, and nothing else when the project is live', () => {
    const done = task('a', { completed: true, archived: true, projectId: 'p1' });
    const live = [{ id: 'p1', status: 'active' }];
    expect(reopenTask(done, { ...done, completed: false }, live)).toEqual({ ...done, completed: false, archived: false });
    const open = task('b');
    const completing = { ...open, completed: true };
    expect(reopenTask(open, completing, live)).toBe(completing);
  });

  it('reopenTask: unknown projects unlink nothing', () => {
    const done = task('a', { completed: true, projectId: 'p1' });
    expect(reopenTask(done, { ...done, completed: false }, null)).toMatchObject({ projectId: 'p1', lastModified: OLD });
  });

  it('MCP set_task_completion(false) on an auto-archived inbox task makes it visible in the Inbox again', () => {
    const archived = task('u1', { completed: true, completedAt: '2026-11-01T09:00:00-07:00', archived: true });
    const r = applySetCompletion({ tasks: [], unscheduledTasks: [archived] }, { taskId: 'u1', completed: false, nowIso: NOW });
    expect(r.task).toMatchObject({ completed: false, completedAt: null, archived: false });
    expect(ids(filterInboxTasks(r.unscheduledTasks))).toEqual(['u1']);
  });

  it('MCP set_task_completion(false) on a scheduled task writes the same explicit false', () => {
    const r = applySetCompletion({ tasks: [task('b1', { date: '2026-11-27', completed: true, archived: true })], unscheduledTasks: [] },
      { taskId: 'b1', completed: false, nowIso: NOW });
    expect(r.task.archived).toBe(false);
  });

  it('completing does not touch archived', () => {
    const r = applySetCompletion({ tasks: [], unscheduledTasks: [task('u1')] }, { taskId: 'u1', completed: true, nowIso: NOW });
    expect(r.task).not.toHaveProperty('archived');
  });

  it('undoing an MCP completion of an archived task reopens it unarchived', () => {
    const state = { tasks: [], unscheduledTasks: [task('u1', { completed: true, completedAt: NOW, archived: true })], recurringTasks: [], recycleBin: [] };
    const r = applyUndoOps(state, [{ kind: 'restore_completion', taskId: 'u1', before: { completed: false, completedAt: null } }], { nowIso: NOW });
    expect(r.unscheduledTasks[0]).toMatchObject({ completed: false, archived: false });
  });
});

describe('a reopen in an archived project unlinks the task', () => {
  const archivedProject = {
    id: 'p1', status: 'archived',
    archiveRecord: { priorStatus: 'active', archivedAt: OLD, archivedTaskIds: ['u1'], detachedTaskIds: [] },
  };
  const hidden = task('u1', { completed: true, completedAt: '2026-10-30T09:00:00-07:00', archived: true, projectId: 'p1' });

  it('reopenTask removes the key and stamps the edit', () => {
    const r = reopenTask(hidden, { ...hidden, completed: false, completedAt: null }, [archivedProject], NOW);
    expect(r).not.toHaveProperty('projectId');
    expect(r).toMatchObject({ completed: false, archived: false, lastModified: NOW });
  });

  it('MCP set_task_completion(false): the task leaves the archived project and shows in the Inbox', () => {
    const r = applySetCompletion({ tasks: [], unscheduledTasks: [hidden], projects: [archivedProject] },
      { taskId: 'u1', completed: false, nowIso: NOW });
    expect(r.task).not.toHaveProperty('projectId');
    expect(r.task.lastModified).toBe(NOW);
    const known = knownProjectIdsOf([archivedProject], { goalsProjectsEnabled: true });
    expect(ids(filterInboxTasks(r.unscheduledTasks, { goalsProjectsEnabled: true, knownProjectIds: known }))).toEqual(['u1']);
  });

  it('undoing an MCP completion in an archived project unlinks it too', () => {
    const state = { tasks: [], unscheduledTasks: [hidden], recurringTasks: [], recycleBin: [], projects: [archivedProject] };
    const r = applyUndoOps(state, [{ kind: 'restore_completion', taskId: 'u1', before: { completed: false, completedAt: null } }], { nowIso: NOW });
    expect(r.unscheduledTasks[0]).not.toHaveProperty('projectId');
    expect(r.unscheduledTasks[0]).toMatchObject({ completed: false, archived: false });
  });

  it('restoring the project reattaches it', () => {
    const reopened = reopenTask(hidden, { ...hidden, completed: false, completedAt: null }, [archivedProject], NOW);
    const plan = planProjectStatusChange(archivedProject, { status: 'active' }, [reopened], '2026-11-28T00:00:00.000Z');
    const [row] = plan.rowsUpdater([reopened]);
    expect(row).toMatchObject({ projectId: 'p1', archived: false, lastModified: '2026-11-28T00:00:00.000Z' });
  });

  it('restoring the project leaves a reopened task the user has since moved to another project', () => {
    const reopened = reopenTask(hidden, { ...hidden, completed: false, completedAt: null }, [archivedProject], NOW);
    const moved = { ...reopened, projectId: 'p2', lastModified: '2026-11-27T19:00:00.000Z' };
    const plan = planProjectStatusChange(archivedProject, { status: 'active' }, [moved], '2026-11-28T00:00:00.000Z');
    const rows = [moved];
    const out = plan.rowsUpdater(rows);
    expect(out[0]).toEqual(moved);
    expect(out).toBe(rows);
  });

  it('a project that is merely completed keeps its reopened task', () => {
    const r = reopenTask(hidden, { ...hidden, completed: false }, [{ ...archivedProject, status: 'completed' }], NOW);
    expect(r.projectId).toBe('p1');
  });
});

describe('a task whose project this device does not hold', () => {
  const projects = [{ id: 'p1', title: 'Live' }];
  const known = knownProjectIdsOf(projects, { goalsProjectsEnabled: true });

  it('shows in the Inbox as standalone with the default filters', () => {
    const list = [task('orphan', { projectId: 'gone' }), task('live', { projectId: 'p1' }), task('plain')];
    const shown = filterInboxTasks(list, { goalsProjectsEnabled: true, knownProjectIds: known });
    expect(ids(shown)).toEqual(['orphan', 'plain']);
    expect(hasMissingProject(list[0], known)).toBe(true);
    expect(hasMissingProject(list[1], known)).toBe(false);
  });

  it('is judged missing only when the judgement is safe: not before data loads, not with no projects, not with the feature off', () => {
    expect(knownProjectIdsOf(projects, { goalsProjectsEnabled: true, loaded: false })).toBeNull();
    expect(knownProjectIdsOf([], { goalsProjectsEnabled: true })).toBeNull();
    expect(knownProjectIdsOf(projects, { goalsProjectsEnabled: false })).toBeNull();
    const list = [task('t', { projectId: 'p-not-yet-synced' })];
    // A fresh device with no projects yet hides the task as a project task, as before.
    expect(filterInboxTasks(list, { goalsProjectsEnabled: true, knownProjectIds: knownProjectIdsOf([], { goalsProjectsEnabled: true }) })).toEqual([]);
  });

  it('a project filter never matches it, and "hide standalone" hides it', () => {
    const list = [task('orphan', { projectId: 'gone' })];
    expect(filterInboxTasks(list, { goalsProjectsEnabled: true, knownProjectIds: known, liveProjectFilter: ['p1'] })).toEqual([]);
    expect(filterInboxTasks(list, { goalsProjectsEnabled: true, knownProjectIds: known, hideStandaloneTasksInbox: true })).toEqual([]);
  });

  it('the stored-state chain (launcher count) counts it the same way', () => {
    const storage = { getItem: () => null };
    const list = [task('orphan', { projectId: 'gone' })];
    expect(ids(inboxFromStorage({ unscheduledTasks: list, projects, goalsProjectsEnabled: true, storage }))).toEqual(['orphan']);
  });
});

describe('detachOpenFromArchivedProjects', () => {
  const projects = [{ id: 'pA', status: 'archived' }, { id: 'pLive', status: 'active' }];

  it('detaches open tasks from an archived project, unstamped; completed ones and live projects stay', () => {
    const rows = [task('o', { projectId: 'pA' }), task('c', { projectId: 'pA', completed: true }), task('l', { projectId: 'pLive' })];
    const out = detachOpenFromArchivedProjects(rows, projects);
    expect(out[0]).not.toHaveProperty('projectId');
    expect(out[0].lastModified).toBe(OLD);
    expect(out[1]).toBe(rows[1]);
    expect(out[2]).toBe(rows[2]);
  });

  it('keeps the array when nothing changes, when projects are unknown, and is idempotent', () => {
    const rows = [task('o', { projectId: 'pA' })];
    expect(detachOpenFromArchivedProjects(rows, null)).toBe(rows);
    expect(detachOpenFromArchivedProjects(rows, [{ id: 'pA', status: 'active' }])).toBe(rows);
    const once = detachOpenFromArchivedProjects(rows, projects);
    expect(detachOpenFromArchivedProjects(once, projects)).toBe(once);
  });

  it('repairTaskRows runs it when given projects, and the save pass reads it as no edit', () => {
    const [row] = repairTaskRows([task('o', { projectId: 'pA' })], null, projects);
    expect(row).not.toHaveProperty('projectId');
    const [stamped] = stampTimestamps([row], [row], NOW);
    expect(stamped.lastModified).toBe(OLD);
  });
});

describe('restoring a project brings back open standalone tasks from its note', () => {
  const NOTE_PATH = 'Goals/Ship/App Store Connect.md';
  const project = { id: 'pA', status: 'archived', obsidianNotePath: NOTE_PATH,
    archiveRecord: { priorStatus: 'completed', archivedAt: OLD, archivedTaskIds: [], detachedTaskIds: [] } };
  const restore = (rows) => planProjectStatusChange(project, { status: 'active' }, rows, NOW).rowsUpdater(rows);

  it('reattaches an open standalone task whose line is in the note, stamped', () => {
    const [row] = restore([task('o', { obsidianNotePath: NOTE_PATH })]);
    expect(row).toMatchObject({ projectId: 'pA', lastModified: NOW });
  });

  it('leaves a task given another project, a completed one, and one from another note', () => {
    const rows = [
      task('moved', { obsidianNotePath: NOTE_PATH, projectId: 'pOther' }),
      task('done', { obsidianNotePath: NOTE_PATH, completed: true }),
      task('elsewhere', { obsidianNotePath: 'Projects/Other.md' }),
    ];
    expect(restore(rows)).toEqual(rows);
  });

  it('a project with no note reattaches only what its record lists', () => {
    const plain = { ...project, obsidianNotePath: undefined };
    const rows = [task('o', { obsidianNotePath: NOTE_PATH })];
    expect(planProjectStatusChange(plain, { status: 'active' }, rows, NOW).rowsUpdater(rows)).toEqual(rows);
  });
});
