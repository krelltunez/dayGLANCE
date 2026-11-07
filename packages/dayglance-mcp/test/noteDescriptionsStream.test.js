// @vitest-environment node
// A GLANCEvault-client host fills linked descriptions from the bridge's
// observation stream (#2280; the app's planner later, #2291): the goal tree
// read, through the shared read model and enrichGoalTreeDescriptions, with a
// loader built from the bridge namespace's rows. No vault folder, no browser.
import { describe, it, expect } from 'vitest';
import {
  bridgeNoteDescriptionLoader, sealBridgeEnvelope, encodePlainBridgeRow, observationEntityId,
  deriveBridgeSubkey, noteTextHash, BRIDGE_PAIRING_META_ID,
} from '@glance-apps/obsidian-format';
import { buildMcpReadState, handleMcpRequest, enrichGoalTreeDescriptions } from '../src/model.js';

const NOW = Date.parse('2026-10-22T03:30:00Z');
const data = {
  goals: [
    { id: 'g1', title: 'Home', status: 'active', obsidianNotePath: 'Goals/Home.md' },
    { id: 'g2', title: 'Plain', status: 'active', description: 'Kept on the record.' },
  ],
  projects: [
    { id: 'p1', title: 'House', status: 'active', goalId: 'g1', obsidianNotePath: 'Projects/House.md' },
    { id: 'p2', title: 'Shed', status: 'active', goalId: 'g1', obsidianNotePath: 'Projects/Shed.md' },
    { id: 'p3', title: 'Attic', status: 'active', obsidianNotePath: 'Projects/Attic.md', obsidianNoteMissingAt: '2026-10-01T00:00:00Z' },
    { id: 'p4', title: 'Garden', status: 'active', obsidianNotePath: 'Projects/Garden.md' },
  ],
};

describe('linked descriptions from the observation stream', () => {
  it('fill the goal tree through enrichGoalTreeDescriptions; a deleted note and an unreported one keep the pointer', async () => {
    const rootKey = await crypto.subtle.importKey('raw', new Uint8Array(32).fill(9), 'HKDF', false, ['deriveKey']);
    const salt = new Uint8Array(16).fill(3);
    const subkey = await deriveBridgeSubkey(rootKey, salt);
    const report = async (path, fields) => ({
      entityId: await observationEntityId(path),
      envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path, mtime: null, observedAt: '2026-10-21T10:00:00.000Z', ...fields }, 'gen-1'),
      deleted: false,
    });
    const rows = [
      { entityId: BRIDGE_PAIRING_META_ID, envelope: encodePlainBridgeRow({ v: 1, kind: 'pairing-meta', generation: 'gen-1', pairingSalt: btoa(String.fromCharCode(...salt)) }), deleted: false },
      await report('Goals/Home.md', { content: '# Home\n\nA dry, warm house.\n\n## Projects\n' }),
      await report('Projects/House.md', { content: '---\ndayglance-id: p1\n---\n# House\n\nKeep the roof dry.\n\n## Tasks\n- [ ] Gutters\n' }),
      await report('Projects/Shed.md', { content: null, deleted: true }),
      // Projects/Garden.md: never reported.
    ];
    const loadNoteDescription = await bridgeNoteDescriptionLoader(rows, { rootKey });

    const state = buildMcpReadState(data, { now: NOW, timeZone: 'America/Los_Angeles' });
    const tree = handleMcpRequest(state, { method: 'goal_progress', params: { window: 'all' } });
    expect(tree.ok).toBe(true);
    const out = await enrichGoalTreeDescriptions(tree.data, { loadNoteDescription });

    const home = out.goals.find((g) => g.id === 'g1');
    expect(home).toMatchObject({ description: 'A dry, warm house.', description_source: 'obsidian_note', description_base: noteTextHash('A dry, warm house.'), description_reported_at: '2026-10-21T10:00:00.000Z' });
    const house = home.projects.find((p) => p.id === 'p1');
    expect(house).toMatchObject({ description: 'Keep the roof dry.', description_source: 'obsidian_note', description_base: noteTextHash('Keep the roof dry.') });
    // Deleted in the vault: the pointer stays, nothing is filled in.
    const shed = home.projects.find((p) => p.id === 'p2');
    expect(shed.obsidian_note).toMatchObject({ path: 'Projects/Shed.md' });
    expect('description_source' in shed).toBe(false);
    // Not reported yet: no information, the same.
    const garden = out.standalone_projects.find((p) => p.id === 'p4');
    expect('description_source' in garden).toBe(false);
    // A note the record already knows is missing is never opened, and an
    // unlinked goal keeps its own description.
    expect('description_source' in out.standalone_projects.find((p) => p.id === 'p3')).toBe(false);
    expect(out.goals.find((g) => g.id === 'g2')).toMatchObject({ description: 'Kept on the record.' });
    expect('description_source' in out.goals.find((g) => g.id === 'g2')).toBe(false);
  });
});
