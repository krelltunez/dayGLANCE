import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import useFrameSetActions from './useFrameSetActions.js';

// Dragging a frame into another set (#2335): the action behind the drop. It
// is held to the editor's overlap rule, changes nothing when refused, and is
// one undo step that names where the frame went.

const F = (id, over = {}) => ({ id, label: id, enabled: true, days: [1, 2, 3], start: '09:00', end: '12:00', ...over });
const sets = [{ id: 'work', name: 'Work' }, { id: 'hol', name: 'Holiday' }];

function setup(opts) {
  const { frames } = opts;
  // Not loaded is undefined, so a default parameter would hide it.
  const frameSets = 'frameSets' in opts ? opts.frameSets : sets;
  const state = { frames };
  const deps = {
    frameSets,
    setFrameSets: vi.fn(),
    get gtdFrames() { return state.frames; },
    setGtdFrames: vi.fn((fn) => { state.frames = typeof fn === 'function' ? fn(state.frames) : fn; }),
    getTodayStr: () => '2026-11-08',
    pushUndo: vi.fn(() => 'Moved'),
    setUndoToast: vi.fn(),
    alwaysLabel: 'Always',
  };
  let api;
  function Harness() {
    api = useFrameSetActions({ ...deps, gtdFrames: state.frames });
    return null;
  }
  let root;
  act(() => { root = create(<Harness />); });
  const move = (id, setId) => {
    let result;
    act(() => { result = api.moveFrameToSet(id, setId); });
    act(() => { root.update(<Harness />); });
    return result;
  };
  return { state, deps, move };
}

describe('moveFrameToSet (the drop)', () => {
  it('moves a frame into a set as one undo step that names the set', () => {
    const { state, deps, move } = setup({ frames: [F('free')] });
    expect(move('free', 'hol')).toEqual({ ok: true });
    expect(state.frames[0].setId).toBe('hol');
    expect(deps.pushUndo).toHaveBeenCalledWith({ key: 'frameMoved', title: 'free', set: 'Holiday' });
    expect(deps.setUndoToast).toHaveBeenCalledWith({ message: 'Moved', actionable: true });
  });

  it('into "Always" clears the set, and the undo step says "Always"', () => {
    const { state, deps, move } = setup({ frames: [F('desk', { setId: 'work' })] });
    expect(move('desk', null)).toEqual({ ok: true });
    expect(state.frames[0]).not.toHaveProperty('setId');
    expect(deps.pushUndo).toHaveBeenCalledWith(expect.objectContaining({ set: 'Always' }));
  });

  // Frames in two different sets may overlap; leaving the set makes them
  // meet. MUTATION: drop the overlap check and the clash is saved.
  it('refuses a move into "Always" that would overlap a frame in a set, changing nothing', () => {
    const frames = [F('desk', { setId: 'work' }), F('beach', { setId: 'hol' })];
    const { state, deps, move } = setup({ frames });
    const result = move('beach', null);
    expect(result.ok).toBe(false);
    expect(result.overlap.frame.id).toBe('desk');
    expect(result.overlap.days).toEqual([1, 2, 3]);
    expect(state.frames).toBe(frames);
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.setGtdFrames).not.toHaveBeenCalled();
  });

  it('refuses a move into a set that holds an overlapping frame', () => {
    const { move } = setup({ frames: [F('desk', { setId: 'work' }), F('beach', { setId: 'hol' })] });
    expect(move('beach', 'work')).toMatchObject({ ok: false, overlap: { frame: { id: 'desk' } } });
  });

  it('allows a move between two sets when the frames only overlap across them', () => {
    const { state, move } = setup({ frames: [F('desk', { setId: 'work' }), F('beach', { setId: 'hol' }), F('late', { setId: 'hol', start: '13:00', end: '14:00' })] });
    expect(move('late', 'work')).toEqual({ ok: true });
    expect(state.frames[2].setId).toBe('work');
  });

  it('a drop on the section it is already in does nothing', () => {
    const { deps, move } = setup({ frames: [F('desk', { setId: 'work' })] });
    expect(move('desk', 'work')).toEqual({ ok: true });
    expect(deps.pushUndo).not.toHaveBeenCalled();
    expect(deps.setGtdFrames).not.toHaveBeenCalled();
  });

  it('refuses while the sets could not be read, and for an unknown frame or set', () => {
    expect(setup({ frames: [F('free')], frameSets: undefined }).move('free', 'work')).toEqual({ ok: false });
    expect(setup({ frames: [F('free')] }).move('gone', 'work')).toEqual({ ok: false });
    expect(setup({ frames: [F('free')] }).move('free', 'nope')).toEqual({ ok: false });
  });
});
