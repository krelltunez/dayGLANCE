// A linked note's description, read from the bridge's OBSERVATION stream
// rather than from vault files (#2280; the app's planner, #2291).
//
// The plugin reports every note it observes, a project's or goal's linked
// note always among them (the link is the scope), as one sealed observation
// row per path: { v:1, kind:'observation', path, content|null, deleted?,
// withdrawn?, scoped?, mtime, observedAt } (bridgeStream.js). The row is
// upserted, so it IS the note's latest reported state. A reader with no
// vault folder (a GLANCEvault-client host) reads a linked note's description
// section from it, through the same extraction and hash the app's own loader
// uses on a file (noteDescription.js), with the path normalized the way the
// app's loader normalizes it (normalizeNotePath, identity.js).
//
// Freshness: as current as the plugin's last report. An edit in Obsidian
// reaches a reader when the plugin reports the note, not before.
//
// Reading, not policy: this picks a path's latest report and reads its
// flags. What a caller does with "not found" is the caller's.

import { normalizeNotePath } from './identity.js';
import { extractNoteDescription, noteTextHash } from './noteDescription.js';
import {
  BRIDGE_OBSERVATION_PREFIX, BRIDGE_PAIRING_META_ID, openBridgeEnvelope, decodePlainBridgeRow,
} from './bridgeStream.js';
import { deriveBridgeSubkey } from './bridgePairing.js';

const observedMs = (obs) => {
  const t = Date.parse(obs?.observedAt);
  return Number.isFinite(t) ? t : 0;
};

/**
 * The latest observation that reports the note at `path`, or null when none
 * does. Paths compare after normalizeNotePath on both sides, so `Goals/Home`,
 * `[[Goals/Home]]` and `Goals/Home.md` name one note. Latest is the newest
 * `observedAt`; on a tie, the later in `observations` (a pull lists rows in
 * seq order). Link observations (`link: true`) report a link, not a note,
 * and are never picked.
 */
export function latestNoteObservation(observations, path) {
  const key = normalizeNotePath(path);
  if (!key) return null;
  let latest = null;
  for (const obs of observations || []) {
    if (!obs || typeof obs !== 'object' || obs.kind !== 'observation' || obs.link) continue;
    if (typeof obs.path !== 'string' || normalizeNotePath(obs.path) !== key) continue;
    if (!latest || observedMs(obs) >= observedMs(latest)) latest = obs;
  }
  return latest;
}

/**
 * A note's description section as the stream last reported the note:
 *
 *   { text, base, observedAt, lastModified }  text = extractNoteDescription
 *                     (content), base = noteTextHash(text), the hash a
 *                     description write carries back; observedAt when the
 *                     plugin saw it; lastModified the file's mtime (ISO), or
 *                     null when the plugin reported none
 *   { notFound: true }  the latest report says the note is gone or no longer
 *                     reported: deleted, withdrawn, or without content
 *   null              no observation names the path. Absence is no
 *                     information, never "not found": the plugin may not
 *                     have reported the note yet.
 */
export function noteDescriptionFromObservations(observations, path) {
  const obs = latestNoteObservation(observations, path);
  if (!obs) return null;
  if (obs.deleted || obs.withdrawn || typeof obs.content !== 'string') return { notFound: true };
  const text = extractNoteDescription(obs.content);
  const mtime = obs.mtime != null ? new Date(obs.mtime) : null;
  return {
    text,
    base: noteTextHash(text),
    observedAt: typeof obs.observedAt === 'string' ? obs.observedAt : null,
    lastModified: mtime && Number.isFinite(mtime.getTime()) ? mtime.toISOString() : null,
  };
}

/**
 * The observation payloads among rows of the bridge namespace
 * (BRIDGE_VAULT_APP) as the vault lists them, opened under the bridge
 * subkey. Deleted rows, other row kinds, and envelopes that do not open (a
 * pairing generation this key is not, or a corrupt row) are left out.
 */
export async function openNoteObservations(rows, subkey) {
  const out = [];
  for (const row of rows || []) {
    if (!row || row.deleted || typeof row.envelope !== 'string') continue;
    if (!String(row.entityId ?? '').startsWith(BRIDGE_OBSERVATION_PREFIX)) continue;
    const payload = await openBridgeEnvelope(subkey, row.envelope);
    if (payload && payload.kind === 'observation') out.push(payload);
  }
  return out;
}

/**
 * A `loadNoteDescription(path)` over the rows of the bridge namespace a reader
 * holds, with the contract of the app's loader (useObsidianSync): it resolves
 * to { text, base, lastModified, observedAt }, { notFound: true }, or null
 * when the note cannot be read here. Inject it into the goal tree read
 * (@glance-apps/dayglance-mcp's enrichGoalTreeDescriptions).
 *
 * The subkey is derived from the account's root key with the pairing salt the
 * plaintext meta:pairing row carries, as every dayGLANCE device derives it;
 * pass `subkey` instead when the caller already holds it. With no pairing in
 * the rows (the vault was never paired, or was unpaired) every read resolves
 * to null: descriptions stay as the records have them.
 *
 * @param {Array<{ entityId: string, envelope?: string|null, deleted?: boolean }>} rows
 * @param {{ rootKey?: CryptoKey, subkey?: CryptoKey }} keys
 */
export async function bridgeNoteDescriptionLoader(rows, { rootKey = null, subkey = null } = {}) {
  let key = subkey;
  if (!key) {
    const metaRow = (rows || []).find((r) => r && r.entityId === BRIDGE_PAIRING_META_ID && !r.deleted && typeof r.envelope === 'string');
    const meta = metaRow ? decodePlainBridgeRow(metaRow.envelope) : null;
    if (!rootKey || meta?.kind !== 'pairing-meta' || typeof meta.pairingSalt !== 'string' || !meta.pairingSalt) {
      return async () => null;
    }
    const salt = Uint8Array.from(atob(meta.pairingSalt), (c) => c.charCodeAt(0));
    key = await deriveBridgeSubkey(rootKey, salt);
  }
  const observations = await openNoteObservations(rows, key);
  return async (path) => noteDescriptionFromObservations(observations, path);
}
