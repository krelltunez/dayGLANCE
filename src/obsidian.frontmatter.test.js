import { describe, it, expect } from 'vitest';
import {
  parseTasksFromMarkdown,
  writeTaskStateToFile,
  appendTaskToDailyNote,
  writeWikiNote,
  writeDailyNoteFile,
  deriveBlockId,
} from './obsidian.js';
import { dgFrontmatter, hasFrontmatter, withCreationFrontmatter } from './utils/obsidianFrontmatter.js';

// Phase 4, step 1: frontmatter on dayGLANCE-CREATED notes. These tests pin
// the two rules (emit on creation only; never emit a task-shaped line inside
// YAML) and the three claims the whole "frontmatter is safe" premise rests
// on — claims that held by observation on every client version and must now
// fail loudly if they ever stop being true.

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
const FM = 'aaaa1111';
const NOTE_WITH_FM = `---\ntitle: My day\ntags: [journal]\n---\n\n# Notes\nSome prose.\n\n## Tasks\n- [ ] Alpha ^dg-${FM}\n- [ ] Beta\n`;

describe('the never-emit-a-task-line rule (tested, not observed)', () => {
  it("dayGLANCE's own emitted frontmatter parses to ZERO tasks through the real parser", () => {
    // The pin the field set must never break: run the emitted block through
    // the actual task parser. A future field addition whose value renders as
    // a task-shaped line fails here.
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(dgFrontmatter('2026-09-01'), DATE);
    expect(scheduledTasks).toEqual([]);
    expect(inboxTasks).toEqual([]);
  });

  it('canary: WHY the rule exists — the parser has no --- awareness, so a task-shaped line inside YAML WOULD parse', () => {
    // Documents the hazard the rule guards against, on every client version.
    // If this ever fails, the parser grew frontmatter awareness and the rule
    // (and this file's premises) should be revisited.
    const evil = '---\nnotes:\n- [ ] looks like a task\n---\n';
    const { inboxTasks } = parseTasksFromMarkdown(evil, DATE);
    expect(inboxTasks).toHaveLength(1);
  });
});

describe('the v4.7.0-safety premises, pinned', () => {
  it('the task parser skips frontmatter lines — same tasks, same identities, with or without the block', () => {
    const body = `## Tasks\n- [ ] Alpha ^dg-${FM}\n- [ ] Beta\n`;
    const bare = parseTasksFromMarkdown(body, DATE);
    const fronted = parseTasksFromMarkdown(`---\ntitle: My day\n---\n${body}`, DATE);
    expect(fronted.scheduledTasks.map((t) => t.id)).toEqual(bare.scheduledTasks.map((t) => t.id));
    expect(fronted.inboxTasks.map((t) => t.id)).toEqual(bare.inboxTasks.map((t) => t.id));
  });

  it('a state write leaves everything above the task heading byte-identical (the sort is section-bounded)', async () => {
    const fs = { [`${DATE}.md`]: NOTE_WITH_FM };
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Alpha', true, null, undefined, null, undefined, '## Tasks', FM,
    );
    expect(updated).toBe(true);
    const written = fs[`${DATE}.md`];
    // Everything up to and including the heading is untouched.
    const preamble = NOTE_WITH_FM.slice(0, NOTE_WITH_FM.indexOf('## Tasks') + '## Tasks'.length);
    expect(written.startsWith(preamble)).toBe(true);
    expect(written).toContain('- [x] Alpha');
  });

  it('the daily-note editor path round-trips frontmatter as opaque text', async () => {
    const fs = {};
    await writeDailyNoteFile(makeDir(fs), '', DATE, NOTE_WITH_FM, 'yyyy-MM-dd');
    expect(fs[`${DATE}.md`]).toBe(NOTE_WITH_FM); // verbatim — no parsing, no reformatting
  });

  it('appending a task to an EXISTING frontmatter’d note preserves the block and adds no second one', async () => {
    const fs = { [`${DATE}.md`]: NOTE_WITH_FM };
    await appendTaskToDailyNote(makeDir(fs), '', DATE, { title: 'New task', date: DATE, isAllDay: true }, '## Tasks', '# Template', 'yyyy-MM-dd');
    const written = fs[`${DATE}.md`];
    expect(written.startsWith('---\ntitle: My day\n')).toBe(true);
    expect(written.match(/^---$/gm)).toHaveLength(2); // exactly the user's one block
    expect(written).toContain('- [ ] New task');
  });

  it('a heading-less note appends at the END — after the frontmatter, never inside it', async () => {
    const fs = { [`${DATE}.md`]: '---\ntitle: My day\n---\nJust prose.' };
    await appendTaskToDailyNote(makeDir(fs), '', DATE, { title: 'New task', date: DATE, isAllDay: true }, '## Tasks', '', 'yyyy-MM-dd');
    const written = fs[`${DATE}.md`];
    expect(written.startsWith('---\ntitle: My day\n---\nJust prose.')).toBe(true);
    expect(written.indexOf('- [ ] New task')).toBeGreaterThan(written.indexOf('Just prose.'));
  });
});

describe('emission on CREATION only', () => {
  it('a daily note instantiated from a template gets the creation frontmatter', async () => {
    const fs = {};
    await appendTaskToDailyNote(makeDir(fs), '', DATE, { title: 'First task', date: DATE, isAllDay: true }, '## Tasks', '# My day\n', 'yyyy-MM-dd');
    const written = fs[`${DATE}.md`];
    expect(written.startsWith(`---\ncreated: ${DATE}\nsource: dayGLANCE\n---\n# My day`)).toBe(true);
    expect(written).toContain('- [ ] First task');
  });

  it("a template that opens with its OWN frontmatter wins — dayGLANCE's is not added", async () => {
    const fs = {};
    const template = '---\ntags: [daily]\n---\n# My day\n';
    await appendTaskToDailyNote(makeDir(fs), '', DATE, { title: 'First task', date: DATE, isAllDay: true }, '## Tasks', template, 'yyyy-MM-dd');
    const written = fs[`${DATE}.md`];
    expect(written.startsWith('---\ntags: [daily]\n---\n')).toBe(true);
    expect(written).not.toContain('source: dayGLANCE');
  });

  it('a created wiki note gets the block; note-body content already opening with --- is not double-wrapped', async () => {
    const fs = {};
    await writeWikiNote(makeDir(fs), 'Own Frontmatter', '---\ncustom: yes\n---\nbody', 'dayGLANCE');
    expect(fs.dayGLANCE['Own Frontmatter.md']).toBe('---\ncustom: yes\n---\nbody');
  });
});

describe('helpers', () => {
  it('hasFrontmatter / withCreationFrontmatter basics', () => {
    expect(hasFrontmatter('---\nx: 1\n---\n')).toBe(true);
    expect(hasFrontmatter('body')).toBe(false);
    expect(hasFrontmatter('')).toBe(false);
    expect(withCreationFrontmatter('body', '2026-09-01')).toBe('---\ncreated: 2026-09-01\nsource: dayGLANCE\n---\nbody');
    expect(withCreationFrontmatter('---\nmine\n---\n', '2026-09-01')).toBe('---\nmine\n---\n');
  });

  it('frontmatter presence does not perturb deterministic block-id derivation inputs', () => {
    // Belt and braces: derivation reads (date, rawTitle) only — a frontmatter
    // block in the file cannot reach it. Same tokens either way.
    const { scheduledTasks } = parseTasksFromMarkdown(`---\nx: 1\n---\n## Tasks\n- [ ] Gamma\n`, DATE);
    expect(deriveBlockId(DATE, scheduledTasks[0]?.obsidianRawTitle ?? 'Gamma')).toBe(deriveBlockId(DATE, 'Gamma'));
  });
});
