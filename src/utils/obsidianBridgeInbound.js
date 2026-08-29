// BRIDGE STREAM, app side — inbound observations (Phase 6 PR 2).
//
// The plugin reports OBSERVATIONS — latest file state per path, never
// inferred edits (spec §3.6 as amended). This module fetches and decrypts
// them, and turns a batch into exactly the shape a partial vault scan
// produces, THROUGH THE SAME PIPELINE the scan uses
// (parseTasksFromMarkdown + mergeParsedObsidianTasks): per-field adoption,
// title ownership, classification overrides — every §3.10 ruling applies to
// an observed file identically to a scanned one, because it IS the same
// code.
//
// TWO DELIBERATE ABSENCES:
//  • THE DELETION DETECTOR DOES NOT PARTICIPATE. Observations are per-note
//    and can never establish scan completeness — the detector's baseline
//    advances only on complete direct scans. A `deleted` observation is
//    reported to the caller but produces no tombstone here; what a
//    plugin-observed deletion may do is an arbitration-phase decision.
//  • NOT YET WIRED INTO THE LIVE SYNC PATH. In this PR the stream runs
//    alongside direct access, deliberately observable before load-bearing:
//    on a device that also scans, applying observations (which may lag the
//    scan) through the LWW-ish note merge could regress a note the scan
//    just read fresh and churn against the next scan. Consumption becomes
//    coherent exactly when arbitration decides which source owns the vault
//    on this device — the next PR. The functions are complete and pinned by
//    tests so that wiring is a call, not a build.

import { getVaultConfig } from '../sync/vaultConfig.js';
import { hasDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import { createVaultClient } from '@glance-apps/sync/src/vaultClient.js';
import {
  deriveBridgeSubkey,
  openBridgeEnvelope,
  buildDateParser,
  parseDateFromFilename,
  BRIDGE_VAULT_APP,
  BRIDGE_OBSERVATION_PREFIX,
} from '@glance-apps/obsidian-format';
import {
  buildExistingObsidianTaskContext,
  mergeParsedObsidianTasks,
  parseTasksFromMarkdown,
} from '../obsidian.js';
import { getBridgePairingMeta } from './obsidianBridgeStream.js';

const OBS_HWM_KEY = 'dayglance-bridge-obs-hwm';

/**
 * Fetch observation rows newer than the persisted cursor and decrypt them.
 * Returns { observations, maxSeq } (per-path latest, oldest cursor wins the
 * dedupe — rows are upserts, so later seq IS later state), or null when the
 * stream isn't available (unpaired, no key, unreachable). The cursor is NOT
 * advanced here — call commitBridgeObservationCursor after the caller has
 * durably applied the batch, so a crash replays instead of losing it.
 */
export async function fetchBridgeObservations() {
  try {
    const cfg = getVaultConfig();
    if (!cfg?.enabled || !cfg.vaultUrl || !cfg.vaultToken || !cfg.accountId || !hasDbRootKey()) return null;
    const meta = await getBridgePairingMeta();
    if (!meta) return null;
    const salt = Uint8Array.from(atob(meta.pairingSalt), (c) => c.charCodeAt(0));
    const subkey = await deriveBridgeSubkey(getDbRootKey(), salt);
    const client = createVaultClient({ vaultUrl: cfg.vaultUrl, vaultToken: cfg.vaultToken });

    let since = 0;
    try { since = Number(localStorage.getItem(OBS_HWM_KEY)) || 0; } catch { /* fresh cursor */ }
    const byPath = new Map();
    let maxSeq = since;
    let hasMore = true;
    while (hasMore) {
      const page = await client.list(BRIDGE_VAULT_APP, { accountId: cfg.accountId, since });
      hasMore = !!page.hasMore;
      for (const row of page.rows || []) {
        const seq = Number(row.seq) || 0;
        if (seq > maxSeq) maxSeq = seq;
        if (seq > since) since = seq;
        if (!String(row.entityId || '').startsWith(BRIDGE_OBSERVATION_PREFIX)) continue;
        const payload = await openBridgeEnvelope(subkey, row.envelope);
        // Unreadable rows (rotated-away generation, tamper) are skipped, not
        // fatal — the cursor still advances past them.
        if (payload?.kind !== 'observation' || typeof payload.path !== 'string') continue;
        byPath.set(payload.path, payload);
      }
      if (!page.rows?.length) break;
    }
    return { observations: [...byPath.values()], maxSeq };
  } catch {
    return null;
  }
}

/** Advance the observation cursor — only after the batch is applied. */
export function commitBridgeObservationCursor(maxSeq) {
  try { localStorage.setItem(OBS_HWM_KEY, String(maxSeq)); } catch { /* retried next fetch */ }
}

/**
 * Turn a batch of observations into the shape a (partial) vault scan
 * produces: { dailyNotes, scheduledTasks, inboxTasks, scannedIds }. Feed the
 * result through mergeObsidianDailyNotes / mergeObsidianTasks exactly like a
 * scan result — scannedIds covers only the OBSERVED notes, so everything
 * else is retained, and nothing here touches the deletion-detector baseline.
 *
 * Only daily notes are applied: an observation classifies as a daily note
 * when its path sits in the configured daily-notes folder and its filename
 * parses under the configured pattern. Everything else (wiki notes — read
 * on demand; deletions — see the module header) is left to the caller via
 * the `unapplied` list.
 */
export function applyBridgeObservations(observations, {
  existingTasks, existingInbox, dailyNotesPath = '', dailyNotePattern = 'yyyy-MM-dd', onTitleConflict = null,
}) {
  const dailyNotes = {};
  const allScheduled = [];
  const allInbox = [];
  const unapplied = [];
  const ctx = buildExistingObsidianTaskContext(existingTasks, existingInbox);
  const isDefaultPattern = !dailyNotePattern || dailyNotePattern === 'yyyy-MM-dd';
  const dateParser = isDefaultPattern ? null : buildDateParser(dailyNotePattern);
  const folderPrefix = dailyNotesPath ? `${dailyNotesPath.replace(/\/+$/, '')}/` : '';
  const seenBlockIds = new Set();

  for (const obs of observations) {
    if (obs.deleted || obs.content == null) { unapplied.push(obs); continue; }
    const path = obs.path;
    if (folderPrefix ? !path.startsWith(folderPrefix) : path.includes('/')) { unapplied.push(obs); continue; }
    const name = path.slice(folderPrefix.length);
    let dateStr = null;
    if (isDefaultPattern) {
      if (/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) dateStr = name.slice(0, -3);
    } else if (name.endsWith('.md')) {
      dateStr = parseDateFromFilename(name, dateParser);
    }
    if (!dateStr) { unapplied.push(obs); continue; }

    dailyNotes[dateStr] = {
      text: obs.content,
      lastModified: obs.mtime ? new Date(obs.mtime).toISOString() : (obs.observedAt || new Date().toISOString()),
      fromObsidian: true,
    };
    mergeParsedObsidianTasks(
      parseTasksFromMarkdown(obs.content, dateStr, seenBlockIds),
      ctx, onTitleConflict, { allScheduled, allInbox },
    );
  }

  const scannedIds = new Set([
    ...[...allScheduled, ...allInbox].map((t) => String(t.id)),
    ...[...allScheduled, ...allInbox].filter((t) => t.obsidianLegacyId).map((t) => String(t.obsidianLegacyId)),
  ]);
  return { dailyNotes, scheduledTasks: allScheduled, inboxTasks: allInbox, scannedIds, unapplied };
}
