import { describe, it, expect } from 'vitest';
import { writeTaskStateToFile, dailyNoteFilename } from './obsidian.js';

// AUDIT FIX H1 — the task-state writer resolves the daily-note FILENAME
// through the configured pattern, like every sibling path (the scan, the
// daily-note writers, the append, the intent emits). Before the fix it
// opened `${dateStr}.md` verbatim: on a custom-pattern vault the miss read
// as the benign "file gone" case (`updated: false`, no error, no retry), so
// completions, retitles, reschedules, and opportunistic stamps silently
// never reached the vault. These pins hold the writer to the pattern AND
// hold the default-pattern behavior byte-stable.

// In-memory FSA vault (the obsidian.blockIds.test.js shape).
function nfe() {
  const e = new Error('A requested file or directory could not be found.');
  e.name = 'NotFoundError';
  return e;
}
function makeFile(parent, name) {
  return {
    kind: 'file',
    name,
    async getFile() { return { text: async () => parent[name], lastModified: 1 }; },
    async createWritable() {
      let buf = '';
      return { write: async (c) => { buf += c; }, close: async () => { parent[name] = buf; } };
    },
  };
}
function makeDir(node, name = '') {
  return {
    kind: 'directory',
    name,
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
  };
}

const DATE = '2026-08-31';
const PATTERN = 'dd.MM.yyyy';
const NOTE = '# Day\n\n## Tasks\n- [ ] Buy milk ^dg-abc12345\n';

describe('writeTaskStateToFile — pattern-aware filename resolution (audit fix H1)', () => {
  it('THE H1 PIN: a custom-pattern vault gets its writeback — the patterned file is found and the line updates', async () => {
    const patternedName = dailyNoteFilename(DATE, PATTERN);
    expect(patternedName).toBe('31.08.2026.md'); // the fixture is honest
    const fs = { [patternedName]: NOTE };
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Buy milk', true, null, undefined, null, undefined,
      '## Tasks', 'abc12345', null, null, PATTERN,
    );
    expect(updated).toBe(true);
    expect(fs[patternedName]).toContain('- [x] Buy milk ^dg-abc12345');
    // And the ISO-named file it USED to open verbatim was never created.
    expect(fs[`${DATE}.md`]).toBeUndefined();
  });

  it('the pre-fix failure shape, pinned as the contrast: without the pattern the patterned file reads as the benign "file gone" no-op', async () => {
    const fs = { [dailyNoteFilename(DATE, PATTERN)]: NOTE };
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Buy milk', true, null, undefined, null, undefined,
      '## Tasks', 'abc12345', null, null, /* pattern omitted → default */
    );
    expect(updated).toBe(false); // silent no-op — exactly why H1 mattered
    expect(fs[dailyNoteFilename(DATE, PATTERN)]).toBe(NOTE); // untouched
  });

  it('default pattern unchanged: omitting the pattern still opens `${date}.md` and writes', async () => {
    const fs = { [`${DATE}.md`]: NOTE };
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Buy milk', true, null, undefined, null, undefined,
      '## Tasks', 'abc12345', null, null,
    );
    expect(updated).toBe(true);
    expect(fs[`${DATE}.md`]).toContain('- [x] Buy milk ^dg-abc12345');
  });
});
