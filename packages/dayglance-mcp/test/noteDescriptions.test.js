// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { enrichGoalTreeDescriptions, DESCRIPTION_READ_CAP } from '../src/noteDescriptions.js';

// The goal tree read opens the linked notes to fill descriptions in (moved
// with the code from the app's src/utils/mcpNoteDescriptions.test.js, #2280).
// The stream-backed loader a host injects is tested end to end in
// noteDescriptionsStream.test.js.

const tree = () => ({
  goals: [{
    id: 'g1', title: 'Home', description: '', obsidian_note: { path: 'Goals/Home.md', name: 'Goals/Home', missing: false },
    projects: [
      { id: 'p1', title: 'Roof', description: '', obsidian_note: { path: 'Projects/Roof.md', name: 'Projects/Roof', missing: false } },
      { id: 'p2', title: 'Garden', description: 'Local box.' },
      { id: 'p3', title: 'Attic', description: '', obsidian_note: { path: 'Projects/Attic.md', name: 'Projects/Attic', missing: true } },
    ],
  }],
  standalone_projects: [{ id: 'p4', title: 'Shed', description: '', obsidian_note: { path: 'Projects/Shed.md', name: 'Projects/Shed', missing: false } }],
});

describe('enrichGoalTreeDescriptions', () => {
  it('fills description, source and base from each present note; a missing note, an unlinked entity and an unreadable note are left as they were', async () => {
    const loadNoteDescription = vi.fn(async (path) => {
      if (path === 'Goals/Home.md') return { text: 'Dry roof by spring.', base: 'h1' };
      if (path === 'Projects/Roof.md') return { notFound: true };
      if (path === 'Projects/Shed.md') return null;
      return { text: 'x', base: 'hx' };
    });
    const out = await enrichGoalTreeDescriptions(tree(), { loadNoteDescription });
    expect(out.goals[0]).toMatchObject({ description: 'Dry roof by spring.', description_source: 'obsidian_note', description_base: 'h1' });
    expect(out.goals[0].projects[0]).toMatchObject({ description: '' });
    expect('description_source' in out.goals[0].projects[0]).toBe(false);
    expect(out.goals[0].projects[1]).toEqual({ id: 'p2', title: 'Garden', description: 'Local box.' });
    expect(out.standalone_projects[0]).toMatchObject({ description: '' });
    // The missing note is never opened.
    expect(loadNoteDescription).not.toHaveBeenCalledWith('Projects/Attic.md');
    expect(loadNoteDescription).toHaveBeenCalledTimes(3);
  });
  it('without a loader, or with nothing linked, returns the data unchanged in shape; the input is not mutated', async () => {
    const data = tree();
    const same = await enrichGoalTreeDescriptions(data, {});
    expect(same).toBe(data);
    const out = await enrichGoalTreeDescriptions(data, { loadNoteDescription: async () => ({ text: 'T', base: 'b' }) });
    expect(data.goals[0].description).toBe('');
    expect(out.goals[0].description).toBe('T');
  });
  it('caps the reads and survives a loader that hangs or throws', async () => {
    const many = { goals: [], standalone_projects: Array.from({ length: DESCRIPTION_READ_CAP + 5 }, (_, i) => ({ id: `p${i}`, obsidian_note: { path: `P/${i}.md`, name: `P/${i}`, missing: false } })) };
    const loader = vi.fn(async (path) => (path === 'P/1.md' ? Promise.reject(new Error('boom')) : { text: 'ok', base: 'b' }));
    const out = await enrichGoalTreeDescriptions(many, { loadNoteDescription: loader });
    expect(loader).toHaveBeenCalledTimes(DESCRIPTION_READ_CAP);
    expect(out.standalone_projects[0].description).toBe('ok');
    expect('description' in out.standalone_projects[1]).toBe(false);
    expect('description' in out.standalone_projects[DESCRIPTION_READ_CAP + 2]).toBe(false);
  });
});
