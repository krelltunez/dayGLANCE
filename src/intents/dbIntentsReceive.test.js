import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { buildEnvelope, buildEncryptedEnvelope, deriveIntentsRootKey, deriveEnvelopeKey } from '@glance-apps/intents';

// Mock the intent handler so we can prove a row was (or was NOT) routed without
// standing up the full app context. routeIncoming calls handleIntent only for
// rows it accepts; a rejected plaintext row must never reach it.
vi.mock('./handleIntent.js', () => ({ handleIntent: vi.fn(async () => ({ success: true })) }));

import { routeIncoming, KeyUnavailableError } from './dbIntentsTransport.js';
import { handleIntent } from './handleIntent.js';
import { getActivityLog } from './intentLog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Vault RECEIVE: zero-knowledge plaintext rejection. routeIncoming is handed the
// DECODED envelope object (parseIntentRow already base64-decoded it). A plaintext
// row over the vault is a contract violation → rejected (permanent), logged, and
// NEVER routed; an encrypted row decrypts with the vault key and routes normally.
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
beforeEach(() => { global.localStorage = memLocalStorage(); handleIntent.mockClear(); });
afterAll(() => { delete global.localStorage; });

// FOREIGN emitted_by so the loopback guard (emitted_by === 'app.dayglance')
// doesn't short-circuit before the encrypted/plaintext decision.
function validPayload() {
  return {
    event_id: 'evt-1', source_app: 'app.lifeglance', source_entity_id: 'se-1',
    event: 'completed', task_id: 'task-1', title: 'inbound', timestamp: '2026-01-01T00:00:00.000Z', entity_type: 'task',
  };
}

describe('vault receive plaintext rejection', () => {
  it('(d) rejects a plaintext row: permanent, logged, never routed', async () => {
    // A plaintext envelope (encrypted flag absent) — what buildEnvelope produces.
    const env = buildEnvelope({
      action: 'notify', payload: validPayload(), emittedBy: 'app.lifeglance', eventId: '20260101T000000Z-aaa111',
    });
    expect(env.encrypted).toBeUndefined(); // confirm it really is plaintext

    const outcome = await routeIncoming(env, {});
    expect(outcome).toBe('permanent');         // advanced past, not wedged
    expect(handleIntent).not.toHaveBeenCalled(); // never routed
    expect(getActivityLog()[0].error).toBe('plaintext_rejected'); // logged loudly
  });

  it('(d) processes an encrypted row normally (decrypts with the vault key, routes)', async () => {
    const rootKey = await deriveIntentsRootKey('pw', new Uint8Array(16).fill(9));
    const deriveKey = (salt) => deriveEnvelopeKey(rootKey, salt);
    const env = await buildEncryptedEnvelope({
      action: 'notify', payload: validPayload(), emittedBy: 'app.lifeglance', eventId: '20260101T000000Z-bbb222',
    }, deriveKey);
    expect(env.encrypted).toBe(true);

    // Inject the vault-slot key loader so decryption uses the same key.
    const outcome = await routeIncoming(env, {}, { loadKey: async () => rootKey });
    expect(outcome).toBe('ok');
    expect(handleIntent).toHaveBeenCalledTimes(1);
    // Routed with the DECRYPTED action + payload.
    expect(handleIntent.mock.calls[0][0]).toBe('notify');
    expect(handleIntent.mock.calls[0][1].title).toBe('inbound');
  });

  it('(d) an encrypted row with NO vault key cached is TRANSIENT: routeIncoming throws (held, not advanced)', async () => {
    const rootKey = await deriveIntentsRootKey('pw', new Uint8Array(16).fill(8));
    const env = await buildEncryptedEnvelope({
      action: 'notify', payload: validPayload(), emittedBy: 'app.lifeglance', eventId: '20260101T000000Z-ccc333',
    }, (salt) => deriveEnvelopeKey(rootKey, salt));

    // Key absent → KeyUnavailableError so the drain HOLDS + bounded-retries
    // (never advances past / loses the row). It is no longer a permanent skip.
    await expect(routeIncoming(env, {}, { loadKey: async () => null }))
      .rejects.toBeInstanceOf(KeyUnavailableError);
    expect(handleIntent).not.toHaveBeenCalled();
  });
});
