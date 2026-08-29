import { describe, it, expect, afterEach } from 'vitest';
import {
  writeTaskStateToFile,
  appendTaskToDailyNote,
  writeWikiNote,
  writeDailyNoteFile,
} from './obsidian.js';
import { applyBridgeIntent } from '@glance-apps/obsidian-format';
import { __setBlockIdWritesForTests } from './utils/obsidianWritePolicy.js';

// THE CONVERGENCE PIN (spec §6 Phase 6: "applied output must be a pure
// function of the intent"). While the stream runs alongside direct access,
// a paired vault copy has TWO writers for the same operation — the direct
// transport and the plugin's applyBridgeIntent. These tests prove they
// produce byte-identical files from the same starting content, so whichever
// side lands first, the other's application is a byte-level no-op and
// Obsidian Sync never sees two divergent copies of "the same" write.

// In-memory FSA mock shared with obsidian.vaultWrites.test.js (structure:
// nested objects, string = file content).
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
      for (const [n, v] of Object.entries(node)) {
        yield [n, typeof v === 'string' ? makeFile(node, n) : makeDir(v, n)];
      }
    },
    [Symbol.asyncIterator]() { return this.entries(); },
  };
}

afterEach(() => __setBlockIdWritesForTests(null));

describe('task_state / task_retitle converge with writeTaskStateToFile', () => {
  const NOTE = '# Day\n\n## Tasks\n- [ ] 09:00 Write report ^dg-abc12345\n- [ ] 14:00 Other thing ^dg-zzz99999\n';

  it('completion write: direct transport output === pure application output', async () => {
    const fs = { '2026-08-29.md': NOTE };
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', '2026-08-29', 'Write report', true, '09:00',
      undefined, null, undefined, '## Tasks', 'abc12345', null, null,
    );
    expect(updated).toBe(true);
    const viaIntent = applyBridgeIntent(NOTE, {
      type: 'task_state', path: '2026-08-29.md', date: '2026-08-29',
      obsidianRawTitle: 'Write report', completed: true, startTime: '09:00',
      duration: null, taskHeading: '## Tasks', blockId: 'abc12345',
      completedAt: null, completionFormat: null,
    });
    expect(viaIntent.text).toBe(fs['2026-08-29.md']);
  });

  it('retitle + completion marker: byte-identical, including the ✅ emission', async () => {
    const fs = { '2026-08-29.md': NOTE };
    await writeTaskStateToFile(
      makeDir(fs), '', '2026-08-29', 'Write report', true, '09:00',
      'Write the report', null, undefined, '## Tasks', 'abc12345', null,
      { completedAt: '2026-08-29T10:00:00-05:00', format: 'tasks' },
    );
    const viaIntent = applyBridgeIntent(NOTE, {
      type: 'task_retitle', path: '2026-08-29.md', date: '2026-08-29',
      obsidianRawTitle: 'Write report', completed: true, startTime: '09:00',
      newRawTitle: 'Write the report', duration: null, taskHeading: '## Tasks',
      blockId: 'abc12345', completedAt: '2026-08-29T10:00:00-05:00', completionFormat: 'tasks',
    });
    expect(viaIntent.text).toBe(fs['2026-08-29.md']);
    expect(fs['2026-08-29.md']).toContain('Write the report');
    expect(fs['2026-08-29.md']).toContain('✅ 2026-08-29');
  });

  it('double application after the direct write is a byte-level no-op (the two-writer story)', async () => {
    const fs = { '2026-08-29.md': NOTE };
    const intent = {
      type: 'task_state', path: '2026-08-29.md', date: '2026-08-29',
      obsidianRawTitle: 'Write report', completed: true, startTime: '09:00',
      duration: null, taskHeading: '## Tasks', blockId: 'abc12345',
      completedAt: null, completionFormat: null,
    };
    await writeTaskStateToFile(
      makeDir(fs), '', '2026-08-29', 'Write report', true, '09:00',
      undefined, null, undefined, '## Tasks', 'abc12345', null, null,
    );
    const replay = applyBridgeIntent(fs['2026-08-29.md'], intent);
    expect(replay.changed).toBe(false);
  });
});

describe('task_append converges with appendTaskToDailyNote', () => {
  const TASK = { title: 'New thing #obsidian', startTime: null, duration: null, isAllDay: true, date: '2026-08-29', blockId: 'def67890' };
  const INTENT = {
    type: 'task_append', path: '2026-08-29.md', date: '2026-08-29',
    task: TASK, heading: '## Tasks', template: '# My day\n',
  };

  it('existing note: identical placement and sort', async () => {
    const NOTE = '# Day\n\n## Tasks\n- [ ] 08:00 Early ^dg-aaa11111\n';
    const fs = { '2026-08-29.md': NOTE };
    await appendTaskToDailyNote(makeDir(fs), '', '2026-08-29', TASK, '## Tasks', '# My day\n', 'yyyy-MM-dd');
    const viaIntent = applyBridgeIntent(NOTE, INTENT);
    expect(viaIntent.text).toBe(fs['2026-08-29.md']);
  });

  it('absent note: identical template instantiation, creation frontmatter included', async () => {
    const fs = {};
    await appendTaskToDailyNote(makeDir(fs), '', '2026-08-29', TASK, '## Tasks', '# My day\n', 'yyyy-MM-dd');
    const viaIntent = applyBridgeIntent(null, INTENT);
    expect(viaIntent.text).toBe(fs['2026-08-29.md']);
  });

  it('applying after the direct append landed is a no-op — no doubled line', async () => {
    const fs = {};
    await appendTaskToDailyNote(makeDir(fs), '', '2026-08-29', TASK, '## Tasks', '# My day\n', 'yyyy-MM-dd');
    const replay = applyBridgeIntent(fs['2026-08-29.md'], INTENT);
    expect(replay.changed).toBe(false);
  });
});

describe('note writes converge', () => {
  it('daily_note_write matches writeDailyNoteFile byte-for-byte', async () => {
    const fs = {};
    await writeDailyNoteFile(makeDir(fs), '', '2026-08-29', 'today was fine', 'yyyy-MM-dd');
    const viaIntent = applyBridgeIntent(null, { type: 'daily_note_write', path: '2026-08-29.md', content: 'today was fine' });
    expect(viaIntent.text).toBe(fs['2026-08-29.md']);
  });

  it('wiki_note_write: creation decoration matches writeWikiNote; existing-note write matches too', async () => {
    const fs = {};
    await writeWikiNote(makeDir(fs), 'Fresh note', 'hello', 'dayGLANCE');
    const created = applyBridgeIntent(null, { type: 'wiki_note_write', noteName: 'Fresh note', content: 'hello', newNotesFolder: 'dayGLANCE' });
    expect(created.text).toBe(fs.dayGLANCE['Fresh note.md']);

    await writeWikiNote(makeDir(fs), 'Fresh note', 'hello again', 'dayGLANCE');
    const updated = applyBridgeIntent(created.text, { type: 'wiki_note_write', noteName: 'Fresh note', content: 'hello again', newNotesFolder: 'dayGLANCE' });
    expect(updated.text).toBe(fs.dayGLANCE['Fresh note.md']);
  });
});
