// A DAMAGED LINE (2026-11-27 device test): a merge of concurrent edits ran two
// task lines together, or doubled a token, and a report of that text became
// the task's title. A line whose title still carries `^dg-` after its trailing
// token is split off says nothing about the title; the rest of the line is
// read as usual, and its note is recorded for the late-observation gate.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseTasksFromMarkdown } from '@glance-apps/obsidian-format';
import { applyBridgeObservations } from './utils/obsidianBridgeInbound.js';
import { buildExistingObsidianTaskContext, mergeParsedObsidianTasks, carriesStrayBlockToken, syncObsidianVault, syncObsidianVaultNative } from './obsidian.js';

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

// 2026-11-28 device test: a task with no stored line text took the damaged
// text as its base, so every later report was compared with it.
describe('a task with no stored line text', () => {
  it('keeps its title and takes no line text from a damaged report', () => {
    const { obsidianRawTitle: _none, ...noBase } = app('brm75m7z', 'ZZ tick test five');
    const out = inbound('- [x] ZZ tick test five ^dg-abcd1234 extra ^dg-brm75m7z\n', [noBase]);
    const [t] = out.allInbox;
    expect(t.title).toBe('ZZ tick test five #obsidian');
    expect(t.obsidianRawTitle).toBeUndefined();
    expect(t.completed).toBe(true);
    expect([...out.damagedNotes]).toEqual([NOTE]);
  });

  it('then takes a clean report\'s text as its base', () => {
    const { obsidianRawTitle: _none, ...noBase } = app('brm75m7z', 'ZZ tick test five');
    const out = inbound('- [x] ZZ tick test five ^dg-brm75m7z\n', [noBase]);
    expect(out.allInbox[0].obsidianRawTitle).toBe('ZZ tick test five');
  });
});

// The folder readers read daily notes only (project notes reach the app through
// the plugin's reports), and both go through the same merge: a damaged line in
// a daily note keeps each task's title, with or without stored line text.
describe('the folder readers', () => {
  const DATE = '2026-11-28';
  const TEXT = '## Tasks\n- [ ] Alpha ^dg-abcd1234 extra ^dg-aaaa1111\n- [x] Beta ^dg-bbbb2222 ^dg-bbbb2222\n- [ ] 09:00 Gamma ^dg-x ^dg-cccc3333\n';
  const daily = (id, raw, extra = {}) => ({
    id: `obsidian-dg-${id}`, title: `${raw} #obsidian`, obsidianRawTitle: raw, obsidianBlockId: id,
    obsidianFileDate: DATE, importSource: 'obsidian', completed: false, priority: 0, lastModified: '2026-11-28T15:00:00.000Z', ...extra,
  });
  const existing = () => {
    const { obsidianRawTitle: _none, ...noBase } = daily('bbbb2222', 'Beta');
    return [daily('aaaa1111', 'Alpha'), noBase];
  };
  const scheduled = () => [daily('cccc3333', 'Gamma', { date: DATE, startTime: '09:00' })];
  const check = (r) => {
    const all = [...r.scheduledTasks, ...r.inboxTasks];
    expect(all.find((t) => t.id === 'obsidian-dg-aaaa1111')).toMatchObject({ title: 'Alpha #obsidian', obsidianRawTitle: 'Alpha' });
    const beta = all.find((t) => t.id === 'obsidian-dg-bbbb2222');
    expect(beta).toMatchObject({ title: 'Beta #obsidian', completed: true });
    expect(beta.obsidianRawTitle).toBeUndefined();
    expect(all.find((t) => t.id === 'obsidian-dg-cccc3333')).toMatchObject({ title: 'Gamma #obsidian', obsidianRawTitle: 'Gamma', startTime: '09:00' });
    expect(r.damagedNotes).toEqual([DATE]);
  };

  beforeEach(() => {
    const m = new Map();
    global.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  });
  afterEach(() => { delete global.localStorage; delete global.window; });

  it('the desktop folder reader', async () => {
    const file = { kind: 'file', name: `${DATE}.md`, async getFile() { return { text: async () => TEXT, lastModified: Date.parse('2026-11-28T16:09:14Z') }; } };
    const dir = { kind: 'directory', name: '', async *[Symbol.asyncIterator]() { yield [file.name, file]; }, async getDirectoryHandle() { return dir; } };
    check(await syncObsidianVault(dir, '', 0, scheduled(), existing(), 'yyyy-MM-dd'));
  });

  it('the plugin\'s report of a daily note', () => {
    const r = applyBridgeObservations([{ path: `${DATE}.md`, content: TEXT, mtime: Date.parse('2026-11-28T16:09:14Z'), observedAt: '2026-11-28T16:09:17.000Z' }], {
      existingTasks: scheduled(), existingInbox: existing(), dailyNotesPath: '', knownDailyNotes: {},
    });
    check(r);
  });

  it('the Android folder reader', async () => {
    global.window = { DayGlanceObsidian: { getAllDailyNotes: () => JSON.stringify([{ date: DATE, text: TEXT, lastModified: '2026-11-28T16:09:14.000Z' }]) } };
    check(await syncObsidianVaultNative('', 0, scheduled(), existing()));
  });
});
