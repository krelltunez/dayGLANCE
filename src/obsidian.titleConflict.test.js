import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  detectTwoSidedRetitle,
  appendTitleConflictNote,
  stripObsidianDisplayTag,
  titleConflictNoticeText,
} from './utils/obsidianTitleConflict.js';
import { syncObsidianVault, writeTaskStateToFile } from './obsidian.js';

// The two-sided retitle policy: the vault wins the title; the dayGLANCE
// rename is preserved as a durable record on task.notes; the write-time
// guard funnels the write-first interleaving into the same scan-time policy.

// In-memory FSA mock (same shape as obsidian.blockIds.test.js).
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

beforeEach(() => {
  const m = new Map();
  global.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
});
afterEach(() => { delete global.localStorage; });

const DATE = '2026-08-30';
const BLOCK = 'aaaa1111';
const DG_ID = `obsidian-dg-${BLOCK}`;

// App state: the user renamed the task in dayGLANCE ('DG rename'), last
// observed vault title was 'Base title'.
const dgRenamedTask = (extra = {}) => ({
  id: DG_ID,
  title: 'DG rename #obsidian',
  obsidianRawTitle: 'Base title',
  obsidianBlockId: BLOCK,
  obsidianFileDate: DATE,
  importSource: 'obsidian',
  completed: false, notes: 'user note', subtasks: [], duration: 30,
  lastModified: '2026-08-30T10:00:00.000Z',
  ...extra,
});

const vaultWith = (line) => ({ [`${DATE}.md`]: `## Tasks\n${line}\n` });

describe('the three-string detection', () => {
  it('fires only when both sides moved off the base, to different texts', () => {
    const base = 'Base';
    expect(detectTwoSidedRetitle({ base, theirs: 'Vault edit', ours: 'DG edit' })).toBe(true);
    expect(detectTwoSidedRetitle({ base, theirs: 'Vault edit', ours: 'Base' })).toBe(false);   // one-sided vault
    expect(detectTwoSidedRetitle({ base, theirs: 'Base', ours: 'DG edit' })).toBe(false);      // one-sided DG
    expect(detectTwoSidedRetitle({ base, theirs: 'Same', ours: 'Same' })).toBe(false);         // convergent
    expect(detectTwoSidedRetitle({ base: undefined, theirs: 'X', ours: 'Y' })).toBe(false);    // no base
  });

  it('stripObsidianDisplayTag mirrors the writeback derivation', () => {
    expect(stripObsidianDisplayTag('DG rename #obsidian')).toBe('DG rename');
    expect(stripObsidianDisplayTag('Plain')).toBe('Plain');
  });
});

describe('the durable record (appendTitleConflictNote)', () => {
  it('appends once and is idempotent across repeats and devices', () => {
    const first = appendTitleConflictNote('user note', 'DG rename', DATE);
    expect(first).toBe(`user note\nRenamed in dayGLANCE to "DG rename" — Obsidian's edit won (${DATE}).`);
    // Repeat on the same device, or a second device that already synced the
    // note: same reference back, nothing stacked.
    expect(appendTitleConflictNote(first, 'DG rename', DATE)).toBe(first);
    // A second device that has NOT synced derives the identical line — the
    // deterministic-text unanimity trick — so either copy winning LWW is fine.
    const second = appendTitleConflictNote('user note', 'DG rename', DATE);
    expect(second).toBe(first);
    // A different, later rename is a new record, not a duplicate.
    expect(appendTitleConflictNote(first, 'Another rename', DATE)).toContain('Another rename');
  });
});

describe('scan-time policy — the single resolution point', () => {
  it('two-sided: vault wins the title, the DG rename lands in notes, the conflict is reported', async () => {
    const conflicts = [];
    const { scheduledTasks } = await syncObsidianVault(
      makeDir(vaultWith(`- [ ] Vault edit ^dg-${BLOCK}`)), '', 0,
      [dgRenamedTask()], [], 'yyyy-MM-dd', (c) => conflicts.push(c),
    );
    const task = scheduledTasks.find((t) => t.id === DG_ID);
    expect(task.title).toContain('Vault edit');
    expect(task.title).not.toContain('DG rename');
    expect(task.notes).toContain('user note');
    expect(task.notes).toContain('Renamed in dayGLANCE to "DG rename"');
    expect(conflicts).toEqual([{ dgTitle: 'DG rename', vaultTitle: 'Vault edit' }]);
  });

  it('repeated scans (and a second device) do not stack the record', async () => {
    const scan = (existing) => syncObsidianVault(
      makeDir(vaultWith(`- [ ] Vault edit ^dg-${BLOCK}`)), '', 0, existing, [], 'yyyy-MM-dd', null,
    );
    const first = (await scan([dgRenamedTask()])).scheduledTasks;
    // Feed the resolved state back through a second scan (same device), and
    // run an independent device from the same pre-conflict state.
    const second = (await scan(first)).scheduledTasks;
    const deviceB = (await scan([dgRenamedTask()])).scheduledTasks;
    const count = (s) => (s.match(/Renamed in dayGLANCE/g) || []).length;
    expect(count(second.find((t) => t.id === DG_ID).notes)).toBe(1);
    expect(deviceB.find((t) => t.id === DG_ID).notes).toBe(first.find((t) => t.id === DG_ID).notes);
  });

  it('one-sided vault retitle stays silent (no note, no report); one-sided DG rename is preserved', async () => {
    const conflicts = [];
    // Vault edited, DG did not (title still matches base).
    const oneSidedVault = (await syncObsidianVault(
      makeDir(vaultWith(`- [ ] Vault edit ^dg-${BLOCK}`)), '', 0,
      [dgRenamedTask({ title: 'Base title #obsidian' })], [], 'yyyy-MM-dd', (c) => conflicts.push(c),
    )).scheduledTasks.find((t) => t.id === DG_ID);
    expect(oneSidedVault.title).toContain('Vault edit');
    expect(oneSidedVault.notes).toBe('user note');
    // DG renamed, vault did not (line still the base).
    const oneSidedDg = (await syncObsidianVault(
      makeDir(vaultWith(`- [ ] Base title ^dg-${BLOCK}`)), '', 0,
      [dgRenamedTask()], [], 'yyyy-MM-dd', (c) => conflicts.push(c),
    )).scheduledTasks.find((t) => t.id === DG_ID);
    expect(oneSidedDg.title).toBe('DG rename #obsidian');
    expect(oneSidedDg.notes).toBe('user note');
    expect(conflicts).toEqual([]);
  });

  it('the failed-write amplifier presents as two-sided: a rename the vault never received, then an Obsidian edit', async () => {
    // #1459 semantics: the failed write left obsidianRawTitle at the base —
    // the app holds 'DG rename', the vault never saw it. Weeks later the
    // line is edited in Obsidian. Same three strings, same resolution.
    const conflicts = [];
    const task = (await syncObsidianVault(
      makeDir(vaultWith(`- [ ] Much later vault edit ^dg-${BLOCK}`)), '', 0,
      [dgRenamedTask()], [], 'yyyy-MM-dd', (c) => conflicts.push(c),
    )).scheduledTasks.find((t) => t.id === DG_ID);
    expect(task.title).toContain('Much later vault edit');
    expect(task.notes).toContain('Renamed in dayGLANCE to "DG rename"');
    expect(conflicts).toHaveLength(1);
  });
});

describe('write-time guard — the funnel (option 5)', () => {
  it('a state write onto a diverged line keeps the LINE title, writes the state, no conflict signal', async () => {
    const fs = vaultWith(`- [ ] Vault edit ^dg-${BLOCK}`);
    const conflicts = [];
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Base title', /* completed */ true, null, undefined, null, undefined,
      '## Tasks', BLOCK, (c) => conflicts.push(c),
    );
    expect(updated).toBe(true);
    expect(fs[`${DATE}.md`]).toContain(`- [x] Vault edit ^dg-${BLOCK}`); // state written, vault title kept
    expect(conflicts).toEqual([]); // nothing two-sided — no DG retitle in flight
  });

  it('a RETITLING write onto a diverged line keeps the line title, writes state, and signals the conflict', async () => {
    const fs = vaultWith(`- [ ] Vault edit ^dg-${BLOCK}`);
    const conflicts = [];
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Base title', true, null, 'DG rename', null, undefined,
      '## Tasks', BLOCK, (c) => conflicts.push(c),
    );
    expect(updated).toBe(true);
    expect(fs[`${DATE}.md`]).toContain(`- [x] Vault edit ^dg-${BLOCK}`);
    expect(fs[`${DATE}.md`]).not.toContain('DG rename');
    expect(conflicts).toEqual([{ lineTitle: 'Vault edit' }]);
  });

  it('a retitle onto an UN-diverged line writes normally — no signal', async () => {
    const fs = vaultWith(`- [ ] Base title ^dg-${BLOCK}`);
    const conflicts = [];
    await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Base title', false, null, 'DG rename', null, undefined,
      '## Tasks', BLOCK, (c) => conflicts.push(c),
    );
    expect(fs[`${DATE}.md`]).toContain(`DG rename ^dg-${BLOCK}`);
    expect(conflicts).toEqual([]);
  });

  it('a convergent edit (line already carries the title being written) is not a conflict', async () => {
    const fs = vaultWith(`- [ ] DG rename ^dg-${BLOCK}`);
    const conflicts = [];
    await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Base title', true, null, 'DG rename', null, undefined,
      '## Tasks', BLOCK, (c) => conflicts.push(c),
    );
    expect(fs[`${DATE}.md`]).toContain(`- [x] DG rename ^dg-${BLOCK}`);
    expect(conflicts).toEqual([]);
  });

  it('an untagged diverged line behaves as today: no match, benign false, nothing rewritten', async () => {
    const fs = vaultWith('- [ ] Vault edit');
    const conflicts = [];
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Base title', true, null, 'DG rename', null, undefined,
      '## Tasks', null, (c) => conflicts.push(c),
    );
    expect(updated).toBe(false);
    expect(fs[`${DATE}.md`]).toContain('- [ ] Vault edit');
    expect(conflicts).toEqual([]);
  });
});

describe('both interleavings resolve through the one policy point (b: delay, not loss)', () => {
  it('write-first: conflicted write defers the title; the rename survives in app state; the next scan resolves with the record', async () => {
    const fs = vaultWith(`- [ ] Vault edit ^dg-${BLOCK}`);
    // 1. The write-first interleaving: user completes + renames in DG while
    //    the vault line already moved. Guard keeps the vault title.
    let writeConflict = false;
    await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Base title', true, null, 'DG rename', null, undefined,
      '## Tasks', BLOCK, () => { writeConflict = true; },
    );
    expect(writeConflict).toBe(true);
    // 2. The caller (useObsidianSync) skips the titleUpdate commit on this
    //    signal, so app state STILL holds the rename and obsidianRawTitle
    //    still holds the base — model exactly that state:
    const appTask = dgRenamedTask({ completed: true });
    // 3. The next scan sees the clean two-sided divergence and resolves it
    //    through the same policy: vault title, durable record, one report.
    const conflicts = [];
    const resolved = (await syncObsidianVault(
      makeDir(fs), '', 0, [appTask], [], 'yyyy-MM-dd', (c) => conflicts.push(c),
    )).scheduledTasks.find((t) => t.id === DG_ID);
    expect(resolved.title).toContain('Vault edit');
    expect(resolved.notes).toContain('Renamed in dayGLANCE to "DG rename"');
    expect(resolved.completed).toBe(true); // the state change was never held hostage
    expect(conflicts).toHaveLength(1);
  });
});

describe('notice text', () => {
  it('is neutral and points at the durable record', () => {
    const text = titleConflictNoticeText('Vault edit');
    expect(text).toContain('Vault edit');
    expect(text).toMatch(/notes/i);
    expect(text).not.toMatch(/error|fail/i);
  });
});
