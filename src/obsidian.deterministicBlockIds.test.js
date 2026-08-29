import { describe, it, expect } from 'vitest';
import {
  deriveBlockId,
  buildNewObsidianTaskMeta,
  writeTaskStateToFile,
  splitBlockId,
} from './obsidian.js';
import { __setBlockIdWritesForTests } from './utils/obsidianWritePolicy.js';
import { afterEach } from 'vitest';

// Deterministic block-id minting (the echo-stamp decision): the token is a
// pure function of (daily-note date, raw title as written), so every device
// minting for "the same" line derives the SAME token — one logical edit
// produces one token by UNANIMITY rather than election. These tests pin the
// property, the pinned normalization, and the FROZEN algorithm itself.

afterEach(() => __setBlockIdWritesForTests(null));

// Minimal in-memory FSA mock (same shape as obsidian.blockIds.test.js).
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

const DATE = '2026-08-29';
const TITLE = 'Ship the report';

describe('unanimity: independent devices derive the same token', () => {

  it('an N-way mint produces IDENTICAL vault lines on every device — nothing to reconcile or reap', async () => {
    // Three vault copies of the same untagged note; three devices each mint
    // independently and stamp their own copy (the echo-stamp scenario: a
    // completion syncing under the legacy id fires every device's writeback).
    const copies = [{}, {}, {}];
    const NOTE = `## Tasks\n- [ ] ${TITLE}\n`;
    for (const fs of copies) fs[`${DATE}.md`] = NOTE;

    for (const fs of copies) {
      const minted = deriveBlockId(DATE, TITLE); // each device derives its own
      const updated = await writeTaskStateToFile(
        makeDir(fs), '', DATE, TITLE, true, null, undefined, null, undefined, '## Tasks', minted,
      );
      expect(updated).toBe(true);
    }

    const results = copies.map((fs) => fs[`${DATE}.md`]);
    expect(results[1]).toBe(results[0]); // byte-identical
    expect(results[2]).toBe(results[0]);
    expect(results[0]).toContain(`^dg-${deriveBlockId(DATE, TITLE)}`);
  });

  it('buildNewObsidianTaskMeta mints the same derived identity on every device', () => {
    __setBlockIdWritesForTests(true);
    const a = buildNewObsidianTaskMeta(TITLE, DATE);
    const b = buildNewObsidianTaskMeta(TITLE, DATE);
    expect(a.obsidianBlockId).toBe(deriveBlockId(DATE, TITLE));
    expect(a.id).toBe(b.id);
  });
});

describe('retitle and existing-token behavior (d)', () => {

  it('a retitling write stamps the token derived from the NEW title (the title the line will carry)', async () => {
    const fs = { [`${DATE}.md`]: `## Tasks\n- [ ] Old title\n` };
    const mintedFromNew = deriveBlockId(DATE, 'New title');
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, 'Old title', false, null, 'New title', null, undefined, '## Tasks', mintedFromNew,
    );
    expect(updated).toBe(true);
    expect(fs[`${DATE}.md`]).toContain(`New title ^dg-${mintedFromNew}`);
    // A later device deriving from the parsed line reaches the same input.
    const { text, blockId } = splitBlockId(`New title ^dg-${mintedFromNew}`);
    expect(deriveBlockId(DATE, text)).toBe(blockId);
  });

  it('an existing (randomly minted) token is preserved untouched through a write — no re-derivation', async () => {
    const randomToken = 'zk9q2mfx'; // pre-deterministic vintage
    const fs = { [`${DATE}.md`]: `## Tasks\n- [ ] ${TITLE} ^dg-${randomToken}\n` };
    const updated = await writeTaskStateToFile(
      makeDir(fs), '', DATE, TITLE, true, null, undefined, null, undefined, '## Tasks', randomToken,
    );
    expect(updated).toBe(true);
    expect(fs[`${DATE}.md`]).toContain(`^dg-${randomToken}`);
    expect(fs[`${DATE}.md`]).not.toContain(deriveBlockId(DATE, TITLE));
  });
});

describe('collisions (c): same profile and same behavior as today', () => {
  it('two identical untagged lines get ONE token stamped on both by a single write — as random minting already did', async () => {
    // updateTaskLines' untagged fallback stamps EVERY matching line with the
    // one id being assigned; random minting already collapsed identical
    // duplicates this way. Derivation reproduces it byte-for-byte.
    const fs = { [`${DATE}.md`]: `## Tasks\n- [ ] ${TITLE}\n- [ ] ${TITLE}\n` };
    const minted = deriveBlockId(DATE, TITLE);
    await writeTaskStateToFile(
      makeDir(fs), '', DATE, TITLE, true, null, undefined, null, undefined, '## Tasks', minted,
    );
    const stamped = fs[`${DATE}.md`].split('\n').filter((l) => l.includes('^dg-'));
    expect(stamped).toHaveLength(2);
    expect(stamped[0]).toBe(stamped[1]);
  });
});
