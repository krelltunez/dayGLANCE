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
import {
  deriveBridgeSubkey,
  openBridgeEnvelope,
  buildDateParser,
  parseDateFromFilename,
  BRIDGE_VAULT_APP,
  BRIDGE_OBSERVATION_PREFIX,
  BRIDGE_ACTION_PREFIX,
  completedSinceFor,
  noteKeyForPath,
} from '@glance-apps/obsidian-format';
import {
  buildExistingObsidianTaskContext,
  mergeParsedObsidianTasks,
  parseTasksFromMarkdown,
} from '../obsidian.js';
import { getBridgePairingMeta, bridgeRateLimited, bridgeVaultClientFor } from './obsidianBridgeStream.js';
import { resolveProjectRef } from './obsidianProjectNotes.js';

const OBS_HWM_KEY = 'dayglance-bridge-obs-hwm';

/**
 * Fetch observation rows newer than the persisted cursor and decrypt them.
 * Returns { observations, maxSeq } (per-path latest, oldest cursor wins the
 * dedupe — rows are upserts, so later seq IS later state), or null when the
 * stream isn't available (unpaired, no key, unreachable). The cursor is NOT
 * advanced here — call commitBridgeObservationCursor after the caller has
 * durably applied the batch, so a crash replays instead of losing it.
 */
// The merge's fresh-import marker (obsidian.js mergeParsedObsidianTasks).
const FRESH_IMPORT_TS = new Date(0).toISOString();

// Why the last fetch returned null (audit low: a plugin-mode cycle whose
// inbound fetch produced nothing used to finish GREEN — "last synced" stamped,
// the error latch cleared — on a dead stream). The hook reads this to surface
// the state instead; a successful fetch clears it.
let lastInboundFailure = null;
export function lastBridgeInboundFailure() { return lastInboundFailure; }
const fail = (reason) => { lastInboundFailure = reason; return null; };

export async function fetchBridgeObservations() {
  try {
    // The client's realm-wide brake (@glance-apps/sync 1.11.0): while the
    // server is rate-limiting, sit the whole cycle out pre-flight — the
    // cursor hasn't advanced, so nothing is lost, and the next cycle
    // retries. (A braked client call would throw RATE_LIMITED anyway; this
    // read just skips the ceremony for a multi-request cycle.)
    if (bridgeRateLimited()) return fail('rate-limited');
    const cfg = getVaultConfig();
    if (!cfg?.enabled || !cfg.vaultUrl || !cfg.vaultToken || !cfg.accountId) return fail('unconfigured');
    // The root key loads asynchronously after launch; a configured vault
    // whose key is not in memory yet is a HOLD, not a dead stream. The first
    // cycle after every launch used to land here and raise the dead-stream
    // error on every open (the phone showed it on each foreground).
    if (!hasDbRootKey()) return fail('key-pending');
    const meta = await getBridgePairingMeta();
    if (!meta) return fail('unpaired');
    const salt = Uint8Array.from(atob(meta.pairingSalt), (c) => c.charCodeAt(0));
    const subkey = await deriveBridgeSubkey(getDbRootKey(), salt);
    const client = bridgeVaultClientFor(cfg);

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
        // Keyed by the ROW, not the path: a note's observation row and a
        // project-note LINK row (companion §4.3) can name the same path.
        byPath.set(String(row.entityId), payload);
      }
      if (!page.rows?.length) break;
    }
    lastInboundFailure = null;
    return { observations: [...byPath.values()], maxSeq };
  } catch {
    // Rate-limited (the client armed the brake itself) or unreachable —
    // the unadvanced cursor retries next cycle either way.
    return fail(bridgeRateLimited() ? 'rate-limited' : 'unreachable');
  }
}

/** Advance the observation cursor — only after the batch is applied. */
export function commitBridgeObservationCursor(maxSeq) {
  try { localStorage.setItem(OBS_HWM_KEY, String(maxSeq)); } catch { /* retried next fetch */ }
}

/**
 * SSE-nudge PROBE (Phase 7 groundwork): are there observation rows above the
 * cursor? The vault's /events stream carries only {seq} — the account seq is
 * shared across apps, so a nudge cannot say whether a bridge row or a DB row
 * advanced it. This probe is the cheap discriminator: ONE first-page list of
 * the bridge namespace since the cursor, checking for `obs:`- and `act:`-
 * prefixed rows — no decryption, no pairing meta, no pagination. dayGLANCE's
 * own bridge writes are `int:`/`meta:` rows, so the prefix check
 * structurally excludes them: only plugin-authored observations and sidebar
 * actions (and a `hasMore` page boundary, conservatively) answer true. The
 * full sync cycle — merges, inference, actions, writeback, the status UI —
 * runs only on a true answer, so a nudge for foreign DB-tier activity costs
 * one GET and wakes nothing.
 *
 * Actions joined the wake set on 2026-09-06 (the SSE re-arm's first
 * finding): a sidebar completion writes an `act:` row that the SAME cycle
 * consumes, but the probe only knew observations, so a check-off in the
 * sidebar still waited for the five-minute poll with live sync on. An
 * action row is live only until the cycle applies and soft-deletes it, and
 * the observation cursor passes it on the next fetch, so waking on it
 * cannot loop.
 *
 * False on ANY doubt except hasMore: unpaired, disabled, braked
 * (bridgeRateLimited — the poll floor covers), or unreachable. Never
 * advances the cursor.
 *
 * Since the server's app tag (2026-09-05) the coalescer already keeps
 * foreign-namespace nudges away from the Obsidian cycle; this probe is the
 * row-level layer beneath it, still needed because the bridge namespace
 * carries more than observations (a peer device's intents, the plugin's
 * intent-row soft-deletes, meta rows), and the whole gate for an untagged
 * frame from an older server.
 */
export async function pendingBridgeObservations() {
  try {
    if (bridgeRateLimited()) return false;
    const cfg = getVaultConfig();
    if (!cfg?.enabled || !cfg.vaultUrl || !cfg.vaultToken || !cfg.accountId) return false;
    let since = 0;
    try { since = Number(localStorage.getItem(OBS_HWM_KEY)) || 0; } catch { /* fresh cursor */ }
    const client = bridgeVaultClientFor(cfg);
    const page = await client.list(BRIDGE_VAULT_APP, { accountId: cfg.accountId, since });
    if (page.hasMore) return true; // rows beyond page 1 — wake conservatively
    return (page.rows || []).some((row) => {
      if (row.deleted) return false;
      const id = String(row.entityId || '');
      return id.startsWith(BRIDGE_OBSERVATION_PREFIX) || id.startsWith(BRIDGE_ACTION_PREFIX);
    });
  } catch {
    return false; // rate-limited/unreachable — the poll floor covers
  }
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
/** The note key an observation parses under: a daily note's date, a scoped
 *  note's path key, or null when the observation carries no note. Mirrors
 *  the derivation inside applyBridgeObservations exactly. */
function observationNoteKey(obs, { folderPrefix, isDefaultPattern, dateParser }) {
  if (!obs || obs.link) return null;
  if (obs.scoped || obs.withdrawn) return noteKeyForPath(obs.path);
  const path = String(obs.path || '');
  if (folderPrefix ? !path.startsWith(folderPrefix) : path.includes('/')) return null;
  const name = path.slice(folderPrefix.length);
  if (isDefaultPattern) return /^\d{4}-\d{2}-\d{2}\.md$/.test(name) ? name.slice(0, -3) : null;
  return name.endsWith('.md') ? (parseDateFromFilename(name, dateParser) || null) : null;
}

/** token → the note key of the task that currently owns it, from the app's
 *  Obsidian tasks (a daily note's date or a scoped note's path key). */
function ownedTokenNotes(existingTasks, existingInbox) {
  const owner = new Map();
  for (const t of [...(existingTasks || []), ...(existingInbox || [])]) {
    if (!t || t.importSource !== 'obsidian' || !t.obsidianBlockId) continue;
    const key = t.obsidianNotePath || t.obsidianFileDate;
    if (key) owner.set(String(t.obsidianBlockId), String(key));
  }
  return owner;
}

function readKnownDailyNotes() {
  try { return JSON.parse(localStorage.getItem('day-planner-daily-notes') || '{}'); } catch { return {}; }
}

export function applyBridgeObservations(observations, {
  existingTasks, existingInbox, dailyNotesPath = '', dailyNotePattern = 'yyyy-MM-dd', onTitleConflict = null,
  // VAULT TASK SCOPE (companion §6): the plugin flags a non-daily note in
  // the user's scope with `scoped: true`; such a note parses under its PATH
  // key (ruling A) with the completion window from the pairing meta's
  // `scope` (ruling E). A `withdrawn: true` observation means the note left
  // the scope (ruling C): its path is returned for the caller to withdraw.
  scope = null, today = null,
  // Project notes (companion §4.3, ruling H): path → project id for linked
  // notes whose note is present; a task line that imports FRESH from such a
  // note (no existing task to match) starts assigned to that project.
  projectByNotePath = null,
  // The app's projects, so a line's `[project:: …]` field resolves to an id
  // (companion §4.3, ruling G as amended): on first import and on a vault
  // edit of the field.
  projects = null,
  // The app's stored daily notes (date → { text }), the last text observed
  // for each. The duplicate-token dedupe below reads them to tell whether a
  // note NOT in this batch still carries a token; defaults to the app's own
  // store so every caller sees the same vault.
  knownDailyNotes = null,
}) {
  const dailyNotes = {};
  const scopedNotes = {}; // path → { lastModified, deleted? } for scoped (non-daily) notes in this batch
  // date-or-path → the note's REAL mtime, only when the plugin reported one
  // (audit fix M10): revival evidence (§3.10 ruling 6) must be the vault's
  // statement time, never the observation time a missing mtime falls back to
  // below — a fabricated "after the deletion" would revive every tombstoned
  // row the note carries.
  const noteMtimes = {};
  // date → { lastModified } for DAILY notes the plugin reported deleted
  // (2026-09-05 finding: these were parked in `unapplied`, which nothing
  // read, so deleting a daily note while paired deleted nothing in
  // dayGLANCE). A deleted note is complete knowledge that none of its
  // lines exist — the same evidence a deleted scoped note gives — and the
  // caller feeds it to the note-scoped inference under the same hold.
  const deletedDailyNotes = {};
  const withdrawn = [];   // paths that left the scope
  const links = [];       // project/goal note link observations (companion §4.3), for the caller
  const allScheduled = [];
  const lineSchedule = {}; // id → the line's own time when it differs from DG's (owned-schedule enforcement)
  const allInbox = [];
  const unapplied = [];
  const completedSince = scope && today ? completedSinceFor(scope, today) : null;
  const ctx = buildExistingObsidianTaskContext(existingTasks, existingInbox);
  if (Array.isArray(projects)) ctx.resolveProject = (ref) => resolveProjectRef(ref, projects);
  const isDefaultPattern = !dailyNotePattern || dailyNotePattern === 'yyyy-MM-dd';
  const dateParser = isDefaultPattern ? null : buildDateParser(dailyNotePattern);
  const folderPrefix = dailyNotesPath ? `${dailyNotesPath.replace(/\/+$/, '')}/` : '';
  const noteKeyOf = (obs) => observationNoteKey(obs, { folderPrefix, isDefaultPattern, dateParser });

  // DUPLICATE-TOKEN DEDUPE, VAULT-WIDE (audit low, 2026-08-31). A `^dg-`
  // token names ONE line; when a line is copy-pasted with its token, the
  // parser lets the first occurrence keep it and the copy falls through as
  // untagged. A scan reads every note in one pass, so "first" is stable.
  // The stream reads notes one observation at a time, and `seenBlockIds`
  // was fresh per batch: whichever note happened to be in the batch won,
  // so the token's owner flip-flopped between observations and the two
  // lines traded identity. Two rules restore the scan's answer:
  //   1. The EXISTING owner keeps its token. Its note goes first within a
  //      batch, and when its note is not in the batch at all, the token is
  //      pre-seeded as taken — but only when the app's last observed text
  //      of that note demonstrably still carries the token, so a line CUT
  //      from one note and pasted into another, or a note renamed with the
  //      old path's deletion arriving a batch earlier, still re-homes the
  //      identity (the stored text no longer has it, or the note is gone).
  //   2. Only daily notes back the pre-seed: their text is stored; a scoped
  //      note's is not, so a token owned by a scoped note outside the batch
  //      is not asserted from memory (the rename-split hazard outweighs it).
  const ownerByToken = ownedTokenNotes(existingTasks, existingInbox);
  const knownNotes = knownDailyNotes ?? readKnownDailyNotes();
  const batchKeys = new Set(observations.map(noteKeyOf).filter(Boolean));
  const seenBlockIds = new Set();
  for (const [token, owner] of ownerByToken) {
    if (batchKeys.has(owner)) continue;
    const text = knownNotes?.[owner]?.text;
    if (typeof text === 'string' && text.includes(`^dg-${token}`)) seenBlockIds.add(token);
  }
  const ownerNotes = new Set(ownerByToken.values());
  const ordered = [...observations].sort((a, b) => {
    const ao = ownerNotes.has(noteKeyOf(a)) ? 0 : 1;
    const bo = ownerNotes.has(noteKeyOf(b)) ? 0 : 1;
    return ao - bo; // stable: owners first, batch order otherwise
  });

  for (const obs of ordered) {
    if (obs.link) {
      if (typeof obs.targetId === 'string' && obs.targetId) {
        links.push({
          targetId: obs.targetId, path: obs.path,
          deleted: !!obs.deleted, unlinked: !!obs.unlinked,
          previousPath: typeof obs.previousPath === 'string' ? obs.previousPath : undefined,
          observedAt: obs.observedAt || new Date().toISOString(),
        });
      }
      continue;
    }
    if (obs.withdrawn) { withdrawn.push(obs.path); continue; }
    if (obs.scoped) {
      const at = obs.mtime ? new Date(obs.mtime).toISOString() : (obs.observedAt || new Date().toISOString());
      if (obs.deleted || obs.content == null) {
        // A deleted scoped note: complete knowledge that none of its lines
        // exist — the note-scoped inference tombstones its tasks after the
        // hold, exactly as for a deleted daily note.
        scopedNotes[obs.path] = { lastModified: obs.observedAt || at, deleted: true };
        continue;
      }
      scopedNotes[obs.path] = { lastModified: at };
      if (obs.mtime) noteMtimes[obs.path] = at;
      const beforeScheduled = allScheduled.length;
      const beforeInbox = allInbox.length;
      mergeParsedObsidianTasks(
        parseTasksFromMarkdown(obs.content, today || '1970-01-01', seenBlockIds, { notePath: obs.path, completedSince }),
        ctx, onTitleConflict, { allScheduled, allInbox, lineSchedule },
      );
      const projectId = projectByNotePath?.[obs.path];
      if (projectId) {
        // First import only (the merge stamps a fresh import with the epoch
        // lastModified); a task already known keeps whatever project the
        // user gave it in the app.
        for (const list of [allScheduled.slice(beforeScheduled), allInbox.slice(beforeInbox)]) {
          for (const t of list) if (!t.projectId && t.lastModified === FRESH_IMPORT_TS) t.projectId = projectId;
        }
      }
      continue;
    }
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
    if (obs.deleted || obs.content == null) {
      // No mtime for a note that is gone: the plugin's sighting of the
      // deletion is the evidence stamp (an app edit newer than it wins).
      deletedDailyNotes[dateStr] = { lastModified: obs.observedAt || new Date().toISOString() };
      continue;
    }

    dailyNotes[dateStr] = {
      text: obs.content,
      lastModified: obs.mtime ? new Date(obs.mtime).toISOString() : (obs.observedAt || new Date().toISOString()),
      fromObsidian: true,
    };
    if (obs.mtime) noteMtimes[dateStr] = dailyNotes[dateStr].lastModified;
    mergeParsedObsidianTasks(
      parseTasksFromMarkdown(obs.content, dateStr, seenBlockIds),
      ctx, onTitleConflict, { allScheduled, allInbox, lineSchedule },
    );
  }

  const scannedIds = new Set([
    ...[...allScheduled, ...allInbox].map((t) => String(t.id)),
    ...[...allScheduled, ...allInbox].filter((t) => t.obsidianLegacyId).map((t) => String(t.obsidianLegacyId)),
  ]);
  return { dailyNotes, noteMtimes, deletedDailyNotes, scopedNotes, withdrawn, links, scheduledTasks: allScheduled, inboxTasks: allInbox, scannedIds, unapplied, lineSchedule };
}
