// A DAMAGED LINE (2026-11-27 device test): a merge of concurrent edits ran two
// task lines together, or doubled a token, and a report of that text became
// the task's title. A line whose title still carries `^dg-` after its trailing
// token is split off says nothing about the title; the rest of the line is
// read as usual, and its note is recorded for the late-observation gate.
import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown } from '@glance-apps/obsidian-format';
import { buildExistingObsidianTaskContext, mergeParsedObsidianTasks, carriesStrayBlockToken } from './obsidian.js';

const NOTE = 'Projects/dayGLANCE/dayGLANCE.md';
const app = (id, raw, extra = {}) => ({
  id: `obsidian-dg-${id}`, title: `${raw} #obsidian`, obsidianRawTitle: raw, obsidianBlockId: id,
  obsidianNotePath: NOTE, importSource: 'obsidian', completed: false, priority: 0, lastModified: '2026-11-27T20:00:00.000Z', ...extra,
});

function inbound(text, inbox) {
  const ctx = buildExistingObsidianTaskContext([], inbox);
  const out = { allScheduled: [], allInbox: [], lineSchedule: {}, damagedNotes: new Set() };
  mergeParsedObsidianTasks(parseTasksFromMarkdown(text, '2026-11-27', new Set(), { notePath: NOTE }), ctx, null, out);
  return out;
}

describe('carriesStrayBlockToken', () => {
  it('is the title with our marker left inside it', () => {
    expect(carriesStrayBlockToken('ZZ bridge tick test ^dg-ou7b1zfo3')).toBe(true);
    expect(carriesStrayBlockToken('ZZ bridge tick test 3')).toBe(false);
    expect(carriesStrayBlockToken(undefined)).toBe(false);
  });
});

describe('a damaged report keeps the task\'s title', () => {
  it('two lines run together: the title stays, the note is recorded', () => {
    const out = inbound('- [ ] ZZ bridge tick test ^dg-ou7b1zfo3 ^dg-zjq2cd71\n', [app('zjq2cd71', 'ZZ bridge tick test 3')]);
    const [t] = out.allInbox;
    expect(t).toMatchObject({ title: 'ZZ bridge tick test 3 #obsidian', obsidianRawTitle: 'ZZ bridge tick test 3' });
    expect([...out.damagedNotes]).toEqual([NOTE]);
  });

  it('a doubled token after a completion marker: the title stays, the tick is still read', () => {
    const out = inbound('- [x] ZZ tick test four [completed:: 2026-11-27T16:21:47-07:00] ^dg-ft4z100r ^dg-ft4z100r\n', [app('ft4z100r', 'ZZ tick test four')]);
    const [t] = out.allInbox;
    expect(t).toMatchObject({ title: 'ZZ tick test four #obsidian', obsidianRawTitle: 'ZZ tick test four', completed: true });
  });

  it('a clean report is a retitle as before, and records nothing', () => {
    const out = inbound('- [ ] ZZ bridge tick test three ^dg-zjq2cd71\n', [app('zjq2cd71', 'ZZ bridge tick test 3')]);
    expect(out.allInbox[0].title).toBe('ZZ bridge tick test three #obsidian');
    expect(out.damagedNotes.size).toBe(0);
  });

  it('a clean report repairs a title a damaged report wrote before this fix', () => {
    const out = inbound('- [ ] ZZ bridge tick test 3 ^dg-zjq2cd71\n', [app('zjq2cd71', 'ZZ bridge tick test ^dg-ou7b1zfo3')]);
    expect(out.allInbox[0].title).toBe('ZZ bridge tick test 3 #obsidian');
  });

  it('a damaged line with no task behind it still records its note', () => {
    const out = inbound('- [ ] Fresh ^dg-abc12345x ^dg-zzzz9999\n', []);
    expect([...out.damagedNotes]).toEqual([NOTE]);
  });
});
