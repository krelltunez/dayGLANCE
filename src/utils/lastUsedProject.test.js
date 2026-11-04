import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LAST_USED_PROJECT_KEY, pinnedLastUsedProject, readLastUsedProject, rememberLastUsedProject } from './lastUsedProject.js';
import { NEW_PROJECT_ID } from './pendingProject.js';

// #2274: the last project a task was saved with from the editor, a
// preference of this device that the project picker pins on top.
const store = new Map();
beforeEach(() => {
  store.clear();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
});
afterEach(() => { delete globalThis.localStorage; });

describe('the last used project', () => {
  it('nothing remembered reads as none', () => {
    expect(readLastUsedProject()).toBeNull();
  });

  it('remembers the latest project saved, under one device key', () => {
    rememberLastUsedProject('p-api');
    rememberLastUsedProject('p-docs');
    expect(readLastUsedProject()).toBe('p-docs');
    expect([...store.keys()]).toEqual([LAST_USED_PROJECT_KEY]);
  });

  it('a task saved with no project, or the "New project…" placeholder, leaves it as it was', () => {
    rememberLastUsedProject('p-api');
    rememberLastUsedProject(null);
    rememberLastUsedProject('');
    rememberLastUsedProject(NEW_PROJECT_ID);
    expect(readLastUsedProject()).toBe('p-api');
  });

  it('without storage, nothing is remembered and nothing breaks', () => {
    globalThis.localStorage = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(() => rememberLastUsedProject('p-api')).not.toThrow();
    expect(readLastUsedProject()).toBeNull();
  });
});

describe('pinnedLastUsedProject', () => {
  const projects = [
    { id: 'p-api', title: 'API' },
    { id: 'p-old', title: 'Old', status: 'archived' },
    { id: 'p-done', title: 'Done', status: 'completed' },
  ];

  it('pins a project that still exists and is listed', () => {
    expect(pinnedLastUsedProject('p-api', projects)).toBe(projects[0]);
  });

  it('pins nothing for a project since deleted, archived or completed, or for none', () => {
    expect(pinnedLastUsedProject('p-gone', projects)).toBeNull();
    expect(pinnedLastUsedProject('p-old', projects)).toBeNull();
    expect(pinnedLastUsedProject('p-done', projects)).toBeNull();
    expect(pinnedLastUsedProject(null, projects)).toBeNull();
    expect(pinnedLastUsedProject('p-api')).toBeNull();
  });
});
