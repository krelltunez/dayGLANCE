import { describe, it, expect } from 'vitest';
import { writeWikiNote, writeDailyNoteFile } from './obsidian.js';

// The creation-only portability gate, and above all its ORDERING: the
// existence check runs BEFORE the validator, so a file already in the vault
// is written whatever its name (the portability harm is only in creating NEW
// unportable names), while creation of an invalid name is refused with the
// unchanged message.

// Minimal in-memory FSA mock. Structure: nested objects, string = file content.
function nfe() {
  const e = new Error('A requested file or directory could not be found.');
  e.name = 'NotFoundError';
  return e;
}
function makeFile(parent, name) {
  return {
    kind: 'file',
    name,
    async getFile() {
      return { text: async () => parent[name], lastModified: 1 };
    },
    async createWritable() {
      let buf = '';
      return {
        write: async (chunk) => { buf += chunk; },
        close: async () => { parent[name] = buf; },
      };
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
    async *entries() {
      for (const [n, v] of Object.entries(node)) {
        yield [n, typeof v === 'string' ? makeFile(node, n) : makeDir(v, n)];
      }
    },
  };
}

describe('writeWikiNote — existence check BEFORE the portability gate', () => {
  it('invalid name, file already exists → write proceeds, no error — twice in a row', async () => {
    const fs = { 'emails: urgent?.md': 'old' };
    const vault = makeDir(fs);
    await writeWikiNote(vault, 'emails: urgent?', 'first write');
    expect(fs['emails: urgent?.md']).toBe('first write');
    await writeWikiNote(vault, 'emails: urgent?', 'second write');
    expect(fs['emails: urgent?.md']).toBe('second write');
  });

  it('invalid name in a subfolder, file exists → write proceeds (bare-name vault search)', async () => {
    const fs = { archive: { 'CON.md': 'old' } };
    await writeWikiNote(makeDir(fs), 'CON', 'updated');
    expect(fs.archive['CON.md']).toBe('updated');
  });

  it('invalid name, file does NOT exist → refused with the unchanged message; nothing created', async () => {
    const fs = { 'other.md': 'x' };
    const err = await writeWikiNote(makeDir(fs), 'emails: urgent?', 'body').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('cannot create note "emails: urgent?"');
    expect(err.message).toContain(':');
    expect(err.code).toBe('unportable_name');
    expect(err.reason).toBeTruthy();
    expect(Object.keys(fs)).toEqual(['other.md']); // no file, no folder side effects
  });

  it('explicit Folder/Name path: existing invalid file writes; missing invalid file refuses without creating the folder chain', async () => {
    const fs = { projects: { 'notes?.md': 'old' } };
    await writeWikiNote(makeDir(fs), 'projects/notes?', 'updated');
    expect(fs.projects['notes?.md']).toBe('updated');

    const err = await writeWikiNote(makeDir(fs), 'newdir/notes?', 'body').catch((e) => e);
    expect(err.code).toBe('unportable_name');
    expect(fs.newdir).toBeUndefined(); // the existence probe must not create directories
  });

  it('valid name, missing → created in newNotesFolder; valid name, existing → written in place', async () => {
    const fs = {};
    await writeWikiNote(makeDir(fs), 'Fresh note', 'hello', 'dayGLANCE');
    expect(fs.dayGLANCE['Fresh note.md']).toBe('hello');
    await writeWikiNote(makeDir(fs), 'Fresh note', 'hello again', 'dayGLANCE');
    expect(fs.dayGLANCE['Fresh note.md']).toBe('hello again');
  });

  it('an invalid newNotesFolder only matters when a note must be created there', async () => {
    const fs = { 'Existing.md': 'old' };
    // Existing note: bad folder setting is irrelevant — the write lands in place.
    await writeWikiNote(makeDir(fs), 'Existing', 'new', 'bad?folder');
    expect(fs['Existing.md']).toBe('new');
    // New note: the folder would have to be created — refused.
    const err = await writeWikiNote(makeDir(fs), 'Fresh', 'body', 'bad?folder').catch((e) => e);
    expect(err.code).toBe('unportable_name');
    expect(err.message).toContain('new-notes folder');
  });
});

describe('daily-note writes — same ordering via getDailyNoteHandleForWrite', () => {
  it('legacy bad pattern, file already exists → write proceeds', async () => {
    const fs = { daily: { 'notes: 2026-08-10.md': 'old' } };
    await writeDailyNoteFile(makeDir(fs), 'daily', '2026-08-10', 'updated', 'notes: yyyy-MM-dd');
    expect(fs.daily['notes: 2026-08-10.md']).toBe('updated');
  });

  it('bad pattern, file missing → refused naming the pattern; nothing created', async () => {
    const fs = { daily: {} };
    const err = await writeDailyNoteFile(makeDir(fs), 'daily', '2026-08-10', 'body', 'notes: yyyy-MM-dd').catch((e) => e);
    expect(err.message).toContain('renders an unusable filename');
    expect(err.message).toContain('notes: yyyy-MM-dd');
    expect(Object.keys(fs.daily)).toEqual([]);
  });

  it('default pattern → creates and writes', async () => {
    const fs = { daily: {} };
    await writeDailyNoteFile(makeDir(fs), 'daily', '2026-08-10', 'today', undefined);
    expect(fs.daily['2026-08-10.md']).toBe('today');
  });
});
