import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { ghostSuccessorId, containObsidianGhostRows, persistDerivedGhostRetirements, GHOST_TOKEN_RE } from './obsidianGhostRows.js';
import { legacyObsidianId, appIdForBlockId } from '../obsidian.js';

const DATE = '2026-08-26';
const BLOCK = 'k3x9q2mf';
const MANGLED = `Buy milk ^dg-${BLOCK}`;
const GHOST_ID = legacyObsidianId(DATE, MANGLED);
const DG_ID = appIdForBlockId(BLOCK);

// A ghost exactly as v4.7.0 mints one: legacy content-derived id over the
// MANGLED title (token swallowed as text), no block id, obsidian import.
const ghost = (extra = {}) => ({
  id: GHOST_ID,
  title: `${MANGLED} #obsidian`,
  obsidianRawTitle: MANGLED,
  obsidianFileDate: DATE,
  importSource: 'obsidian',
  completed: false, notes: '', subtasks: [], duration: 30,
  lastModified: '2026-08-26T10:00:00.000Z',
  ...extra,
});
const successor = (extra = {}) => ({
  id: DG_ID,
  title: 'Buy milk #obsidian',
  obsidianRawTitle: 'Buy milk',
  obsidianFileDate: DATE,
  obsidianBlockId: BLOCK,
  importSource: 'obsidian',
  completed: false, notes: '', subtasks: [], duration: 30,
  lastModified: '2026-08-26T11:00:00.000Z',
  ...extra,
});

describe('ghostSuccessorId — recognition rules 1–4 (precision over recall)', () => {
  it('recognizes the exact v4.7.0 mint: obsidian import, no block id, trailing token, hash-consistent id', () => {
    expect(ghostSuccessorId(ghost())).toBe(DG_ID);
  });

  it('rule 1: a non-obsidian row with the same text is never a ghost', () => {
    expect(ghostSuccessorId(ghost({ importSource: undefined }))).toBeNull();
    expect(ghostSuccessorId(ghost({ importSource: 'file' }))).toBeNull();
  });

  it('rule 2: a properly-adopted row (has obsidianBlockId) is never a ghost', () => {
    expect(ghostSuccessorId(ghost({ obsidianBlockId: BLOCK }))).toBeNull();
  });

  it('rule 3: the token must be the exact emitted shape, trailing', () => {
    expect(ghostSuccessorId(ghost({ obsidianRawTitle: `^dg-${BLOCK} Buy milk` }))).toBeNull(); // not trailing
    expect(ghostSuccessorId(ghost({ obsidianRawTitle: 'Buy milk ^dg-short' }))).toBeNull();    // 5 chars
    expect(ghostSuccessorId(ghost({ obsidianRawTitle: 'Buy milk ^dg-TOOLOUD1' }))).toBeNull(); // uppercase
    expect(ghostSuccessorId(ghost({ obsidianRawTitle: 'Buy milk ^quote1' }))).toBeNull();      // user block ref
    expect(ghostSuccessorId(ghost({ obsidianRawTitle: undefined }))).toBeNull();
  });

  it("rule 4: the id must be the legacy hash of the MANGLED title — a row that merely mentions a token isn't a mint of it", () => {
    // Same text, but the id doesn't derive from it (e.g. a task created in-app
    // whose title happens to contain token-like text, under a different id).
    expect(ghostSuccessorId(ghost({ id: `obsidian-${DATE}-zzzzzz` }))).toBeNull();
    expect(ghostSuccessorId(ghost({ id: 'task-uuid-1234' }))).toBeNull(); // no date segment
  });

  it('the emitted-token regex is anchored and exact', () => {
    expect(GHOST_TOKEN_RE.test('x ^dg-abcd1234')).toBe(true);
    expect(GHOST_TOKEN_RE.test('x ^dg-abcd1234 trailing')).toBe(false);
    expect(GHOST_TOKEN_RE.test('x^dg-abcd1234')).toBe(false); // no separating space
  });
});

describe('containObsidianGhostRows — rule 5 and the supersede', () => {
  it('drops a ghost OLDER than its live successor', () => {
    const { tasks, derived } = containObsidianGhostRows({ tasks: [successor(), ghost()], unscheduledTasks: [] });
    expect(tasks.map((t) => t.id)).toEqual([DG_ID]);
    expect(derived).toEqual({ [GHOST_ID]: DG_ID });
  });

  it("redirects a NEWER ghost's edits onto the successor — with the swallowed token SANITIZED out of the title", () => {
    const g = ghost({ completed: true, lastModified: '2026-08-26T12:00:00.000Z', title: `${MANGLED} #obsidian` });
    const { tasks } = containObsidianGhostRows({ tasks: [successor(), g], unscheduledTasks: [] });
    expect(tasks).toHaveLength(1);
    const s = tasks[0];
    expect(s.id).toBe(DG_ID);
    expect(s.obsidianBlockId).toBe(BLOCK);           // identity: successor's
    expect(s.obsidianRawTitle).toBe('Buy milk');     // identity: successor's
    expect(s.completed).toBe(true);                  // the old client's edit survives
    expect(s.title).not.toMatch(/\^dg-/);            // the corruption does not
    expect(s.lastModified).toBe('2026-08-26T12:00:00.000Z');
  });

  it('cross-list: a ghost in the inbox is contained by a successor living in the scheduled list', () => {
    const { unscheduledTasks } = containObsidianGhostRows({ tasks: [successor()], unscheduledTasks: [ghost()] });
    expect(unscheduledTasks).toEqual([]);
  });

  it('(b) successor NOT live → the record authorizes nothing; the row is left alone', () => {
    const input = { tasks: [ghost()], unscheduledTasks: [] };
    const out = containObsidianGhostRows(input);
    expect(out.tasks).toBe(input.tasks); // same array — untouched
    expect(out.derived).toEqual({});
  });

  it('(a) a legitimate title containing token-LIKE text is NOT eaten', () => {
    // The user's own test line, as a real untagged vault task: rules 1–4 all
    // pass (it IS an untagged vault import whose id hashes its own text) — so
    // rule 5 is the shield: no task with block id "testtest" is live, and the
    // row passes through untouched. Containing it would require the 8-char
    // string to coincide with a REAL live block id — at which point the row
    // is, by every observable property, a mint of that task's stamped line.
    const raw = 'Test three ^dg-testtest';
    const lookalike = ghost({ id: legacyObsidianId(DATE, raw), obsidianRawTitle: raw, title: `${raw} #obsidian` });
    const input = { tasks: [successor(), lookalike], unscheduledTasks: [] };
    const out = containObsidianGhostRows(input);
    expect(out.tasks).toBe(input.tasks);
    expect(out.derived).toEqual({});
  });
});

describe('persistDerivedGhostRetirements', () => {
  beforeEach(() => {
    const m = new Map();
    global.localStorage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: (k) => m.delete(k),
    };
  });
  afterAll(() => { delete global.localStorage; });

  it('records the derived retirement and the deletedTaskIds dual-write, like the write-commit does', () => {
    persistDerivedGhostRetirements({ [GHOST_ID]: DG_ID });
    const rec = JSON.parse(localStorage.getItem('day-planner-retired-task-ids'));
    expect(rec[GHOST_ID].successor).toBe(DG_ID);
    const tombs = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids'));
    expect(tombs[GHOST_ID]).toBeTruthy();
  });

  it('is a no-op for an empty derivation', () => {
    persistDerivedGhostRetirements({});
    expect(localStorage.getItem('day-planner-retired-task-ids')).toBeNull();
  });
});
