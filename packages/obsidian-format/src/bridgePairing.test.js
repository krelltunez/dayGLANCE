import { describe, it, expect } from 'vitest';
import {
  generatePairingCode,
  normalizePairingCode,
  sealPairingOffer,
  openPairingOffer,
  deriveBridgeSubkey,
  exportBridgeSubkey,
  importBridgeSubkey,
  pairingOfferFresh,
  PAIRING_OFFER_TTL_MS,
} from './bridgePairing.js';

// The dead-drop wire format's load-bearing claims: the code carries ~65 bits
// and normalizes predictably; seal/open round-trips; a wrong code and a
// tampered offer are both null (indistinguishable by design); the subkey
// rotates with the pairing salt and round-trips through its b64 form.

const CREDS = {
  vaultUrl: 'https://vault.example', accountId: 'acct-1',
  deviceToken: 'tok-abc', subkeyB64: 'AAAA', pairingSalt: 'c2FsdA==',
  generation: 'gen-1', createdAt: '2026-08-29T12:00:00.000Z',
};

describe('pairing code', () => {
  it('is 13 base32 chars (~65 bits), grouped 4-4-5, and normalizes case/hyphens away', () => {
    const code = generatePairingCode();
    expect(code).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{5}$/);
    expect(normalizePairingCode(code)).toHaveLength(13);
    expect(normalizePairingCode(code.toUpperCase().replace(/-/g, ' '))).toBe(normalizePairingCode(code));
  });
});

describe('seal / open', () => {
  it('round-trips with the right code — hyphens and case notwithstanding', async () => {
    const code = generatePairingCode();
    const offer = await sealPairingOffer(CREDS, code);
    expect(JSON.parse(offer)).toMatchObject({ v: 1 });
    expect(offer).not.toContain('tok-abc'); // nothing sensitive in the clear
    expect(await openPairingOffer(offer, code.toUpperCase())).toEqual(CREDS);
  });

  it('wrong code, tampered ciphertext, malformed and cancelled offers are ALL null', async () => {
    const code = generatePairingCode();
    const offer = await sealPairingOffer(CREDS, code);
    expect(await openPairingOffer(offer, generatePairingCode())).toBe(null);
    const parsed = JSON.parse(offer);
    parsed.ct = parsed.ct.slice(0, -4) + 'AAAA';
    expect(await openPairingOffer(JSON.stringify(parsed), code)).toBe(null);
    expect(await openPairingOffer('not json', code)).toBe(null);
    expect(await openPairingOffer('{}', code)).toBe(null); // the cancel form
  });
});

describe('bridge subkey', () => {
  const rootKey = () => crypto.subtle.importKey(
    'raw', new Uint8Array(32).fill(7), 'HKDF', false, ['deriveKey'],
  );

  it('same root + same salt → same key; a new pairing salt ROTATES it (the revocation property)', async () => {
    const root = await rootKey();
    const saltA = new Uint8Array(16).fill(1);
    const a1 = await exportBridgeSubkey(await deriveBridgeSubkey(root, saltA));
    const a2 = await exportBridgeSubkey(await deriveBridgeSubkey(root, saltA));
    const b = await exportBridgeSubkey(await deriveBridgeSubkey(root, new Uint8Array(16).fill(2)));
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
  });

  it('round-trips through its b64 form and both sides encrypt/decrypt', async () => {
    const root = await rootKey();
    const subkey = await deriveBridgeSubkey(root, crypto.getRandomValues(new Uint8Array(16)));
    const imported = await importBridgeSubkey(await exportBridgeSubkey(subkey));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, subkey, new TextEncoder().encode('hello'));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, imported, ct);
    expect(new TextDecoder().decode(pt)).toBe('hello');
  });
});

describe('offer freshness', () => {
  it('fresh within the TTL; expired, far-future, and unparseable are not', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z');
    expect(pairingOfferFresh('2026-08-29T11:55:00.000Z', now)).toBe(true);
    expect(pairingOfferFresh(new Date(now - PAIRING_OFFER_TTL_MS).toISOString(), now)).toBe(false);
    expect(pairingOfferFresh('2026-08-30T12:00:00.000Z', now)).toBe(false);
    expect(pairingOfferFresh('whenever', now)).toBe(false);
  });
});
