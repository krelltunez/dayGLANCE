import { describe, it, expect } from 'vitest';
import { preserveArchived } from './preserveArchived.js';

// The applyEngineData second-pass strip: a merged/remote copy that OMITS `archived`
// must not silently un-archive a locally-archived item (which also caused the
// re-stamp/push churn). A real remote unarchive (archived:false explicit) still wins.

describe('preserveArchived', () => {
  it('back-fills archived:true when the incoming copy omits it (the churn fix)', () => {
    const existing = [{ id: 'a', archived: true }];
    const incoming = [{ id: 'a', title: 'x' }]; // merged row dropped archived
    expect(preserveArchived(incoming, existing)).toEqual([{ id: 'a', title: 'x', archived: true }]);
  });

  it('does NOT override an explicit remote unarchive (archived:false propagates)', () => {
    const existing = [{ id: 'a', archived: true }];
    const incoming = [{ id: 'a', title: 'x', archived: false }];
    expect(preserveArchived(incoming, existing)[0].archived).toBe(false);
  });

  it('leaves a never-archived item alone (no archived key injected)', () => {
    const existing = [{ id: 'a' }];
    const incoming = [{ id: 'a', title: 'x' }];
    const out = preserveArchived(incoming, existing);
    expect('archived' in out[0]).toBe(false);
  });

  it('carries a local archived:false forward when incoming omits it', () => {
    // Local explicitly un-archived; incoming (older) lacks the flag → keep local false.
    const existing = [{ id: 'a', archived: false }];
    const incoming = [{ id: 'a', title: 'x' }];
    expect(preserveArchived(incoming, existing)[0].archived).toBe(false);
  });

  it('an incoming archived:true is kept even if local lacks it', () => {
    const existing = [{ id: 'a' }];
    const incoming = [{ id: 'a', archived: true }];
    expect(preserveArchived(incoming, existing)[0].archived).toBe(true);
  });

  it('matches by id across both lists (scheduled↔inbox move) and ignores unmatched', () => {
    const existing = [{ id: 'sched-1', archived: true }, { id: 'inbox-9', archived: true }];
    const incoming = [{ id: 'inbox-9', title: 'moved' }, { id: 'new-1', title: 'fresh' }];
    const out = preserveArchived(incoming, existing);
    expect(out[0].archived).toBe(true);          // matched → healed
    expect('archived' in out[1]).toBe(false);     // no local match → untouched
  });

  it('handles empty/undefined inputs without throwing', () => {
    expect(preserveArchived(undefined, undefined)).toEqual([]);
    expect(preserveArchived([], [{ id: 'a', archived: true }])).toEqual([]);
    expect(preserveArchived([{ id: 'a' }], undefined)).toEqual([{ id: 'a' }]);
  });

  it('the 24-item repro: all locally-archived items survive a merge that dropped archived', () => {
    const ids = Array.from({ length: 24 }, (_, i) => `id-${i}`);
    const existing = ids.map((id) => ({ id, completed: true, archived: true }));
    const incoming = ids.map((id) => ({ id, completed: true })); // vault row without archived
    const out = preserveArchived(incoming, existing);
    expect(out.every((t) => t.archived === true)).toBe(true);
  });
});
