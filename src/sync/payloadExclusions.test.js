import { describe, it, expect } from 'vitest';
import { keepImportedTask, isPayloadExcludedEntity, agedOutReleaseReason } from './payloadExclusions.js';

describe('payloadExclusions — the shared buildSyncPayload rule', () => {
  it('drops read-only CalDAV imports; keeps task-calendar to-dos and ICS file imports', () => {
    expect(keepImportedTask({ imported: true, importSource: 'caldav' }, false)).toBe(false);
    expect(keepImportedTask({ imported: true, importSource: 'file' }, false)).toBe(true);
    expect(keepImportedTask({ imported: true, isTaskCalendar: true, importSource: 'caldav' }, false)).toBe(true);
    expect(keepImportedTask({ title: 'plain local task' }, false)).toBe(true);
  });

  it('multi-user additionally drops subscription-derived items (per-user CalDAV privacy)', () => {
    const subscriptionTodo = { imported: true, isTaskCalendar: true, importSource: 'sync' };
    expect(keepImportedTask(subscriptionTodo, false)).toBe(true);
    expect(keepImportedTask(subscriptionTodo, true)).toBe(false);
  });

  it('classifies mirror/snapshot wraps: _native + excluded imports, tasks/unscheduledTasks only', () => {
    const excl = (kind, value, mu = false) =>
      isPayloadExcludedEntity({ _kind: kind, value }, { multiUserEnabled: mu });
    expect(excl('tasks', { _native: true })).toBe(true);
    expect(excl('tasks', { imported: true, importSource: 'caldav' })).toBe(true);
    expect(excl('unscheduledTasks', { imported: true, importSource: 'caldav' })).toBe(true);
    expect(excl('unscheduledTasks', { _native: true })).toBe(false); // _native rule is tasks-only, as in buildSyncPayload
    expect(excl('tasks', { title: 'normal' })).toBe(false);
    // Other kinds are never payload-excluded — the rule must not widen silently.
    expect(excl('recycleBin', { imported: true, importSource: 'caldav' })).toBe(false);
    expect(excl('singleton', { imported: true, importSource: 'caldav' })).toBe(false);
  });

  it('fails safe on unparseable input (→ not excluded → conservative glitch handling)', () => {
    expect(isPayloadExcludedEntity(null)).toBe(false);
    expect(isPayloadExcludedEntity('tasks:900')).toBe(false);
    expect(isPayloadExcludedEntity({ _kind: 'tasks' })).toBe(false);
    expect(isPayloadExcludedEntity({ _kind: 'tasks', value: null })).toBe(false);
  });
});

describe('agedOutReleaseReason — the file-tier zombie-drop populations', () => {
  const NOW = Date.parse('2026-07-14T00:00:00Z');
  const HORIZON = NOW - 60 * 86400000; // tombstoneCutoff() epoch ms (60-day fence)
  const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
  const rel = (kind, value, horizonMs = HORIZON) =>
    agedOutReleaseReason({ _kind: kind, value }, { horizonMs });

  it("releases EVERY completed task as 'completed', at any age or archived state", () => {
    // The observed stuck set is 100% completed (85 inbox archived + 65 scheduled
    // not-archived) — the 'completed' branch covers both, no age needed.
    expect(rel('unscheduledTasks', { completed: true, archived: true, lastModified: daysAgo(90) })).toBe('completed');
    expect(rel('tasks', { completed: true, archived: false, lastModified: daysAgo(90) })).toBe('completed'); // the 65 scheduled
    expect(rel('tasks', { completed: true, lastModified: daysAgo(1) })).toBe('completed'); // recent completed still releasable
    expect(rel('unscheduledTasks', { completed: true })).toBe('completed'); // no timestamps needed
  });

  it("releases an incomplete task older than the sync horizon as 'sync-horizon' (the zombie-drop condition)", () => {
    expect(rel('tasks', { completed: false, lastModified: daysAgo(61) })).toBe('sync-horizon');
    expect(rel('unscheduledTasks', { lastModified: daysAgo(120) })).toBe('sync-horizon');
  });

  it('KEEPS an incomplete task newer than the horizon (a genuine transient glitch heals as before)', () => {
    expect(rel('tasks', { completed: false, lastModified: daysAgo(59) })).toBeNull();
    expect(rel('tasks', { lastModified: daysAgo(1) })).toBeNull();
  });

  it('mirrors the zombie-drop: no lastModified on an incomplete row → not horizon-releasable', () => {
    // merge.js only drops a local-only task that HAS a timestamp predating the
    // fence; a row with no lastModified is not a zombie, so we heal it.
    expect(rel('tasks', { completed: false })).toBeNull();
    expect(rel('tasks', { completed: false, lastModified: 'not-a-date' })).toBeNull();
  });

  it('is scoped to task kinds; the horizon branch is skipped without a finite horizon', () => {
    expect(rel('recycleBin', { completed: true })).toBeNull();
    expect(rel('singleton', { lastModified: daysAgo(365) })).toBeNull();
    // No horizon supplied → the horizon branch is inert, but 'completed' still fires.
    expect(agedOutReleaseReason({ _kind: 'tasks', value: { lastModified: daysAgo(365) } }, {})).toBeNull();
    expect(agedOutReleaseReason({ _kind: 'tasks', value: { completed: true } }, {})).toBe('completed');
  });

  it('fails safe on unparseable input', () => {
    expect(agedOutReleaseReason(null, { horizonMs: HORIZON })).toBeNull();
    expect(rel('tasks', null)).toBeNull();
    expect(rel('tasks', undefined)).toBeNull();
  });
});
