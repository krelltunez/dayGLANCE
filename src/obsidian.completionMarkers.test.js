import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseTasksFromMarkdown,
  writeTaskStateToFile,
  writeTaskStateNative,
  splitCompletionMarker,
  completionMarkerSuffix,
  vaultHasTasksPlugin,
  detectTasksPluginNative,
  deriveBlockId,
  legacyObsidianId,
  OBSIDIAN_TASKS_PLUGIN_ID,
} from './obsidian.js';

// COMPLETION MARKERS (docs/obsidian-buildout-spec.md — completion timestamps).
// The load-bearing claims, pinned:
//   • the marker is split off at parse on ^dg--TAGGED LINES ONLY — untagged
//     lines stay byte-frozen (identity scoping);
//   • BOTH formats are recognized at parse regardless of plugin detection;
//   • the marker is a REGENERATED SUFFIX from task state — so re-completion
//     replaces (never appends), uncompletion removes, and emission is
//     byte-deterministic from the stored completedAt string;
//   • format-off (meta null) strips without regenerating — OFF converges
//     lines clean per-touch, never via a sweep;
//   • the marker never breaks the write-time retitle guard, the token's
//     absolute-end position, or the no-op write skip.

function nfe() { const e = new Error('nf'); e.name = 'NotFoundError'; return e; }
function makeFile(parent, name, counters) {
  return {
    kind: 'file', name,
    async getFile() { counters.reads++; return { text: async () => parent[name], lastModified: 1 }; },
    async createWritable() {
      let buf = '';
      return { write: async (c) => { buf += c; }, close: async () => { counters.writes++; parent[name] = buf; } };
    },
  };
}
function makeDir(node, counters, name = '') {
  return {
    kind: 'directory', name,
    async getFileHandle(n, opts) {
      if (typeof node[n] === 'string') return makeFile(node, n, counters);
      if (opts?.create) { node[n] = ''; return makeFile(node, n, counters); }
      throw nfe();
    },
    async getDirectoryHandle(n, opts) {
      if (node[n] && typeof node[n] === 'object') return makeDir(node[n], counters, n);
      if (opts?.create) { node[n] = {}; return makeDir(node[n], counters, n); }
      throw nfe();
    },
    async *entries() {
      for (const [n, v] of Object.entries(node)) yield [n, typeof v === 'string' ? makeFile(node, n, counters) : makeDir(v, counters, n)];
    },
    [Symbol.asyncIterator]() { return this.entries(); },
  };
}

const DATE = '2026-09-02';
const BLOCK = 'aaaa1111';
const ISO_LOCAL = '2026-09-02T20:15:30-05:00';

const write = (vault, counters, { completed = true, meta, raw = 'Alpha', newRawTitle } = {}) =>
  writeTaskStateToFile(
    makeDir(vault, counters), '', DATE, raw, completed, null, newRawTitle, null, undefined,
    '## Tasks', BLOCK, null, meta,
  );

describe('write: the regenerated suffix', () => {
  it('completing writes the marker between the title and the ^dg- token — the token stays absolute end', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] Alpha ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    expect(await write(vault, c, { meta: { completedAt: ISO_LOCAL, format: 'tasks' } })).toBe(true);
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [x] Alpha ✅ 2026-09-02 ^dg-${BLOCK}`);
  });

  it('dataview format writes the stored string verbatim', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] Alpha ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    await write(vault, c, { meta: { completedAt: ISO_LOCAL, format: 'dataview' } });
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [x] Alpha [completed:: ${ISO_LOCAL}] ^dg-${BLOCK}`);
  });

  it('re-completion REPLACES, never appends: complete → uncomplete → complete leaves exactly one marker', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] Alpha ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    await write(vault, c, { meta: { completedAt: ISO_LOCAL, format: 'tasks' } });
    await write(vault, c, { completed: false, meta: { completedAt: null, format: 'tasks' } });
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [ ] Alpha ^dg-${BLOCK}`); // uncomplete removed it
    await write(vault, c, { meta: { completedAt: '2026-09-03T08:00:00-05:00', format: 'tasks' } });
    const line = vault[`${DATE}.md`].split('\n')[1];
    expect(line).toBe(`- [x] Alpha ✅ 2026-09-03 ^dg-${BLOCK}`);
    expect(line.match(/✅/g)).toHaveLength(1);
  });

  it('a format flip rewrites the marker in the new format on the next touch — one marker, never both', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [x] Alpha ✅ 2026-09-02 ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    await write(vault, c, { meta: { completedAt: ISO_LOCAL, format: 'dataview' } });
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [x] Alpha [completed:: ${ISO_LOCAL}] ^dg-${BLOCK}`);
  });

  it('meta null (setting OFF / legacy caller): an existing marker is STRIPPED and not regenerated — converge clean per-touch', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [x] Alpha ✅ 2026-09-02 ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    await write(vault, c, { meta: null });
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [x] Alpha ^dg-${BLOCK}`);
  });

  it('completed but NO stored timestamp (legacy completion) → no marker invented', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] Alpha ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    await write(vault, c, { meta: { completedAt: null, format: 'tasks' } });
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [x] Alpha ^dg-${BLOCK}`);
  });

  it('one-time normalization: first stamp of an untagged line with a hand-written marker moves it out of the title — no double marker', async () => {
    // The untagged line's identity INCLUDES the hand-written marker (frozen),
    // so matching runs on the full text; the stamping rewrite then strips it
    // from the written title and regenerates from state.
    const raw = 'Alpha ✅ 2026-08-10';
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] ${raw}` };
    const c = { reads: 0, writes: 0 };
    expect(await write(vault, c, { raw, meta: { completedAt: '2026-08-10', format: 'tasks' } })).toBe(true);
    const line = vault[`${DATE}.md`].split('\n')[1];
    expect(line).toBe(`- [x] Alpha ✅ 2026-08-10 ^dg-${BLOCK}`);
    expect(line.match(/✅/g)).toHaveLength(1);
  });

  it('an untagged line that CANNOT be stamped stays byte-frozen: no strip, no marker emitted', async () => {
    // A user block ref refuses the ^dg- stamp; a marker the parse could never
    // strip must not be emitted either, and the hand-written text must not be
    // eaten — the line's content-derived identity would silently change.
    const raw = 'Alpha ✅ 2026-08-10 ^myref';
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] ${raw}` };
    const c = { reads: 0, writes: 0 };
    expect(await write(vault, c, { raw, meta: { completedAt: ISO_LOCAL, format: 'tasks' } })).toBe(true);
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [x] ${raw}`);
  });

  it('write-time retitle guard compares CLEAN titles: completing a marker-bearing line is not a retitle; a real vault retitle is still caught', async () => {
    // Same title, marker on the line: no divergence — the rewrite proceeds
    // with our title.
    const vault = { [`${DATE}.md`]: `## Tasks\n- [x] Alpha ✅ 2026-09-01 ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    await write(vault, c, { newRawTitle: 'Alpha renamed', meta: { completedAt: ISO_LOCAL, format: 'tasks' } });
    expect(vault[`${DATE}.md`]).toContain('- [x] Alpha renamed ✅ 2026-09-02');

    // Vault-edited title WITH a marker: the guard still sees the divergence
    // (on the clean title) and keeps the LINE's title.
    const vault2 = { [`${DATE}.md`]: `## Tasks\n- [x] Vault edit ✅ 2026-09-01 ^dg-${BLOCK}` };
    const conflicts = [];
    await writeTaskStateToFile(
      makeDir(vault2, c), '', DATE, 'Alpha', true, null, 'Alpha renamed', null, undefined,
      '## Tasks', BLOCK, (x) => conflicts.push(x), { completedAt: ISO_LOCAL, format: 'tasks' },
    );
    expect(conflicts).toEqual([{ lineTitle: 'Vault edit' }]);
    expect(vault2[`${DATE}.md`]).toContain('- [x] Vault edit ✅ 2026-09-02');
  });

  it('no-op skip still holds: a steady-state echo of a marker-bearing line is byte-identical and skipped', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [x] Alpha ✅ 2026-09-02 ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    expect(await write(vault, c, { meta: { completedAt: ISO_LOCAL, format: 'tasks' } })).toBe(true);
    expect(c.writes).toBe(0); // regeneration is deterministic from the stored string
  });

  it('round trip: what the write emits, the parse reads back to the same identity and timestamp', async () => {
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] Alpha ^dg-${BLOCK}` };
    const c = { reads: 0, writes: 0 };
    await write(vault, c, { meta: { completedAt: ISO_LOCAL, format: 'dataview' } });
    const { inboxTasks } = parseTasksFromMarkdown(vault[`${DATE}.md`], DATE);
    expect(inboxTasks[0].obsidianRawTitle).toBe('Alpha');
    expect(inboxTasks[0].obsidianBlockId).toBe(BLOCK);
    expect(inboxTasks[0].completedAt).toBe(ISO_LOCAL);
  });
});

describe('native write path carries the same meta', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { delete global.window; vi.restoreAllMocks(); });

  it('writeTaskStateNative emits and strips markers identically', () => {
    let file = `## Tasks\n- [ ] Alpha ^dg-${BLOCK}`;
    global.window = {
      DayGlanceObsidian: {
        getDailyNote: () => file,
        writeDailyNote: (d, content) => { file = content; return true; },
      },
    };
    expect(writeTaskStateNative(
      DATE, 'Alpha', true, null, undefined, null, undefined, '## Tasks', BLOCK, null, null,
      { completedAt: ISO_LOCAL, format: 'tasks' },
    )).toBe(true);
    expect(file).toBe(`## Tasks\n- [x] Alpha ✅ 2026-09-02 ^dg-${BLOCK}`);
  });
});

describe('Tasks-plugin detection', () => {
  afterEach(() => { delete global.window; });

  const fsWith = (pluginsJson) => makeDir(
    pluginsJson === undefined ? {} : { '.obsidian': { 'community-plugins.json': pluginsJson } },
    { reads: 0, writes: 0 },
  );

  it('FSA/Electron: enabled id → tasks format; anything else → the Dataview default', async () => {
    expect(await vaultHasTasksPlugin(fsWith(`["dataview","${OBSIDIAN_TASKS_PLUGIN_ID}"]`))).toBe(true);
    expect(await vaultHasTasksPlugin(fsWith('["dataview"]'))).toBe(false);
    expect(await vaultHasTasksPlugin(fsWith(undefined))).toBe(false); // no .obsidian at all
    expect(await vaultHasTasksPlugin(fsWith('not json'))).toBe(false); // malformed → safe default
  });

  it('native: null/absent-method/legacy-"null"-echo are UNDETERMINED (keep last known); "" and real answers are determinate', () => {
    global.window = { DayGlanceObsidian: {} };
    expect(detectTasksPluginNative()).toBe(null); // old Android shell — method missing

    global.window = { DayGlanceObsidian: { getCommunityPlugins: () => null } };
    expect(detectTasksPluginNative()).toBe(null); // read failed

    // Old iOS shell: the Proxy makes every method "exist" and the legacy
    // dispatcher echoes the STRING "null" over HTTP 200 — the same
    // string-transport trap as the write contract. Undetermined, not "no".
    global.window = { DayGlanceObsidian: { getCommunityPlugins: () => 'null' } };
    expect(detectTasksPluginNative()).toBe(null);

    global.window = { DayGlanceObsidian: { getCommunityPlugins: () => '' } };
    expect(detectTasksPluginNative()).toBe(false); // determinately absent

    global.window = { DayGlanceObsidian: { getCommunityPlugins: () => `["${OBSIDIAN_TASKS_PLUGIN_ID}"]` } };
    expect(detectTasksPluginNative()).toBe(true);
  });
});
