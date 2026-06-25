import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { deriveIntentsRootKey } from '@glance-apps/intents';
import {
  vaultDeliverer,
  webdavDeliverer,
  icloudDeliverer,
  DELIVERED,
  TRANSIENT,
  PERMANENT,
} from './deliverers.js';
import { HELD_NO_KEY_REASON } from './outbox.js';

// ─────────────────────────────────────────────────────────────────────────────
// Intents deliverers (stage 2a). These exercise the REAL deliverers and the REAL
// @glance-apps/intents codec (deriveIntentsRootKey / buildEncryptedEnvelope /
// buildIntentRow) with all transport I/O injected — no network, no IndexedDB.
//
// The vault deliverer is ALWAYS encrypted: with a key it builds ciphertext and
// POSTs; with no key it returns 'transient' and sends/builds nothing.
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
beforeEach(() => { global.localStorage = memLocalStorage(); });
afterAll(() => { delete global.localStorage; });

const CONN = { vaultUrl: 'https://vault.example.com', vaultToken: 'tok-123', accountId: 'acct-1' };

// A schema-valid notify payload (buildEnvelope validates the plaintext payload).
function validPayload(title = 'SECRET-TITLE') {
  return {
    event_id: 'evt-1',
    source_app: 'app.testglance',
    source_entity_id: 'se-1',
    event: 'completed',
    task_id: 'task-1',
    title,
    timestamp: '2026-01-01T00:00:00.000Z',
    entity_type: 'task',
  };
}

// A raw outbox intent (NOT an envelope): action + payload + emit metadata, keyed
// by event_id. emitted_by is a FOREIGN app so nothing is treated as loopback.
function makeIntent(eventId = '20260101T000000Z-aaa111', title = 'SECRET-TITLE') {
  return {
    event_id: eventId,
    action: 'notify',
    emitted_by: 'app.testglance',
    payload: validPayload(title),
  };
}

function decodeRowEnvelope(b64) {
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
}

async function aRootKey(seed = 1) {
  return deriveIntentsRootKey('pw', new Uint8Array(16).fill(seed));
}

// ─── 1. VAULT deliverer ───────────────────────────────────────────────────────

describe('vault deliverer', () => {
  // (a) WITH a cached key → builds an ENCRYPTED envelope and POSTs.
  it('(a) with a cached key builds ciphertext and POSTs /intents/batch', async () => {
    const captured = [];
    const vaultFetch = vi.fn(async (method, url, headers, body) => {
      captured.push({ method, url, headers, body });
      return { status: 200, ok: true, body: JSON.stringify({ written: 1, maxSeq: 7 }) };
    });
    const rootKey = await aRootKey();

    const result = await vaultDeliverer(makeIntent(), {
      connection: CONN, config: { ttlMs: 1000 }, vaultFetch, loadKey: async () => rootKey,
    });

    expect(result).toBe(DELIVERED);
    expect(vaultFetch).toHaveBeenCalledTimes(1);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe('https://vault.example.com/intents/batch');
    expect(captured[0].headers.Authorization).toBe('Bearer tok-123');

    const sent = JSON.parse(captured[0].body);
    expect(sent.accountId).toBe('acct-1');
    expect(sent.events).toHaveLength(1);

    // The row envelope must be CIPHERTEXT, not plaintext.
    const env = decodeRowEnvelope(sent.events[0].envelope);
    expect(env.encrypted).toBe(true);
    expect(env.payload_ciphertext).toBeDefined();
    expect(env).not.toHaveProperty('payload');     // no plaintext payload
    expect(env).not.toHaveProperty('action');      // encrypted envelope hides action too
    // And the secret never appears anywhere in the wire bytes.
    expect(Buffer.from(sent.events[0].envelope, 'base64').toString('utf8')).not.toContain('SECRET-TITLE');
  });

  // (b) NO cached key → held (transient) tagged with the key-not-ready reason,
  //     sends nothing, builds nothing.
  it('(b) with no cached key returns transient (held: key not ready) and sends nothing', async () => {
    const vaultFetch = vi.fn();
    const result = await vaultDeliverer(makeIntent(), {
      connection: CONN, vaultFetch, loadKey: async () => null,
    });
    expect(result).toEqual({ status: TRANSIENT, reason: HELD_NO_KEY_REASON });
    expect(vaultFetch).not.toHaveBeenCalled();
  });

  it('(b2) with no vault connection returns transient and sends nothing', async () => {
    const vaultFetch = vi.fn();
    const result = await vaultDeliverer(makeIntent(), {
      connection: null, vaultFetch, loadKey: async () => 'should-not-be-loaded',
    });
    expect(result).toBe(TRANSIENT);
    expect(vaultFetch).not.toHaveBeenCalled();
  });

  // (c) NEVER produces a plaintext envelope under any condition — including when
  //     the WebDAV-style encryptionEnabled flag is false/absent (vault ignores it).
  it('(c) always encrypts even when encryptionEnabled is false; never plaintext', async () => {
    const captured = [];
    const vaultFetch = async (m, u, h, body) => { captured.push(body); return { status: 200, ok: true, body: '{}' }; };
    const rootKey = await aRootKey(2);

    // encryptionEnabled deliberately false — vault must STILL encrypt.
    const result = await vaultDeliverer(makeIntent(), {
      connection: CONN, config: { ttlMs: 1000, encryptionEnabled: false }, vaultFetch, loadKey: async () => rootKey,
    });
    expect(result).toBe(DELIVERED);
    const env = decodeRowEnvelope(JSON.parse(captured[0]).events[0].envelope);
    expect(env.encrypted).toBe(true);
    expect(env).not.toHaveProperty('payload');
  });

  // Outcome mapping for the vault POST.
  it('maps 5xx → transient, 4xx → permanent, network throw → transient', async () => {
    const rootKey = await aRootKey(3);
    const run = (fetchImpl) => vaultDeliverer(makeIntent(), {
      connection: CONN, config: { ttlMs: 1000 }, vaultFetch: fetchImpl, loadKey: async () => rootKey,
    });

    expect(await run(async () => ({ status: 503, ok: false, body: '' }))).toBe(TRANSIENT);
    expect(await run(async () => ({ status: 429, ok: false, body: '' }))).toBe(TRANSIENT);
    expect(await run(async () => ({ status: 400, ok: false, body: '' }))).toBe(PERMANENT);
    expect(await run(async () => { throw new TypeError('Failed to fetch'); })).toBe(TRANSIENT);
  });
});

// ─── 2. WEBDAV deliverer ───────────────────────────────────────────────────────

describe('webdav deliverer', () => {
  const WEBDAV = { webdavUrl: 'https://dav.example.com', username: 'u', appPassword: 'p' };

  it('(e) success → delivered; 5xx → transient; 4xx → permanent; throw → transient', async () => {
    const run = (writeImpl, config = WEBDAV) =>
      webdavDeliverer(makeIntent(), { config, writeEventFile: writeImpl });

    expect(await run(async () => ({ ok: true, status: 201 }))).toBe(DELIVERED);
    expect(await run(async () => ({ ok: false, status: 502 }))).toBe(TRANSIENT);
    expect(await run(async () => ({ ok: false, status: 400 }))).toBe(PERMANENT);
    expect(await run(async () => { throw new TypeError('Failed to fetch'); })).toBe(TRANSIENT);
  });

  it('(e) not configured → permanent (won\'t self-heal on retry)', async () => {
    const write = vi.fn();
    const result = await webdavDeliverer(makeIntent(), { config: null, writeEventFile: write });
    expect(result).toBe(PERMANENT);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves WebDAV policy: plaintext when encryptionEnabled is false', async () => {
    let sentEnvelope;
    const write = async (config, envelope) => { sentEnvelope = envelope; return { ok: true, status: 201 }; };
    const result = await webdavDeliverer(makeIntent(), { config: { ...WEBDAV, encryptionEnabled: false }, writeEventFile: write });
    expect(result).toBe(DELIVERED);
    expect(sentEnvelope.encrypted).toBeUndefined();   // plaintext, per existing WebDAV policy
    expect(sentEnvelope.payload).toBeDefined();
  });

  it('preserves WebDAV policy: encrypted when encryptionEnabled and key present', async () => {
    let sentEnvelope;
    const write = async (config, envelope) => { sentEnvelope = envelope; return { ok: true, status: 201 }; };
    const rootKey = await aRootKey(4);
    const result = await webdavDeliverer(makeIntent(), {
      config: { ...WEBDAV, encryptionEnabled: true }, loadWebdavKey: async () => rootKey, writeEventFile: write,
    });
    expect(result).toBe(DELIVERED);
    expect(sentEnvelope.encrypted).toBe(true);
    expect(sentEnvelope).not.toHaveProperty('payload');
  });

  it('encryption on but key not ready → transient, writes nothing', async () => {
    const write = vi.fn();
    const result = await webdavDeliverer(makeIntent(), {
      config: { ...WEBDAV, encryptionEnabled: true }, loadWebdavKey: async () => null, writeEventFile: write,
    });
    expect(result).toBe(TRANSIENT);
    expect(write).not.toHaveBeenCalled();
  });
});

// ─── 3. ICLOUD deliverer ───────────────────────────────────────────────────────

describe('icloud deliverer', () => {
  it('(e) write true → delivered; write false → transient; unavailable → transient; throw → transient', async () => {
    const base = { config: { encryptionEnabled: false }, isAvailable: () => true };

    expect(await icloudDeliverer(makeIntent(), { ...base, writeEventFileICloud: async () => true })).toBe(DELIVERED);
    expect(await icloudDeliverer(makeIntent(), { ...base, writeEventFileICloud: async () => false })).toBe(TRANSIENT);
    expect(await icloudDeliverer(makeIntent(), { ...base, isAvailable: () => false, writeEventFileICloud: vi.fn() })).toBe(TRANSIENT);
    expect(await icloudDeliverer(makeIntent(), { ...base, writeEventFileICloud: async () => { throw new Error('fs'); } })).toBe(TRANSIENT);
  });

  it('does not write when iCloud is unavailable', async () => {
    const write = vi.fn();
    const result = await icloudDeliverer(makeIntent(), { config: {}, isAvailable: () => false, writeEventFileICloud: write });
    expect(result).toBe(TRANSIENT);
    expect(write).not.toHaveBeenCalled();
  });

  it('encryption on but key not ready → transient, writes nothing', async () => {
    const write = vi.fn();
    const result = await icloudDeliverer(makeIntent(), {
      config: { encryptionEnabled: true }, isAvailable: () => true, loadWebdavKey: async () => null, writeEventFileICloud: write,
    });
    expect(result).toBe(TRANSIENT);
    expect(write).not.toHaveBeenCalled();
  });
});
