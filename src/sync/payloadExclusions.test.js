import { describe, it, expect } from 'vitest';
import { keepImportedTask, isPayloadExcludedEntity } from './payloadExclusions.js';

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
