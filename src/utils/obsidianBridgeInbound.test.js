import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  deriveBridgeSubkey,
  sealBridgeEnvelope,
  observationEntityId,
} from '@glance-apps/obsidian-format';
import {
  fetchBridgeObservations,
  commitBridgeObservationCursor,
  applyBridgeObservations,
} from './obsidianBridgeInbound.js';

// The inbound half's load-bearing claims: observations flow through the
// SAME per-note pipeline as a scan (title ownership, per-field adoption —
// §3.10 lives in one place), the deletion detector's baselines are never
// touched, the cursor advances only when the caller commits it, and rows
// sealed under a rotated-away generation are skipped, not fatal.

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
const OBS_HWM_KEY = 'dayglance-bridge-obs-hwm';
const SALT = new Uint8Array(16).fill(5);
const SALT_B64 = btoa(String.fromCharCode(...SALT));
const META = { v: 1, kind: 'pairing-meta', generation: SALT_B64, pairingSalt: SALT_B64, pairedAt: '2026-08-29T00:00:00Z' };

const nativeStub = { get: () => null, store: () => {} };

beforeEach(async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({
    enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1',
  }));
  const { __resetBridgeStreamForTests } = await import('./obsidianBridgeStream.js');
  __resetBridgeStreamForTests();
  await setupDbRootKey('pw', new Uint8Array(16).fill(9), {
    nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store,
  });
});
afterEach(async () => {
  await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
  delete globalThis.localStorage;
  delete globalThis.fetch;
});

describe('fetchBridgeObservations', () => {
  it('decrypts observation rows, keeps per-path latest, ignores intent rows, and does NOT advance the cursor', async () => {
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    const obsId = await observationEntityId('2026-08-29.md');
    const rows = [
      { entityId: 'int:abc', seq: 1, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'intent', type: 'daily_note_write' }) },
      { entityId: obsId, seq: 2, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path: '2026-08-29.md', content: 'old', mtime: 1000, observedAt: 'x' }) },
      { entityId: obsId, seq: 3, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path: '2026-08-29.md', content: 'new', mtime: 2000, observedAt: 'y' }) },
      { entityId: 'obs:deadbeef', seq: 4, envelope: 'not decryptable (rotated generation)' },
    ];
    globalThis.fetch = async (url) => {
      if (url.includes('/meta')) return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: JSON.stringify(META) }) };
      if (url.includes('/list')) return { ok: true, status: 200, json: async () => ({ rows, hasMore: false }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const result = await fetchBridgeObservations();
    expect(result.maxSeq).toBe(4);
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({ path: '2026-08-29.md', content: 'new' });
    // Cursor untouched until the caller has durably applied the batch.
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe(null);
    commitBridgeObservationCursor(result.maxSeq);
    expect(localStorage.getItem(OBS_HWM_KEY)).toBe('4');
  });

  it('unpaired (no meta row) → null, and nothing touched', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchBridgeObservations()).toBe(null);
  });
});

describe('applyBridgeObservations', () => {
  const NOTE = '## Tasks\n- [ ] 09:00 Vault task #obsidian ^dg-abc12345\n';

  it('an observed daily note flows through the real scan pipeline — parse, existing-task merge, app-field ownership', () => {
    const existing = [{
      id: 'obsidian-dg-abc12345', importSource: 'obsidian', obsidianBlockId: 'abc12345',
      obsidianRawTitle: 'Vault task', title: 'Vault task #obsidian', date: '2026-08-29',
      completed: false, color: 'bg-purple-500', duration: 45, lastModified: '2026-08-20T00:00:00Z',
    }];
    const out = applyBridgeObservations(
      [{ path: 'Daily/2026-08-29.md', content: NOTE, mtime: 1756400000000, observedAt: '2026-08-29T12:00:00Z' }],
      { existingTasks: existing, existingInbox: [], dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd' },
    );
    expect(out.dailyNotes['2026-08-29']).toMatchObject({ text: NOTE, fromObsidian: true });
    expect(out.scheduledTasks).toHaveLength(1);
    const task = out.scheduledTasks[0];
    // App-controlled fields carried exactly as the scan merge carries them.
    expect(task.color).toBe('bg-purple-500');
    expect(task.duration).toBe(45);
    expect(task.lastModified).toBe('2026-08-20T00:00:00Z');
    expect(out.scannedIds.has(String(task.id))).toBe(true);
  });

  it('out-of-scope paths and deletions are returned unapplied — never tombstoned here', () => {
    const out = applyBridgeObservations(
      [
        { path: 'Some Note.md', content: 'wiki body' },
        { path: 'Daily/2026-08-28.md', content: null, deleted: true },
        { path: 'Daily/notadate.md', content: 'x' },
      ],
      { existingTasks: [], existingInbox: [], dailyNotesPath: 'Daily' },
    );
    expect(Object.keys(out.dailyNotes)).toHaveLength(0);
    expect(out.scheduledTasks).toHaveLength(0);
    expect(out.unapplied).toHaveLength(3);
    // The detector's baselines are not this module's to touch.
    expect(localStorage.getItem('day-planner-obsidian-last-scanned')).toBe(null);
    expect(localStorage.getItem('day-planner-deleted-obsidian-keys')).toBe(null);
  });

  it('a fresh vault task with no local match imports at epoch (cloud merge yields to real edits)', () => {
    const out = applyBridgeObservations(
      [{ path: '2026-08-29.md', content: NOTE }],
      { existingTasks: [], existingInbox: [], dailyNotesPath: '' },
    );
    expect(out.scheduledTasks).toHaveLength(1);
    expect(out.scheduledTasks[0].lastModified).toBe(new Date(0).toISOString());
  });
});
