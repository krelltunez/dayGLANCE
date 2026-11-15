/**
 * The file tier's write gate: no upload without knowledge, and a validator on
 * every upload the engine did not read for.
 *
 * ── The hazard this closes ─────────────────────────────────────────────────
 * The engine's cycle reads, merges, then writes (with `If-Match` from the read).
 * Two other writers reached the same provider with no read at all: `App.jsx`'s
 * 5-second debounced upload on data changes, and the header/desktop sync button
 * (`engine.upload()`). Both called `engine.upload()` with no payload and no
 * ETag, so the provider PUT this device's whole snapshot with no validator —
 * after a misconfiguration the device has never read the remote, and the other
 * devices' data is gone with nothing on either side able to notice. The
 * absent-remote seed guard (`absentRemoteSeedGuard.js`) covers the 404 branch of
 * the cycle only, and its own docstring says so: a manual upload is deliberately
 * not judged by it.
 *
 * Both writers now run the full cycle (`utils/syncNowAction.js`, and the
 * debounce in `App.jsx`), so no in-app caller deliberately uploads unread. The
 * gate stays because "no in-app caller today" is not a guarantee: a bare
 * `engine.upload()` — the conflict dialog's, with the ETag it was shown, or
 * anything added later — still has to be checked, and still must not put this
 * device's snapshot on a server it has not read.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * Every write must be authorized by a read of the SAME target (`syncTarget.js`):
 *
 *   mode 'seed'        a read in this cycle found no remote file, and the seed
 *                      guard's timed rule allowed the seed. No validator exists
 *                      (the file is believed absent), so none is sent.
 *   mode 'cycle'       a read in this cycle found the file; the write is the
 *                      cycle's own. The read's ETag rides along — and the
 *                      validator the ENGINE passes is never overridden, so the
 *                      fallback after two 412s stays unconditional.
 *   mode 'conditional' no read in this cycle: the write is allowed only against
 *                      the ETag of the last verified read OF THIS TARGET, so a
 *                      server that has moved on refuses it (412) and the next
 *                      cycle re-reads, merges and writes. This is the last
 *                      resort for a bare upload; no ambient writer needs it.
 *   mode 'unverified'  nothing to authorize it: REFUSED. The refusal is
 *                      reported, never silent — a write that quietly did not
 *                      happen would otherwise be stamped "synced".
 *   mode 'replace'     the user asked for the server copy to be replaced, and a
 *                      read made for that request, moments ago, found the file
 *                      there but unreadable (unreadableRemote.js, #2409). No
 *                      validator exists for a file that cannot be read, so none
 *                      is sent. Both halves are required and both are one-shot:
 *                      the request alone authorizes nothing, and neither does
 *                      an unreadable read nobody asked to act on.
 *
 * A server that sends no ETag is the one honest gap: a cycle write may still go
 * out unvalidated (refusing it would stop syncing entirely), while a write with
 * no read behind it is refused. Edits still reach the server — through the next
 * full cycle, which reads first.
 */

import { installAbsentRemoteSeedGuard } from './absentRemoteSeedGuard.js';
import { readVerifiedRemote, writeVerifiedRemote } from './verifiedRemote.js';

export const WRITE_UNVERIFIED_CODE = 'WRITE_UNVERIFIED';

/**
 * Handed to `onError`; the UI renders `sync.errors.WRITE_UNVERIFIED`. It has to
 * say two things in this order: nothing was written, and the local copy is safe
 * — the user's next question is whether their data is intact.
 */
export const WRITE_UNVERIFIED_REASON =
  'This device has not read your sync server yet, so nothing was uploaded. ' +
  'Your changes are safe on this device — the next sync reads the server first, then writes.';

/**
 * How long a read stays "this cycle's read" for a write that follows it. The
 * engine validates and uploads back to back inside one cycle (buildPayload and
 * the merge happen after the read but before the upload, and the 412 retry
 * re-reads), so a few seconds is generous. The bound matters: without it a read
 * from a cycle that had nothing to upload could later authorize an unrelated
 * write, which is the one-shot leak this guard is meant not to have.
 */
export const CYCLE_READ_TTL_MS = 10 * 1000;

/**
 * @param {object} io
 * @param {object} io.seedGuard     the absent-remote rule (requires the module
 *   whose whole job is "is this absence real?"), consumed through
 *   `observeRead`/`decideUpload`
 * @param {() => string|null} [io.targetKey]  the CURRENT target identity
 * @param {Storage|null} [io.storage]         injectable for tests
 * @param {() => number} [io.now]
 * @param {number} [io.cycleReadTtlMs]
 */
export function createVerifiedWriteGuard({
  seedGuard,
  targetKey = () => null,
  storage,
  now = Date.now,
  cycleReadTtlMs = CYCLE_READ_TTL_MS,
} = {}) {
  if (!seedGuard) throw new Error('createVerifiedWriteGuard: seedGuard is required');

  // What the last provider read in this cycle resolved to, and when.
  let cycleRead = null;
  // The validator the next provider.upload should carry. Set by decideWrite —
  // which the engine calls immediately before that upload — and consumed by the
  // upload wrapper.
  let pendingWrite = null;
  // When this cycle's read found nothing. Only an absence THIS cycle observed may
  // authorize a seed write: a cycle that read nothing and then never reached its
  // upload (a payload build that threw) would otherwise leave the absence
  // standing, and a later unbacked write would ride it out unvalidated.
  let cycleAbsentAt = null;
  // When the last read found a file it could not read, and when the user last
  // asked for such a file to be replaced. A 'replace' write needs both, fresh.
  let cycleUnreadableAt = null;
  let replaceAuthorizedAt = null;

  const currentTarget = () => {
    try { return targetKey() || null; } catch { return null; }
  };

  return {
    // Exposed so the installer can wire the download seam to this guard, which
    // forwards the read to the seed rule.
    seedGuard,

    /**
     * Record what a provider's `download()` resolved to. A falsy result is the
     * seed rule's business (it owns the "is this absence real?" decision); a
     * truthy one is a verified read of the current target, and its ETag is what
     * later writes outside a cycle are allowed to be conditional on.
     */
    observeRead(result) {
      seedGuard.observeRead(result);
      // The read resolved, so whatever was unreadable no longer is.
      cycleUnreadableAt = null;
      if (!result) {
        cycleRead = null;
        cycleAbsentAt = now();
        return;
      }
      const at = now();
      const etag = typeof result.etag === 'string' && result.etag ? result.etag : null;
      cycleRead = { at, etag };
      // A real read ends any absence: the file is present again.
      cycleAbsentAt = null;
      const key = currentTarget();
      if (key) writeVerifiedRemote({ targetKey: key, etag, readAt: at }, storage);
    },

    /**
     * A read found the remote file there but unreadable. It is no read of the
     * target and no absence: nothing a write could stand on, except the one the
     * user asks for.
     */
    observeUnreadable() {
      cycleRead = null;
      cycleAbsentAt = null;
      cycleUnreadableAt = now();
    },

    /**
     * The user asked for an unreadable server copy to be replaced. Arms ONE
     * upload decision, and only when a read has just found the file unreadable.
     * @returns {boolean} whether there is an unreadable read to act on
     */
    authorizeReplace() {
      if (cycleUnreadableAt == null || now() - cycleUnreadableAt > cycleReadTtlMs) {
        replaceAuthorizedAt = null;
        return false;
      }
      replaceAuthorizedAt = now();
      return true;
    },

    /** The upload a replace was armed for did not reach its decision. */
    cancelReplace() {
      replaceAuthorizedAt = null;
    },

    /**
     * May the upload the engine is about to make proceed, and with which
     * validator? Called once per upload from `validateUploadPayload`.
     *
     * @returns {{allowed:boolean, mode:string, etag?:string|null,
     *            code?:string, reason?:string}}
     */
    decideWrite() {
      // One-shot whatever the outcome: a request that was not used by the
      // upload it was made for must not authorize a later one.
      const replaceAt = replaceAuthorizedAt;
      const unreadableAt = cycleUnreadableAt;
      replaceAuthorizedAt = null;
      if (replaceAt != null) {
        cycleUnreadableAt = null;
        if (unreadableAt != null && now() - unreadableAt <= cycleReadTtlMs && now() - replaceAt <= cycleReadTtlMs) {
          // The seed rule's pending absence, if any, is about an earlier read.
          seedGuard.decideUpload();
          cycleRead = null;
          cycleAbsentAt = null;
          pendingWrite = { mode: 'replace', etag: null };
          return { allowed: true, mode: 'replace' };
        }
      }

      const seed = seedGuard.decideUpload();

      if (seed.absence) {
        const absentAt = cycleAbsentAt;
        cycleAbsentAt = null;
        if (!seed.allowed) {
          pendingWrite = null;
          return { allowed: false, mode: 'seed-held', code: 'ABSENT_REMOTE_HOLD', reason: seed.reason };
        }
        if (absentAt != null && now() - absentAt <= cycleReadTtlMs) {
          // The file is believed absent: there is no validator to send, and
          // `If-Match` would be wrong (it demands the resource exist).
          pendingWrite = { mode: 'seed', etag: null };
          return { allowed: true, mode: 'seed' };
        }
        // A stale absence is not evidence this write can stand on.
        pendingWrite = null;
        return { allowed: false, mode: 'unverified', code: WRITE_UNVERIFIED_CODE, reason: WRITE_UNVERIFIED_REASON };
      }

      cycleAbsentAt = null;
      const read = cycleRead;
      cycleRead = null;
      if (read && now() - read.at <= cycleReadTtlMs) {
        pendingWrite = { mode: 'cycle', etag: read.etag };
        return { allowed: true, mode: 'cycle', etag: read.etag };
      }

      const verified = readVerifiedRemote(storage);
      const key = currentTarget();
      if (verified.etag && key && verified.targetKey === key) {
        pendingWrite = { mode: 'conditional', etag: verified.etag };
        return { allowed: true, mode: 'conditional', etag: verified.etag };
      }

      pendingWrite = null;
      return { allowed: false, mode: 'unverified', code: WRITE_UNVERIFIED_CODE, reason: WRITE_UNVERIFIED_REASON };
    },

    /** The validator the pending upload should carry; one-shot. */
    consumeWritePlan() {
      const plan = pendingWrite;
      pendingWrite = null;
      return plan;
    },

    /** Drop a plan whose write will not happen (the engine refused the payload). */
    discardWritePlan() {
      pendingWrite = null;
    },

    /** The verified ETag for the current target, or null. */
    verifiedEtag() {
      const verified = readVerifiedRemote(storage);
      const key = currentTarget();
      return verified.etag && key && verified.targetKey === key ? verified.etag : null;
    },

    /**
     * The engine reports a successful sync with `onLastSyncedChange`; the target
     * it succeeded against is what makes "this device has synced before"
     * target-scoped rather than global.
     */
    recordLastSyncedTarget() {
      const key = currentTarget();
      if (!key) return null;
      return writeVerifiedRemote({ lastSyncTargetKey: key, lastSyncedAt: now() }, storage);
    },

    /** For diagnostics and tests. */
    state: () => ({ cycleRead, cycleAbsentAt, cycleUnreadableAt, replaceAuthorizedAt, pendingWrite }),
  };
}

/**
 * Wrap the providers map the engine reads (it passes the map out by reference).
 *
 * `download` is wrapped through `installAbsentRemoteSeedGuard` with this guard as
 * the observer, so the seed rule and the verified-read record see exactly the same
 * read outcome. `upload` is wrapped so a write the engine did not read for still
 * carries the last verified ETag — the server then has something to refuse.
 *
 * The wrapper only supplies a validator for a `'conditional'` plan. Whatever the
 * engine passes is kept (including nothing): a cycle's own ETag is the engine's
 * business, and a cycle that passes none means an unconditional PUT on purpose —
 * either the read carried no ETag (a server that sends none) or the engine is in
 * the last-resort fallback after two 412s (`skipIfMatch`, the fix for servers
 * whose ETag cannot round-trip through If-Match). Injecting the read's ETag into
 * that fallback re-arms the validator the server just rejected, and the sync
 * wedges exactly where the fallback exists to un-wedge it.
 *
 * Idempotent, and tolerant of a missing map or a provider without those methods.
 */
export function installVerifiedWriteGuard(providers, guard) {
  installAbsentRemoteSeedGuard(providers, guard);

  for (const provider of Object.values(providers || {})) {
    if (!provider || typeof provider.upload !== 'function') continue;
    if (provider.upload.verifiedWriteGuarded) continue;
    const original = provider.upload;
    const wrapped = async function (cfg, envelope, etag = null) {
      // Consume the plan whatever happens: a plan is about THIS upload only.
      const plan = guard.consumeWritePlan();
      let effective = etag || null;
      // A 'replace' plan is an unconditional PUT on purpose: the file it
      // replaces could not be read, so there is no ETag to hold it to.
      if (!effective && plan && plan.mode === 'conditional') effective = plan.etag || null;
      if (!effective && !plan) {
        // No plan means the engine called upload() without validating first.
        // Fall back to the verified read rather than writing unconditionally.
        effective = guard.verifiedEtag();
      }
      return original.call(this, cfg, envelope, effective);
    };
    wrapped.verifiedWriteGuarded = true;
    provider.upload = wrapped;
  }
  return providers;
}

/**
 * "Has this device synced THIS target before?" — the signal the seed rule uses to
 * tell a real absence from a first run.
 *
 * Target-scoped once a target record exists. Before this record did (an upgrade),
 * the engine's global `last-synced` stamp is the only evidence there is, so it is
 * used — which keeps the previous behaviour for existing users until their next
 * successful sync writes the scoped record. The global stamp alone is what made a
 * brand-new folder look like an eviction and let a new server inherit the old
 * one's absence streak.
 */
export function targetScopedHasSyncedBefore({ targetKey, legacyLastSyncedKey, storage } = {}) {
  const recorded = readVerifiedRemote(storage).lastSyncTargetKey;
  const key = typeof targetKey === 'function' ? targetKey() : targetKey;
  if (recorded) return !!key && recorded === key;
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  try {
    return !!(store && legacyLastSyncedKey && store.getItem(legacyLastSyncedKey));
  } catch {
    return false;
  }
}
