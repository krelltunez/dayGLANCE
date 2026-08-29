import { describe, it, expect } from 'vitest';
import {
  parseTasksFromMarkdown,
  syncObsidianVault,
  writeTaskStateToFile,
  legacyObsidianId,
} from './obsidian.js';
import { reattachTasksMetadata } from './utils/obsidianTasksMetadata.js';
import { mergeObsidianTasks } from './utils/mergeObsidianTasks.js';

// PHASE 4 STEP 2 — Tasks-metadata read support, and the fourth ownership
// ruling: per-field vault-edit adoption. The claims pinned here:
//   • mapping at parse (⏳ → timeline with inline-prefix precedence,
//     📅-only stays inbox with a deadline, priority collapse, 🔁 flag),
//     with rawTitle FULL and display stripped — on tagged AND untagged lines;
//   • adoption: a vault edit overrides dayGLANCE ONLY for the specific field
//     the vault edited (add / change / REMOVE), detected by base-vs-theirs
//     field diff — an untouched ⏳ never clobbers a DG reschedule;
//   • hazard 1: comparison spaces — a metadata-carrying task must never read
//     as "permanently renamed"; conflict notes fire only for real renames;
//   • hazard 2: the display-derivation bridge upgrades unrenamed old-style
//     titles and leaves genuine renames alone;
//   • the retitle-carry: a DG rename keeps the line's metadata verbatim.

function nfe() { const e = new Error('nf'); e.name = 'NotFoundError'; return e; }
function makeFile(parent, name) {
  return {
    kind: 'file', name,
    async getFile() { return { text: async () => parent[name], lastModified: 1 }; },
    async createWritable() {
      let buf = '';
      return { write: async (c) => { buf += c; }, close: async () => { parent[name] = buf; } };
    },
  };
}
function makeDir(node, name = '') {
  return {
    kind: 'directory', name,
    async getFileHandle(n, opts) {
      if (typeof node[n] === 'string') return makeFile(node, n);
      if (opts?.create) { node[n] = ''; return makeFile(node, n); }
      throw nfe();
    },
    async getDirectoryHandle(n, opts) {
      if (node[n] && typeof node[n] === 'object') return makeDir(node[n], n);
      if (opts?.create) { node[n] = {}; return makeDir(node[n], n); }
      throw nfe();
    },
    async *entries() {
      for (const [n, v] of Object.entries(node)) yield [n, typeof v === 'string' ? makeFile(node, n) : makeDir(v, n)];
    },
    [Symbol.asyncIterator]() { return this.entries(); },
  };
}

const DATE = '2026-09-01';
const BLOCK = 'aaaa1111';
const DG_ID = `obsidian-dg-${BLOCK}`;

const scan = (line, existingTasks = [], existingInbox = []) => syncObsidianVault(
  makeDir({ [`${DATE}.md`]: `## Tasks\n${line}\n` }), '', 0,
  existingTasks, existingInbox, 'yyyy-MM-dd',
);

// A known TAGGED task whose base (obsidianRawTitle) is `raw`.
const known = (raw, extra = {}) => ({
  id: DG_ID, importSource: 'obsidian', obsidianBlockId: BLOCK,
  obsidianRawTitle: raw, obsidianFileDate: DATE,
  title: `Call dentist #obsidian`, completed: false,
  notes: '', subtasks: [], duration: 30,
  ...extra,
});

describe('per-field vault-edit adoption (the fourth ownership ruling)', () => {
  it('vault edits 📅 → deadline adopts, even over an app-side value (same-field: vault wins)', async () => {
    const existing = known('Call dentist 📅 2026-09-10', { deadline: '2026-09-20' }); // app set its own
    const { inboxTasks } = await scan(`- [ ] Call dentist 📅 2026-09-12 ^dg-${BLOCK}`, [], [existing]);
    expect(inboxTasks[0].deadline).toBe('2026-09-12');
  });

  it('an UNTOUCHED ⏳ in an edited line never clobbers a dayGLANCE reschedule', async () => {
    // DG dragged the task to 09-07; the vault edited the TITLE TEXT but the
    // ⏳ is byte-identical → scheduled is not adopted, DG's date survives.
    const existing = known('Water plants ⏳ 2026-09-05', { date: '2026-09-07', startTime: '00:00', isAllDay: true });
    const { scheduledTasks } = await scan(`- [ ] Water the plants ⏳ 2026-09-05 ^dg-${BLOCK}`, [existing], []);
    expect(scheduledTasks[0].date).toBe('2026-09-07');
  });

  it('vault edits ⏳ → the timeline date adopts over the DG value', async () => {
    const existing = known('Water plants ⏳ 2026-09-05', { date: '2026-09-07', startTime: '00:00', isAllDay: true });
    const { scheduledTasks } = await scan(`- [ ] Water plants ⏳ 2026-09-08 ^dg-${BLOCK}`, [existing], []);
    expect(scheduledTasks[0].date).toBe('2026-09-08');
    expect(scheduledTasks[0].isAllDay).toBe(true);
  });

  it('vault REMOVES 📅 → the deadline clears (removal is an edit too)', async () => {
    const existing = known('Call dentist 📅 2026-09-10', { deadline: '2026-09-10' });
    const { inboxTasks } = await scan(`- [ ] Call dentist ^dg-${BLOCK}`, [], [existing]);
    expect(inboxTasks[0].deadline).toBe(null);
  });

  it('vault edits priority → adopts; line otherwise unchanged → app values win entirely', async () => {
    const e1 = known('Sharpen saw 🔼', { priority: 3 }); // app raised it
    const r1 = await scan(`- [ ] Sharpen saw 🔽 ^dg-${BLOCK}`, [], [e1]);
    expect(r1.inboxTasks[0].priority).toBe(1); // vault demonstrably edited the field

    const e2 = known('Sharpen saw 🔼', { priority: 3 });
    const r2 = await scan(`- [ ] Sharpen saw 🔼 ^dg-${BLOCK}`, [], [e2]);
    expect(r2.inboxTasks[0].priority).toBe(3); // line unchanged → shipped rule, app wins
  });

  it('⏳ ADDED to an inbox task → the vault edit wins the classification: task moves to the timeline', async () => {
    const existing = known('Call dentist', {});
    const { scheduledTasks, inboxTasks } = await scan(`- [ ] Call dentist ⏳ 2026-09-08 ^dg-${BLOCK}`, [], [existing]);
    expect(inboxTasks).toEqual([]);
    expect(scheduledTasks[0]).toMatchObject({ id: DG_ID, date: '2026-09-08', isAllDay: true });
  });

  it('⏳ REMOVED from a vault-scheduled task → moves back to inbox', async () => {
    const existing = known('Water plants ⏳ 2026-09-05', { date: '2026-09-05', startTime: '00:00', isAllDay: true });
    const { scheduledTasks, inboxTasks } = await scan(`- [ ] Water plants ^dg-${BLOCK}`, [existing], []);
    expect(scheduledTasks).toEqual([]);
    expect(inboxTasks[0].id).toBe(DG_ID);
  });

  it('untagged lines get NO adoption — the shipped existing-fields-win rule applies unchanged', async () => {
    const raw = 'Call dentist 📅 2026-09-10';
    const existing = {
      id: legacyObsidianId(DATE, raw), importSource: 'obsidian',
      obsidianRawTitle: raw, obsidianFileDate: DATE,
      title: 'Call dentist #obsidian', completed: false, notes: '', subtasks: [], duration: 30,
      deadline: '2026-09-20',
    };
    // Same line text → same legacy id; app deadline differs from the line's.
    const { inboxTasks } = await scan(`- [ ] ${raw}`, [], [existing]);
    expect(inboxTasks[0].deadline).toBe('2026-09-20');
  });
});

describe('hazard 1 — comparison spaces (pinned)', () => {
  it('a metadata-carrying, never-renamed task takes a vault-side edit with NO conflict note', async () => {
    const existing = known('Call dentist 📅 2026-09-10', {
      title: 'Call dentist #obsidian', // new-style display: metadata-free
    });
    const conflicts = [];
    const { inboxTasks } = await syncObsidianVault(
      makeDir({ [`${DATE}.md`]: `## Tasks\n- [ ] Call the dentist 📅 2026-09-10 ^dg-${BLOCK}\n` }), '', 0,
      [], [existing], 'yyyy-MM-dd', (c) => conflicts.push(c),
    );
    expect(conflicts).toEqual([]);                       // one-sided: vault wins silently
    expect(inboxTasks[0].title).toBe('Call the dentist #obsidian');
    expect(inboxTasks[0].notes).toBe('');                // no spurious record
  });

  it('a REAL two-sided retitle still conflicts — and the note records the DISPLAY title, metadata-free', async () => {
    const existing = known('Call dentist 📅 2026-09-10', {
      title: 'Ring the dentist #obsidian', // genuine DG rename (display space)
    });
    const conflicts = [];
    const result = await syncObsidianVault(
      makeDir({ [`${DATE}.md`]: `## Tasks\n- [ ] Phone the dentist 📅 2026-09-10 ^dg-${BLOCK}\n` }), '', 0,
      [], [existing], 'yyyy-MM-dd', (c) => conflicts.push(c),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].dgTitle).toBe('Ring the dentist');
    expect(conflicts[0].vaultTitle).toBe('Phone the dentist'); // display space, no 📅 in the toast
    expect(result.inboxTasks[0].notes).toContain('Renamed in dayGLANCE to "Ring the dentist"');
    expect(result.inboxTasks[0].notes).not.toContain('📅');
  });

  it('mixed window: an OLD-STYLE ours (metadata still in the title) does not false-conflict either', async () => {
    const existing = known('Call dentist 📅 2026-09-10', {
      title: 'Call dentist 📅 2026-09-10 #obsidian', // pre-Step-2 derivation
    });
    const conflicts = [];
    await syncObsidianVault(
      makeDir({ [`${DATE}.md`]: `## Tasks\n- [ ] Call the dentist 📅 2026-09-10 ^dg-${BLOCK}\n` }), '', 0,
      [], [existing], 'yyyy-MM-dd', (c) => conflicts.push(c),
    );
    expect(conflicts).toEqual([]); // reattach is idempotent: run replaced, not doubled
  });
});

describe('hazard 2 — the display-derivation bridge (pinned)', () => {
  it('an unrenamed old-style title upgrades to the stripped display on the next scan', async () => {
    const raw = 'Water plants ⏳ 2026-09-05';
    const existing = known(raw, { title: `${raw} #obsidian`, date: '2026-09-05', startTime: '00:00', isAllDay: true });
    const { scheduledTasks } = await scan(`- [ ] ${raw} ^dg-${BLOCK}`, [existing], []);
    expect(scheduledTasks[0].title).toBe('Water plants #obsidian');
  });

  it('a genuine dayGLANCE rename is preserved — the bridge never touches it', async () => {
    const raw = 'Water plants ⏳ 2026-09-05';
    const existing = known(raw, { title: 'Hydrate the ferns #obsidian', date: '2026-09-05', startTime: '00:00', isAllDay: true });
    const { scheduledTasks } = await scan(`- [ ] ${raw} ^dg-${BLOCK}`, [existing], []);
    expect(scheduledTasks[0].title).toBe('Hydrate the ferns #obsidian');
  });
});

describe('the retitle-carry (write-path change inside read support)', () => {
  it('a DG rename writes the line with its metadata intact — and the round trip re-imports cleanly', async () => {
    const raw = 'Water plants ⏳ 2026-09-05 🔁 every 3 days';
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] ${raw} ^dg-${BLOCK}` };
    // The writeback's derivation: display rename + carry from the frozen rawTitle.
    const newRawTitle = reattachTasksMetadata('Hydrate the ferns', raw);
    const updated = await writeTaskStateToFile(
      makeDir(vault), '', DATE, raw, false, null, newRawTitle, null, undefined, '## Tasks', BLOCK,
    );
    expect(updated).toBe(true);
    expect(vault[`${DATE}.md`]).toContain(`- [ ] Hydrate the ferns ⏳ 2026-09-05 🔁 every 3 days ^dg-${BLOCK}`);
    const { scheduledTasks } = parseTasksFromMarkdown(vault[`${DATE}.md`], DATE);
    expect(scheduledTasks[0]).toMatchObject({
      title: 'Hydrate the ferns #obsidian',
      date: '2026-09-05',
      obsidianRecurrence: true,
    });
  });
});

describe('the hook-layer preserve guard', () => {
  it('mergeObsidianTasks hands the scanned task to preserveAppFields so an adopted deadline is not stomped', () => {
    const old = { id: DG_ID, importSource: 'obsidian', deadline: '2026-09-20' };
    const scanned = { id: DG_ID, importSource: 'obsidian', deadline: '2026-09-12' }; // adoption's output
    // The hook's guard: only fill a deadline the scan produced NOTHING for.
    const preserve = (o, s = {}) => ({ ...(o.deadline && s.deadline === undefined ? { deadline: o.deadline } : {}) });
    const merged = mergeObsidianTasks([old], [scanned], new Set([DG_ID]), preserve);
    expect(merged.find((t) => t.id === DG_ID).deadline).toBe('2026-09-12');
    // …and still fills when the scan is silent.
    const scannedSilent = { id: DG_ID, importSource: 'obsidian' };
    const merged2 = mergeObsidianTasks([old], [scannedSilent], new Set([DG_ID]), preserve);
    expect(merged2.find((t) => t.id === DG_ID).deadline).toBe('2026-09-20');
  });
});
