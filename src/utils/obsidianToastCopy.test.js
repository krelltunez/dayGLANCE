import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { obsidianToastKey } from './obsidianToastCopy.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('obsidianToastKey — the holding posture names itself', () => {
  it('holding → the Bridge copy for both phases', () => {
    expect(obsidianToastKey('syncing', 'holding')).toBe('sync.obsidianToast.syncingBridge');
    expect(obsidianToastKey('success', 'holding')).toBe('sync.obsidianToast.syncedBridge');
  });
  it('plugin, direct, or no posture yet → the vault copy', () => {
    for (const posture of ['plugin', 'direct', undefined, null]) {
      expect(obsidianToastKey('syncing', posture)).toBe('sync.obsidianToast.syncing');
      expect(obsidianToastKey('success', posture)).toBe('sync.obsidianToast.synced');
    }
  });
});

// WIRING CANARY (2026-09-08): the toast reads bridgeHeartbeatRef from the
// sync context. #1556 added the ref to the deps object passed INTO
// useObsidianSync (the hook that RETURNS it) instead of the context object;
// the boot-crash fix removed it from there, and the toast's posture check
// read undefined on every platform — the relabel never fired. Pin both
// halves against the source: the context carries the ref, the hook's deps
// object does not, and the toast reads it from the context.
describe('App.jsx wiring: bridgeHeartbeatRef reaches the toast through the sync context', () => {
  const src = readFileSync(path.join(here, '..', 'App.jsx'), 'utf8');
  const objectAt = (anchor) => {
    const i = src.indexOf(anchor);
    expect(i, `anchor present: ${anchor}`).toBeGreaterThan(-1);
    const open = src.indexOf('{', i);
    let depth = 0;
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open, j + 1); }
    }
    throw new Error('unbalanced block');
  };
  it('the syncCtx object includes bridgeHeartbeatRef', () => {
    expect(objectAt('const syncCtx = {')).toMatch(/^\s*bridgeHeartbeatRef,/m);
  });
  it('the deps object handed to useObsidianSync does NOT carry the ref it returns (the boot crash)', () => {
    expect(objectAt('useObsidianSync({')).not.toMatch(/^\s*bridgeHeartbeatRef,/m);
  });
  it('the toast reads it from useSyncCtx', () => {
    const toast = readFileSync(path.join(here, '..', 'components', 'ObsidianSyncToast.jsx'), 'utf8');
    expect(toast).toMatch(/bridgeHeartbeatRef[^\n]*=\s*useSyncCtx\(\)/);
  });
});
