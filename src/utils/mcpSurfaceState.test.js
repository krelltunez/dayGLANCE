import { describe, it, expect } from 'vitest';
import { mcpSurfaceState } from './mcpSurfaceState.js';

// The §6.5 bolt state table. Load-bearing: the amber state keeps bulk undo
// reachable after the kill switch (the moment it is most needed), without
// reading as "enabled"; the bolt only disappears once nothing is undoable.

const s = (bound, writesAutoDisabled, journalTotal) =>
  mcpSurfaceState({ bound, writesAutoDisabled, journalTotal });

describe('mcpSurfaceState', () => {
  it('bound + clean journal → green, kill switch available', () => {
    expect(s(true, false, 0)).toEqual({ visible: true, dot: 'green', showKillSwitch: true });
  });

  it('bound + undoable writes → blue', () => {
    expect(s(true, false, 3)).toEqual({ visible: true, dot: 'blue', showKillSwitch: true });
  });

  it('bound + writes auto-disabled → red, outranking blue', () => {
    expect(s(true, true, 0).dot).toBe('red');
    expect(s(true, true, 29)).toEqual({ visible: true, dot: 'red', showKillSwitch: true });
  });

  it('UNBOUND with undoable entries → visible AMBER, never green or blue, and no kill switch', () => {
    const state = s(false, false, 5);
    expect(state).toEqual({ visible: true, dot: 'amber', showKillSwitch: false });
    // the auto-disable flag cannot resurrect bound-state colors while off
    expect(s(false, true, 5)).toEqual({ visible: true, dot: 'amber', showKillSwitch: false });
  });

  it('unbound with an empty journal → hidden entirely (the off state has no surface)', () => {
    expect(s(false, false, 0)).toEqual({ visible: false, dot: null, showKillSwitch: false });
    expect(s(false, true, 0).visible).toBe(false);
  });

  it('the amber exit: undo (or restart) empties the journal and the bolt disappears', () => {
    const during = s(false, false, 2);
    const after = s(false, false, 0);
    expect(during.visible).toBe(true);
    expect(after.visible).toBe(false);
  });
});
