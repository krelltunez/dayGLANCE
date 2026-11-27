// The file tier (WebDAV) finding an encrypted sync file on a device whose own
// encryption switch is off (#2453).
//
// Another device turned encryption on and sealed the remote file as an
// envelope. The provider decrypts by what it downloads, not by this device's
// switch, so with no key or passphrase in memory the engine reports
// PASSPHRASE_REQUIRED and stops. Before this, nothing on such a device asked
// for the passphrase: the prompt was gated on the local switch alone, so sync
// stopped silently, and again on every launch.
//
// Two rules:
//   • The prompt shows when the engine asked for the key, whatever the local
//     switch says (`fileTierKeyWanted`), the same edge Direct Access already
//     has (`directAccessKeyWanted`).
//   • Unlocking from that prompt turns this device's encryption on. The WebDAV
//     upload encrypts only when `encryptionEnabled` is set, so a device that
//     unlocked, read the envelope and kept its switch off would write its next
//     upload as PLAINTEXT over the other device's envelope: encryption undone
//     for everyone, silently. With the switch on, the upload is sealed with the
//     key the read derived from the file's own salt, and the next launch
//     restores that key instead of hitting the wall again.

/**
 * Whether the sync passphrase prompt shows.
 *
 * @param {object} p
 * @param {object|null} p.cloudSyncConfig      the saved WebDAV config
 * @param {boolean} p.vaultEnabled
 * @param {boolean} p.dbIntentsEnabled
 * @param {boolean} p.directAccessEncrypt      Direct Access "encrypt the file" switch
 * @param {boolean} p.directAccessKeyWanted    Direct Access read an envelope it has no key for
 * @param {boolean} p.fileTierKeyWanted        the WebDAV engine did (#2453)
 * @param {boolean|null} p.syncKeyReady        false: a key is missing
 */
export function syncPassphrasePromptWanted({
  cloudSyncConfig, vaultEnabled, dbIntentsEnabled, directAccessEncrypt,
  directAccessKeyWanted, fileTierKeyWanted, syncKeyReady,
}) {
  if (syncKeyReady !== false) return false;
  return !!(cloudSyncConfig?.encryptionEnabled || vaultEnabled || dbIntentsEnabled
    || directAccessEncrypt || directAccessKeyWanted || fileTierKeyWanted);
}

/**
 * The WebDAV config after the user unlocked a remote another device encrypted:
 * encryption on, so this device never writes plaintext over the envelope.
 * Unchanged (same object) when there is no config or encryption is already on.
 *
 * @param {object|null} config
 * @returns {object|null}
 */
export function fileTierConfigAfterUnlock(config) {
  if (!config || config.encryptionEnabled) return config;
  return { ...config, encryptionEnabled: true };
}
