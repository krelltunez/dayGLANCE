// BRIDGE PAIRING — the vault dead-drop wire format and its crypto
// (Obsidian build-out Phase 6; spec §3.2/§3.4 and the pairing ruling).
//
// Format, never policy: this module defines WHAT a pairing offer is — how a
// code is minted, how an offer is sealed and opened, how the bridge subkey
// is derived — and nothing about WHEN to pair, who is authoritative, or what
// a revoke means. Those live with the consumers.
//
// THE DEAD-DROP. dayGLANCE (any device with direct vault access) seals the
// bridge credentials into `.dayglance/pairing`, encrypted under a key
// derived from a short-lived pairing code it displays; the plugin prompts
// for the code, opens the offer, verifies the credentials against
// GLANCEvault, stores them, and deletes the file. The code carries ~65 bits
// (13 chars of base32) UNCONDITIONALLY — no same-device shortcut — because
// a third-party file syncer can carry the offer file off-machine mid-pairing
// and the offer must survive offline brute force for its whole lifetime.
//
// THE SUBKEY (§3.4). AES-256-GCM, HKDF-derived from the account's root sync
// key with a RANDOM PER-PAIRING SALT in the derivation — so revoke-and-
// re-pair rotates the subkey, not just the transport token. A fixed
// derivation would leave a leaked data.json valid against captured stream
// ciphertext forever, defeating the point of revocation. The info string is
// namespaced apart from @glance-apps/sync's per-entity derivations
// ('glance-sync:entity:…'), so the two HKDF uses of the same root can never
// collide.
//
// Offer freshness: consumers treat an offer older than PAIRING_OFFER_TTL_MS
// as expired (the writer can also cancel by overwriting the file with '{}').

export const PAIRING_DIR = '.dayglance';
export const PAIRING_PATH = `${PAIRING_DIR}/pairing`;
export const PAIRING_OFFER_TTL_MS = 10 * 60 * 1000;
export const BRIDGE_HKDF_INFO = 'dayglance:bridge:v1';

// 13 chars × 5 bits = 65 bits. Lowercase RFC-4648 base32 alphabet; displayed
// grouped 4-4-5 for typing, compared with hyphens/case stripped.
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const CODE_LENGTH = 13;

const enc = new TextEncoder();
// Chunked bytes→base64 (String.fromCharCode arg-limit safety, matching
// bridgeStream.js — offers are small today, but helpers shouldn't have
// payload-size cliffs).
const b64 = (bytes) => {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Mint a pairing code: 13 base32 chars (~65 bits), grouped for typing. */
export function generatePairingCode() {
  const raw = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = '';
  for (const byte of raw) code += CODE_ALPHABET[byte % 32];
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/** Canonical form for comparison/derivation: lowercase, separators stripped. */
export function normalizePairingCode(code) {
  return String(code ?? '').toLowerCase().replace(/[^a-z2-7]/g, '');
}

// PBKDF2 over the (normalized) code → the offer's AES-GCM key. Same
// iteration count as @glance-apps/sync's passphrase derivation.
async function deriveOfferKey(code, saltBytes) {
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(normalizePairingCode(code)), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 310_000, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

/**
 * Seal bridge credentials into the offer file's text.
 * @param {object} credentials — {vaultUrl, accountId, deviceToken, subkeyB64,
 *   pairingSalt (b64), generation, createdAt (ISO)} — carried opaque.
 * @param {string} code — the displayed pairing code.
 */
export async function sealPairingOffer(credentials, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveOfferKey(code, salt);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(credentials)),
  );
  return JSON.stringify({ v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) });
}

/**
 * Open an offer with a code. Returns the credentials object, or null for
 * ANYTHING unusable — malformed file, wrong code (GCM tag failure), tampered
 * ciphertext. Wrong-code and tampered are indistinguishable by design.
 */
export async function openPairingOffer(text, code) {
  try {
    const offer = JSON.parse(text);
    if (!offer || offer.v !== 1) return null;
    const key = await deriveOfferKey(code, unb64(offer.salt));
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(offer.iv) }, key, unb64(offer.ct),
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

/**
 * Derive the bridge-scoped subkey from the root sync key (§3.4): an
 * EXTRACTABLE AES-256-GCM key — extractable because the plugin must persist
 * it in data.json (Obsidian's mobile runtime has no keychain; the whole
 * point of the subkey is bounding what that file can leak).
 *
 * @param {CryptoKey} rootKey — the account's HKDF base key (as held by
 *   @glance-apps/sync; non-extractable, usages ['deriveKey']).
 * @param {Uint8Array} pairingSaltBytes — RANDOM per pairing; rotating it is
 *   what rotates the subkey.
 */
export async function deriveBridgeSubkey(rootKey, pairingSaltBytes) {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: pairingSaltBytes, info: enc.encode(BRIDGE_HKDF_INFO) },
    rootKey, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'],
  );
}

/** Export a derived subkey to the base64 form the offer/data.json carries. */
export async function exportBridgeSubkey(subkey) {
  return b64(await crypto.subtle.exportKey('raw', subkey));
}

/** Import the base64 subkey back to a usable (non-extractable) AES-GCM key. */
export async function importBridgeSubkey(subkeyB64) {
  return crypto.subtle.importKey('raw', unb64(subkeyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** True when an offer's createdAt is within the TTL of `nowMs`. */
export function pairingOfferFresh(createdAtIso, nowMs = Date.now()) {
  const t = new Date(createdAtIso).getTime();
  return Number.isFinite(t) && nowMs - t < PAIRING_OFFER_TTL_MS && t <= nowMs + PAIRING_OFFER_TTL_MS;
}
