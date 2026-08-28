import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeTaskStateToFile, writeTaskStateNative, deriveBlockId } from './obsidian.js';

// The no-op write skip (Phase 3 content-hash change detection): a write whose
// byte-identical output equals what was just read is skipped — the vault
// already carries the state. Churn reducer only: it never changes WHAT gets
// written, only WHETHER an identical write happens.

function nfe() { const e = new Error('nf'); e.name = 'NotFoundError'; return e; }
function makeFile(parent, name, counters) {
  return {
    kind: 'file', name,
    async getFile() { counters.reads++; return { text: async () => parent[name], lastModified: 1 }; },
    async createWritable() {
      let buf = '';
      return {
        write: async (c) => { buf += c; },
        close: async () => { counters.writes++; parent[name] = buf; },
      };
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

const DATE = '2026-08-31';
const BLOCK = 'aaaa1111';
const echoWrite = (handle) => writeTaskStateToFile(
  handle, '', DATE, 'Alpha', /* completed */ true, null, undefined, null, undefined, '## Tasks', BLOCK,
);

describe('desktop no-op write skip', () => {
  it('pins the echo sequence: the FIRST echo normalizes (writes), the second is byte-identical (skipped), updated true both times', async () => {
    // The vault copy already carries the state (device A wrote it, Obsidian
    // Sync delivered) — WITH the trailing newline Obsidian keeps on files.
    const counters = { reads: 0, writes: 0 };
    const vault = { [`${DATE}.md`]: `## Tasks\n- [x] Alpha ^dg-${BLOCK}\n` };
    const handle = makeDir(vault, counters);

    // First echo: sortTaskLinesInSection normalizes (drops the trailing
    // blank), so the output is byte-DIFFERENT and the write correctly
    // happens — the file converges to canonical form once.
    expect(await echoWrite(handle)).toBe(true);
    expect(counters.writes).toBe(1);
    expect(vault[`${DATE}.md`]).toBe(`## Tasks\n- [x] Alpha ^dg-${BLOCK}`);

    // Second and later echoes: byte-identical output → skipped.
    expect(await echoWrite(handle)).toBe(true);
    expect(await echoWrite(handle)).toBe(true);
    expect(counters.writes).toBe(1); // still just the one normalizing write
    expect(counters.reads).toBe(3);  // the pre-write read still happens every time
  });

  it('a genuinely different state still writes', async () => {
    const counters = { reads: 0, writes: 0 };
    const vault = { [`${DATE}.md`]: `## Tasks\n- [ ] Alpha ^dg-${BLOCK}` };
    const handle = makeDir(vault, counters);
    expect(await echoWrite(handle)).toBe(true);
    expect(counters.writes).toBe(1);
    expect(vault[`${DATE}.md`]).toContain('- [x] Alpha');
  });

  it('a skipped write still returns true so the caller COMMITS — adopting a token another device already stamped', async () => {
    // Device A deterministically minted and stamped; device B's echo write
    // derives the SAME token (#1464) and produces identical bytes. The write
    // is skipped, but B must still commit the block-id adoption — the vault
    // line carries exactly the state B asked for.
    const minted = deriveBlockId(DATE, 'Alpha');
    const counters = { reads: 0, writes: 0 };
    const vault = { [`${DATE}.md`]: `## Tasks\n- [x] Alpha ^dg-${minted}` };
    const handle = makeDir(vault, counters);
    const updated = await writeTaskStateToFile(
      handle, '', DATE, 'Alpha', true, null, undefined, null, undefined, '## Tasks', minted,
    );
    expect(updated).toBe(true);
    expect(counters.writes).toBe(0);
  });
});

describe('native no-op write skip', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { delete global.window; vi.restoreAllMocks(); });

  it('identical output skips bridge.writeDailyNote, returns true; different output writes', () => {
    const canonical = `## Tasks\n- [x] Alpha ^dg-${BLOCK}`;
    const bridge = {
      getDailyNote: vi.fn(() => canonical),
      writeDailyNote: vi.fn(() => true),
    };
    global.window = { DayGlanceObsidian: bridge };
    expect(writeTaskStateNative(DATE, 'Alpha', true, null, undefined, null, undefined, '## Tasks', BLOCK)).toBe(true);
    expect(bridge.writeDailyNote).not.toHaveBeenCalled(); // skipped — no write, no Obsidian wake

    bridge.getDailyNote = vi.fn(() => `## Tasks\n- [ ] Alpha ^dg-${BLOCK}`);
    expect(writeTaskStateNative(DATE, 'Alpha', true, null, undefined, null, undefined, '## Tasks', BLOCK)).toBe(true);
    expect(bridge.writeDailyNote).toHaveBeenCalledTimes(1);
  });
});
