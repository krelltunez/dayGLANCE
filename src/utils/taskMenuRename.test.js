import { describe, it, expect, vi } from 'vitest';
import { renameFromMenu, selectTitleWhenReady } from './taskMenuRename.js';

// #2263: the task menu's Rename, one way to rename that works on every
// surface. Inline where the card draws its own rename field, else the editor
// as Edit opens it, with the title selected.

const deps = (over = {}) => ({
  task: { id: 't1', title: 'Paint fence' }, isInbox: false,
  startEditingTask: vi.fn(), openEditor: vi.fn(), selectEditorTitle: vi.fn(), ...over,
});

describe('renameFromMenu', () => {
  it('renames in place where the card draws the field', () => {
    const d = deps({ isInbox: true });
    expect(renameFromMenu({ inlineRename: true }, d)).toBe('inline');
    expect(d.startEditingTask).toHaveBeenCalledWith(d.task, true);
    expect(d.openEditor).not.toHaveBeenCalled();
    expect(d.selectEditorTitle).not.toHaveBeenCalled();
  });

  it('elsewhere opens the editor with the title selected', () => {
    const d = deps();
    expect(renameFromMenu({}, d)).toBe('editor');
    expect(d.openEditor).toHaveBeenCalledWith(d.task, false);
    expect(d.selectEditorTitle).toHaveBeenCalled();
    expect(d.startEditingTask).not.toHaveBeenCalled();
  });

  it('opens the editor the surface opens, when it hands one over', () => {
    const d = deps();
    const onEdit = vi.fn();
    expect(renameFromMenu({ onEdit }, d)).toBe('editor');
    expect(onEdit).toHaveBeenCalled();
    expect(d.openEditor).not.toHaveBeenCalled();
    expect(d.selectEditorTitle).toHaveBeenCalled();
  });

  it('does nothing for an imported event or a task the menu could not find', () => {
    expect(renameFromMenu({ inlineRename: true }, deps({ task: { id: 'e', imported: true } }))).toBeNull();
    expect(renameFromMenu({}, deps({ task: undefined }))).toBeNull();
  });
});

describe('selectTitleWhenReady', () => {
  it('focuses and selects the title once the editor has mounted', () => {
    const input = { focus: vi.fn(), select: vi.fn() };
    const ref = { current: null };
    let frame;
    selectTitleWhenReady(ref, (fn) => { frame = fn; });
    ref.current = input; // the editor mounts before the frame runs
    frame();
    expect(input.focus).toHaveBeenCalled();
    expect(input.select).toHaveBeenCalled();
  });

  it('is harmless when the editor did not open', () => {
    expect(() => selectTitleWhenReady({ current: null }, (fn) => fn())).not.toThrow();
  });
});
