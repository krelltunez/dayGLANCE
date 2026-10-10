/**
 * Removing encryption from the Direct Access file (docs/direct-access-sync.md,
 * Phase 8): the one sanctioned downgrade.
 *
 * The cycle never writes plaintext over an envelope ("the file decides"), so
 * a file, once sealed, stays sealed however the switches are set. This is the
 * explicit way back: from a device that holds the key, read the envelope, open
 * it, write the same payload back as plaintext once, and turn this device's
 * encrypt switch off. From then on the file decides again, in plaintext.
 *
 * The caller turns the switch off on the OTHER devices first: a device whose
 * switch is still on seals the file again on its next write, since a plaintext
 * file with the switch on is exactly the upgrade case.
 *
 * @param {object} args
 * @param {object} args.transport      read, write, isAvailable, setEncryptsWrites
 * @param {object} args.io
 * @param {(v: object) => boolean} args.io.isEncryptedEnvelope
 * @param {(v: object) => Promise<object>} args.io.decryptData
 * @param {Console} [args.io.log]
 * @returns {Promise<{outcome: 'removed'|'already-plaintext'|'needs-key'|'unavailable'|'write-failed'|'no-file', detail?: string}>}
 */
import { classifySnapshotText } from './snapshotFileSync.js';

export async function removeDirectAccessEncryption({ transport, io }) {
  const log = io.log ?? console;
  if (!transport?.isAvailable?.()) return { outcome: 'unavailable' };
  const read = classifySnapshotText(await transport.read());
  if (read.kind === 'absent') return { outcome: 'no-file' };
  if (read.kind === 'error') return { outcome: 'unavailable', detail: read.error };
  if (read.kind !== 'snapshot') return { outcome: 'unavailable', detail: read.kind };
  if (!io.isEncryptedEnvelope(read.remote)) {
    transport.setEncryptsWrites?.(false);
    return { outcome: 'already-plaintext' };
  }
  let plain;
  try { plain = await io.decryptData(read.remote); }
  catch (err) { return { outcome: 'needs-key', detail: err?.message ?? String(err) }; }
  if (!plain?.data) return { outcome: 'needs-key', detail: 'the envelope did not open to a snapshot' };
  // The same payload, the same stamp: nothing about the data changes, only
  // the wrapping, so no device sees a new version to merge.
  const ok = await transport.write(JSON.stringify(plain));
  if (!ok) {
    log.error?.('[direct-access] remove encryption: write failed');
    return { outcome: 'write-failed' };
  }
  transport.setEncryptsWrites?.(false);
  return { outcome: 'removed' };
}
