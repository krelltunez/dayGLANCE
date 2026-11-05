import { describe, it, expect, vi } from 'vitest';
import * as packageModel from '@glance-apps/dayglance-mcp/model';
import {
  enrichGoalTreeDescriptions, splitDescriptionWrite, writeLinkedDescription,
  noteDescriptionUndoOp, undoNoteDescriptionOps, DESCRIPTION_READ_CAP,
} from './mcpNoteDescriptions.js';

// The MCP as one more editor over a linked note's description section
// (2026-10-04): the goal tree read opens the notes to fill descriptions in,
// and a description write on a linked entity goes through the planner's own
// section save with refuse-on-change. No copy, no cache.

describe('the read half', () => {
  // enrichGoalTreeDescriptions and its cap live in @glance-apps/dayglance-mcp
  // (tested there, packages/dayglance-mcp/test/noteDescriptions.test.js); the
  // hook reaches them through this module, and they must be the package's.
  it('is the package\'s, re-exported', () => {
    expect(enrichGoalTreeDescriptions).toBe(packageModel.enrichGoalTreeDescriptions);
    expect(DESCRIPTION_READ_CAP).toBe(packageModel.DESCRIPTION_READ_CAP);
  });
});

describe('splitDescriptionWrite', () => {
  const state = {
    goals: [{ id: 'g1', title: 'Home', obsidianNotePath: 'Goals/Home.md' }, { id: 'g2', title: 'Plain' }],
    projects: [{ id: 'p1', title: 'Roof', obsidianNotePath: 'Projects/Roof.md', obsidianNoteMissingAt: '2026-10-01T00:00:00Z' }],
  };
  it('splits a linked goal\'s description from the rest of the call; a clear writes an empty section', () => {
    const s = splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: { description: 'New', descriptionBase: 'h0', title: 'Home!' }, clear: ['area'] });
    expect(s).toMatchObject({ kind: 'goal', id: 'g1', text: 'New', base: 'h0', link: { path: 'Goals/Home.md' } });
    expect(s.rest).toEqual({ goalId: 'g1', set: { title: 'Home!' }, clear: ['area'] });
    const only = splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: { description: 'New' } });
    expect(only.rest).toBeNull();
    const cleared = splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: {}, clear: ['description'] });
    expect(cleared).toMatchObject({ text: '', rest: null });
  });
  it('is null for an unlinked entity, a missing note, a call that leaves the description alone, or any other method', () => {
    expect(splitDescriptionWrite(state, 'update_goal', { goalId: 'g2', set: { description: 'x' } })).toBeNull();
    expect(splitDescriptionWrite(state, 'update_project', { projectId: 'p1', set: { description: 'x' } })).toBeNull();
    expect(splitDescriptionWrite(state, 'update_goal', { goalId: 'g1', set: { title: 'x' } })).toBeNull();
    expect(splitDescriptionWrite(state, 'update_task', { taskId: 't', set: { notes: 'x' } })).toBeNull();
  });
});

describe('writeLinkedDescription', () => {
  const split = { kind: 'goal', id: 'g1', link: { path: 'Goals/Home.md', name: 'Goals/Home' }, text: 'New', base: 'h0' };
  it('writes through the section save with the base and reports written or queued', async () => {
    const save = vi.fn(async () => ({ ok: true }));
    await expect(writeLinkedDescription(split, { saveNoteDescription: save, noteWriteMode: () => 'queued' })).resolves.toEqual({ ok: true, text: 'New', mode: 'queued' });
    expect(save).toHaveBeenCalledWith('goal', 'g1', 'Goals/Home.md', 'New', { base: 'h0' });
    await expect(writeLinkedDescription(split, { saveNoteDescription: save })).resolves.toMatchObject({ mode: 'written' });
  });
  it('the save\'s own word on how it went wins over the posture: a section from the plugin\'s report is queued on a device whose posture says direct (#2291)', async () => {
    const queued = vi.fn(async () => ({ ok: true, mode: 'queued' }));
    await expect(writeLinkedDescription(split, { saveNoteDescription: queued, noteWriteMode: () => 'written' })).resolves.toEqual({ ok: true, text: 'New', mode: 'queued' });
    const written = vi.fn(async () => ({ ok: true, mode: 'written' }));
    await expect(writeLinkedDescription(split, { saveNoteDescription: written, noteWriteMode: () => 'queued' })).resolves.toMatchObject({ mode: 'written' });
  });
  it('a refusal is note_changed; a failed write and a device without the vault are typed validation errors; a throw is internal', async () => {
    const refused = await writeLinkedDescription(split, { saveNoteDescription: async () => ({ refused: 'changed', text: 'Edited in Obsidian.' }) });
    expect(refused).toMatchObject({ ok: false, error: { code: 'note_changed' } });
    expect(refused.error.message).toContain('Goals/Home');
    expect(await writeLinkedDescription(split, { saveNoteDescription: async () => ({ ok: false }) })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await writeLinkedDescription(split, {})).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await writeLinkedDescription(split, { saveNoteDescription: async () => { throw new Error('disk'); } })).toMatchObject({ ok: false, error: { code: 'internal', message: 'disk' } });
  });
});

describe('the undo op and its replay', () => {
  it('restores the previous section under the hash of what was written, so an Obsidian edit since is refused and counted as skipped', async () => {
    const split = { kind: 'project', id: 'p1', link: { path: 'Projects/Roof.md', name: 'Projects/Roof' }, text: 'New', base: null, before: 'Old text.' };
    const op = noteDescriptionUndoOp(split, 'hNew');
    expect(op).toEqual({ kind: 'restore_note_description', entityKind: 'project', entityId: 'p1', path: 'Projects/Roof.md', before: 'Old text.', afterBase: 'hNew' });
    const save = vi.fn(async () => ({ ok: true }));
    await expect(undoNoteDescriptionOps([op], { saveNoteDescription: save })).resolves.toEqual({ undone: 1, skipped: 0 });
    expect(save).toHaveBeenCalledWith('project', 'p1', 'Projects/Roof.md', 'Old text.', { base: 'hNew' });
    await expect(undoNoteDescriptionOps([op], { saveNoteDescription: async () => ({ refused: 'changed', text: 'x' }) })).resolves.toEqual({ undone: 0, skipped: 1 });
    await expect(undoNoteDescriptionOps([op, { kind: 'other' }], {})).resolves.toEqual({ undone: 0, skipped: 2 });
  });
});
