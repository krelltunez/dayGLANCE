import { describe, it, expect } from 'vitest';
import { keepImportedTask, isPayloadExcludedEntity, isRetentionReleasableEntity } from './payloadExclusions.js';

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

describe('isRetentionReleasableEntity — device-aged-out completed tasks', () => {
  const NOW = Date.parse('2026-07-14T00:00:00Z');
  const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
  const rel = (kind, value, retentionDays = 30) =>
    isRetentionReleasableEntity({ _kind: kind, value }, { retentionDays, now: NOW });

  it('releases completed + archived regardless of age (auto-archived inbox item)', () => {
    // The 85-inbox population: completed + archived, no retention needed.
    expect(rel('unscheduledTasks', { completed: true, archived: true, lastModified: daysAgo(78) })).toBe(true);
    expect(rel('tasks', { completed: true, archived: true, lastModified: daysAgo(1) })).toBe(true);
    // archived even disables the age gate: releases with retentionDays 0.
    expect(rel('unscheduledTasks', { completed: true, archived: true }, 0)).toBe(true);
  });

  it('releases completed tasks aged past the retention window even when not archived', () => {
    // The 150-scheduled population: completed, past retention, NOT archived.
    expect(rel('tasks', { completed: true, completedAt: daysAgo(45) })).toBe(true);
    expect(rel('tasks', { completed: true, lastModified: daysAgo(45) })).toBe(true); // completedAt absent → lastModified
  });

  it('keeps completed tasks still inside the retention window', () => {
    expect(rel('tasks', { completed: true, completedAt: daysAgo(10) })).toBe(false);
    expect(rel('unscheduledTasks', { completed: true, lastModified: daysAgo(29) })).toBe(false);
  });

  it('never releases an active (not-completed) task, however old', () => {
    expect(rel('tasks', { completed: false, archived: true, lastModified: daysAgo(365) })).toBe(false);
    expect(rel('tasks', { archived: true, lastModified: daysAgo(365) })).toBe(false);
    expect(rel('tasks', { completed: true, lastModified: daysAgo(365) })).toBe(true); // control
  });

  it('is scoped to task kinds and disables the age branch when retention is off', () => {
    expect(rel('recycleBin', { completed: true, completedAt: daysAgo(365) })).toBe(false);
    expect(rel('singleton', { completed: true, archived: true })).toBe(false);
    // retentionDays <= 0 (or unset) → only archived qualifies; aged-but-unarchived does not.
    expect(rel('tasks', { completed: true, completedAt: daysAgo(365) }, 0)).toBe(false);
  });

  it('fails safe on unparseable input / timestamps', () => {
    expect(isRetentionReleasableEntity(null, { retentionDays: 30, now: NOW })).toBe(false);
    expect(rel('tasks', null)).toBe(false);
    expect(rel('tasks', { completed: true, completedAt: 'not-a-date' })).toBe(false); // unparseable, unarchived → keep
  });
});
