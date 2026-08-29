// BRIDGE PAIRING — the dayGLANCE (offer-writing) half of the Phase 6 vault
// dead-drop. The wire format and crypto live in @glance-apps/obsidian-format
// (bridgePairing.js); THIS module is the app-side flow: gather the
// credentials, derive the subkey from the cached root sync key, seal, and
// drop the offer into the vault.
//
// GRANULARITY IS PER-VAULT (the Phase 6 ruling, recorded in spec §3.2): one
// plugin credential per vault, because the plugin's data.json rides
// Obsidian's plugin-settings sync to every device — per-device credentials
// in a fleet-shared file are either one token pretending to be many or
// every token visible in every copy. One pairing therefore pairs the plugin
// wherever that vault's copies run, and revocation is vault-wide: revoke
// the device token server-side and re-pair, which also ROTATES the subkey
// (fresh per-pairing salt in the HKDF derivation).
//
// The pairing DEVICE must have: direct vault access (the dead-drop is a
// file), GLANCEvault enabled, and the root sync key initialized — i.e. any
// normally-configured desktop/FSA device. The device TOKEN is minted on the
// GLANCEvault server by the operator, exactly like any other device's
// (there is no mint endpoint — the declined-server-surface decision).

import { getVaultConfig } from '../sync/vaultConfig.js';
import { hasDbRootKey } from '@glance-apps/sync';
// getDbRootKey is deliberately not re-exported from the package index (apps
// normally never touch the raw key object); the deep import is sanctioned
// here because HKDF-deriving the bridge subkey is exactly the §3.4 use case.
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  generatePairingCode,
  sealPairingOffer,
  deriveBridgeSubkey,
  exportBridgeSubkey,
  PAIRING_DIR,
} from '@glance-apps/obsidian-format';
import { writeVaultDotFile } from '../obsidian.js';

const PAIRING_FILE = 'pairing';

/**
 * Seal and drop a pairing offer. Returns the code to show the user (it is
 * never stored anywhere). Throws typed errors for each missing precondition
 * so the Settings UI can show the actual fix.
 */
export async function startBridgePairing(vaultHandle, deviceToken) {
  if (!vaultHandle || vaultHandle === 'native') {
    const e = new Error('Pairing is started from a device with direct vault access (desktop, or a Chromium browser with the vault folder connected).');
    e.code = 'pairing_no_vault_access';
    throw e;
  }
  const cfg = getVaultConfig();
  if (!cfg?.enabled || !cfg.vaultUrl || !cfg.accountId) {
    const e = new Error('GLANCEvault sync must be enabled on this device before pairing the bridge.');
    e.code = 'pairing_no_glancevault';
    throw e;
  }
  if (!hasDbRootKey()) {
    const e = new Error('The sync passphrase has not been entered on this device yet — enable GLANCEvault sync first.');
    e.code = 'pairing_no_root_key';
    throw e;
  }
  if (typeof deviceToken !== 'string' || deviceToken.trim() === '') {
    const e = new Error('Enter the device token minted for the bridge on your GLANCEvault server.');
    e.code = 'pairing_no_token';
    throw e;
  }

  const pairingSalt = crypto.getRandomValues(new Uint8Array(16));
  const subkey = await deriveBridgeSubkey(getDbRootKey(), pairingSalt);
  const subkeyB64 = await exportBridgeSubkey(subkey);
  const pairingSaltB64 = btoa(String.fromCharCode(...pairingSalt));
  const code = generatePairingCode();
  const offer = await sealPairingOffer({
    v: 1,
    vaultUrl: cfg.vaultUrl,
    accountId: cfg.accountId,
    deviceToken: deviceToken.trim(),
    subkeyB64,
    pairingSalt: pairingSaltB64,
    // The salt IS the generation: a re-pair mints a new salt, so comparing
    // generations tells the plugin an offer supersedes its stored pairing.
    generation: pairingSaltB64,
    createdAt: new Date().toISOString(),
  }, code);
  await writeVaultDotFile(vaultHandle, PAIRING_DIR, PAIRING_FILE, offer);
  return { code };
}

/** Cancel an outstanding offer by overwriting it with the cancel form. */
export async function cancelBridgePairing(vaultHandle) {
  if (!vaultHandle || vaultHandle === 'native') return;
  try {
    await writeVaultDotFile(vaultHandle, PAIRING_DIR, PAIRING_FILE, '{}');
  } catch { /* nothing to cancel */ }
}
