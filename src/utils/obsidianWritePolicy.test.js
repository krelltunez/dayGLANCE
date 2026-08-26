import { describe, it, expect, afterEach } from 'vitest';
import { OBSIDIAN_BLOCK_ID_WRITES, blockIdWritesEnabled, __setBlockIdWritesForTests } from './obsidianWritePolicy.js';
import { buildNewObsidianTaskMeta, simpleHash, blockIdSuffix } from '../obsidian.js';

afterEach(() => __setBlockIdWritesForTests(null));

describe('the read/write release gate', () => {
  it('SHIPS READ-ONLY: the constant is false until the write release flips it', () => {
    // This is the release switch itself. When shipping the write release,
    // flip OBSIDIAN_BLOCK_ID_WRITES to true in obsidianWritePolicy.js and
    // update THIS assertion — the failure is the reminder that the flip is a
    // release decision, not a side effect.
    expect(OBSIDIAN_BLOCK_ID_WRITES).toBe(false);
    expect(blockIdWritesEnabled()).toBe(false);
  });

  it('the test override forces either mode and restores the constant', () => {
    __setBlockIdWritesForTests(true);
    expect(blockIdWritesEnabled()).toBe(true);
    __setBlockIdWritesForTests(false);
    expect(blockIdWritesEnabled()).toBe(false);
    __setBlockIdWritesForTests(null);
    expect(blockIdWritesEnabled()).toBe(OBSIDIAN_BLOCK_ID_WRITES);
  });
});

describe('buildNewObsidianTaskMeta — creation-time identity under the gate', () => {
  it('read release: legacy content-derived id, no block id — the appended line round-trips through the token-less parse', () => {
    __setBlockIdWritesForTests(false);
    const meta = buildNewObsidianTaskMeta('Buy milk', '2026-08-27');
    expect(meta.id).toBe(`obsidian-2026-08-27-${simpleHash('Buy milk')}`);
    expect(meta.obsidianBlockId).toBeUndefined();
    expect(meta.obsidianRawTitle).toBe('Buy milk');
    // No block id → the line builder emits no token.
    expect(blockIdSuffix(meta.obsidianBlockId, 'Buy milk')).toBe('');
  });

  it('write release: dg block-id identity, and the line carries the matching token', () => {
    __setBlockIdWritesForTests(true);
    const meta = buildNewObsidianTaskMeta('Buy milk', '2026-08-27');
    expect(meta.obsidianBlockId).toMatch(/^[a-z0-9]{8}$/);
    expect(meta.id).toBe(`obsidian-dg-${meta.obsidianBlockId}`);
    expect(blockIdSuffix(meta.obsidianBlockId, 'Buy milk')).toBe(` ^dg-${meta.obsidianBlockId}`);
  });
});
