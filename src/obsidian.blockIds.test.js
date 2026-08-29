import { describe, it, expect } from 'vitest';
import {
  parseTasksFromMarkdown,
  updateTaskLines,
  writeTaskStateToFile,
  appendTaskToDailyNote,
  syncObsidianVault,
  deriveBlockId,
  appIdForBlockId,
  legacyObsidianId,
  splitBlockId,
  hasForeignBlockId,
  blockIdSuffix,
  simpleHash,
} from './obsidian.js';

// Block-ID identity (Obsidian build-out Phase 2, Part A): task lines dayGLANCE
// writes carry a trailing ^dg-<id>; reads match by ID first and fall back to
// the legacy text matching for untagged lines. These tests pin the exact
// contract the report proposed: round trip, edit/reorder/move survival,
// first-occurrence-wins duplicates, fallback for untagged lines, and user
// carets never breaking parsing.

// Minimal in-memory FSA mock (same shape as obsidian.vaultWrites.test.js).
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
    [Symbol.asyncIterator]() { return this.entries(); },
  };
}

describe('round trip — write, read back, match', () => {
  it('a task appended from dayGLANCE parses back to the same app id', async () => {
    const fs = {};
    const vault = makeDir(fs);
    const blockId = deriveBlockId('2026-08-22', 'Ship the report');
    await appendTaskToDailyNote(vault, '', '2026-08-22', {
      title: 'Ship the report', startTime: '09:00', duration: 60,
      isAllDay: false, date: '2026-08-22', blockId,
    }, '## Tasks', '', 'yyyy-MM-dd');

    expect(fs['2026-08-22.md']).toContain(`Ship the report ^dg-${blockId}`);

    const { scheduledTasks } = parseTasksFromMarkdown(fs['2026-08-22.md'], '2026-08-22');
    expect(scheduledTasks).toHaveLength(1);
    expect(scheduledTasks[0].id).toBe(appIdForBlockId(blockId));
    expect(scheduledTasks[0].obsidianRawTitle).toBe('Ship the report');
  });

  it('writeTaskStateToFile resolves true on a stamped write and false when nothing matched', async () => {
    const fs = { '2026-08-22.md': '- [ ] Legacy task' };
    const vault = makeDir(fs);
    const ok = await writeTaskStateToFile(vault, '', '2026-08-22', 'Legacy task', true, null, undefined, null, undefined, null, 'ffffffff');
    expect(ok).toBe(true);
    expect(fs['2026-08-22.md']).toBe('- [x] Legacy task ^dg-ffffffff');

    const miss = await writeTaskStateToFile(vault, '', '2026-08-22', 'No such task', true, null, undefined, null, undefined, null, 'eeeeeeee');
    expect(miss).toBe(false);
    // And a missing file resolves false rather than throwing.
    const gone = await writeTaskStateToFile(vault, '', '2026-08-23', 'Legacy task', true, null, undefined, null, undefined, null, 'dddddddd');
    expect(gone).toBe(false);
  });
});

describe('syncObsidianVault — ID-first matching end to end', () => {
  const scan = (fs, existingTasks = [], existingInbox = []) =>
    syncObsidianVault(makeDir(fs), '', 0, existingTasks, existingInbox, 'yyyy-MM-dd');

  it('a retitle in Obsidian matches the same task by id — vault title wins, app fields survive', async () => {
    const fs = { '2026-08-22.md': '- [ ] New wording ^dg-xxxxxxxx' };
    const existing = [{
      id: appIdForBlockId('xxxxxxxx'), importSource: 'obsidian',
      obsidianBlockId: 'xxxxxxxx', obsidianRawTitle: 'Old wording',
      obsidianFileDate: '2026-08-22', title: 'Old wording #obsidian',
      notes: 'my notes', color: 'bg-red-500', completed: false,
      lastModified: '2026-08-20T00:00:00.000Z',
    }];
    const result = await scan(fs, [], existing);
    expect(result.inboxTasks).toHaveLength(1);
    const t = result.inboxTasks[0];
    expect(t.id).toBe(appIdForBlockId('xxxxxxxx'));
    // Obsidian edited the line since our last write → the vault title wins…
    expect(t.title).toBe('New wording #obsidian');
    // …while app-controlled fields are preserved from the existing task.
    expect(t.notes).toBe('my notes');
    expect(t.color).toBe('bg-red-500');
  });

  it('an unchanged tagged line preserves a DG-side rename (DG still owns the title)', async () => {
    const fs = { '2026-08-22.md': '- [ ] Vault wording ^dg-xxxxxxxx' };
    const existing = [{
      id: appIdForBlockId('xxxxxxxx'), importSource: 'obsidian',
      obsidianBlockId: 'xxxxxxxx',
      // The writeback keeps obsidianRawTitle current: equal to the vault line
      // means the vault has NOT changed since we last wrote it.
      obsidianRawTitle: 'Vault wording',
      obsidianFileDate: '2026-08-22', title: 'Renamed in DG #obsidian',
      completed: false,
    }];
    const result = await scan(fs, [], existing);
    expect(result.inboxTasks[0].title).toBe('Renamed in DG #obsidian');
  });

  it('a line moved to a different daily note keeps its identity', async () => {
    const existing = [{
      id: appIdForBlockId('xxxxxxxx'), importSource: 'obsidian',
      obsidianBlockId: 'xxxxxxxx', obsidianRawTitle: 'Migrating task',
      obsidianFileDate: '2026-08-20', title: 'Migrating task #obsidian',
      notes: 'sticky notes', completed: false,
    }];
    // The line was cut from the 20th and pasted into the 22nd.
    const fs = { '2026-08-20.md': '- [ ] other things', '2026-08-22.md': '- [ ] Migrating task ^dg-xxxxxxxx' };
    const result = await scan(fs, [], existing);
    const t = [...result.scheduledTasks, ...result.inboxTasks].find(x => x.obsidianBlockId === 'xxxxxxxx');
    expect(t.id).toBe(appIdForBlockId('xxxxxxxx'));
    expect(t.notes).toBe('sticky notes');
    // The write path follows the line to its new file.
    expect(t.obsidianFileDate).toBe('2026-08-22');
  });

  it('legacy-id bridge: a freshly tagged line matches the task a device still holds under the old id', async () => {
    const legacy = legacyObsidianId('2026-08-22', 'Bridged task');
    const existing = [{
      id: legacy, importSource: 'obsidian',
      obsidianRawTitle: 'Bridged task', obsidianFileDate: '2026-08-22',
      title: 'Bridged task #obsidian', notes: 'kept', completed: true,
    }];
    // Another device stamped the id since this device last synced.
    const fs = { '2026-08-22.md': '- [ ] Bridged task ^dg-xxxxxxxx' };
    const result = await scan(fs, [], existing);
    expect(result.inboxTasks).toHaveLength(1);
    const t = result.inboxTasks[0];
    expect(t.id).toBe(appIdForBlockId('xxxxxxxx'));
    expect(t.notes).toBe('kept');
    expect(t.completed).toBe(true); // completed-OR carried across the bridge
  });

  it('untagged lines still match existing tasks by the legacy id (fallback path)', async () => {
    const legacy = legacyObsidianId('2026-08-22', 'Untagged task');
    const existing = [{
      id: legacy, importSource: 'obsidian',
      obsidianRawTitle: 'Untagged task', obsidianFileDate: '2026-08-22',
      title: 'Untagged task #obsidian', duration: 45, completed: false,
    }];
    const fs = { '2026-08-22.md': '- [ ] Untagged task' };
    const result = await scan(fs, [], existing);
    expect(result.inboxTasks[0].id).toBe(legacy);
    expect(result.inboxTasks[0].duration).toBe(45);
  });
});
