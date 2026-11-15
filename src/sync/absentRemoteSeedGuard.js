/**
 * The file tier's seed guard: an absent remote file is not a licence to write.
 *
 * ── The hazard ─────────────────────────────────────────────────────────────
 * `@glance-apps/sync`'s file engine runs download → merge → upload, and takes a
 * provider `download()` that resolved falsy as "there is no remote file yet, so
 * seed it from local state":
 *
 *     const downloaded = await provider.download(cfg);
 *     if (!downloaded) {
 *       // Empty remote — seed it with local state.
 *       if (!(await upload({ skipLockCheck: true }))) uploadFailed = true;
 *       return false;
 *     }
 *
 * For every WebDAV provider (nextcloud, koofr, webdav) falsy means exactly one
 * thing — HTTP 404 (`providers.js`: `if (res.status === 404) return null`). That
 * write is unconditional in both senses that matter: `skipLockCheck` also drops
 * the If-Match validator, so the server has no way to refuse it, and nothing was
 * merged because nothing was read. So a 404 on a device that has synced before —
 * an outbound proxy answering for a host it cannot reach, a path that resolved
 * differently this time, a captive portal — replaces the remote snapshot with
 * this device's whole local copy, and the remote's newer rows are gone with
 * nothing on either side left to notice.
 *
 * dayGLANCE's existing upload validator does not cover this: it refuses an EMPTY
 * payload over a populated local store (adapter.js, the stale-state race). The
 * payload here is an older *complete* snapshot, which is exactly what passes it.
 *
 * ── The rule, and why it is the snapshot tier's ────────────────────────────
 * iCloud and Direct Access already had to answer this question and settled it
 * (utils/icloudSeedGuard.js): absence is TIMED, not trusted. The decision itself
 * is shared from the package as `evaluateMissingSnapshot` / `MISSING_GRACE_MS`,
 * and this module applies it to the file tier rather than growing a second rule
 * that could drift from the first.
 *
 * The trade is bounded in both directions, which is the whole point: a 404 that
 * clears inside the grace window never writes, and a file that is genuinely gone
 * — the user deleted it, the server was rebuilt, the path moved for good — still
 * re-seeds once the window expires, with no user action and no way to get stuck.
 * A device that has never synced seeds immediately: nothing can have been
 * evicted on a first run, and refusing forever would strand it.
 *
 * ── Where the evidence comes from ──────────────────────────────────────────
 * The engine hands the upload validator an envelope and nothing else, so the
 * read outcome cannot be inferred there. The seam that can see it is the
 * providers map the engine itself reads (`providers[cfg.provider]`), so the
 * guard observes reads by wrapping each provider's `download`.
 */

import { evaluateMissingSnapshot, MISSING_GRACE_MS } from '@glance-apps/sync';

export { MISSING_GRACE_MS };

/**
 * The English wording handed to `onError`; the UI renders
 * `sync.errors.ABSENT_REMOTE_HOLD` instead when the code maps to a locale.
 * It states what was seen, that nothing was written, and that the local copy is
 * safe — in that order, because "nothing was written" is the load-bearing part.
 */
export const ABSENT_REMOTE_REASON =
  'The sync file is missing from your sync server. Nothing was written over it — your changes are safe on this device. ' +
  'If it is really gone, syncing will re-create it automatically.';

/**
 * Holds the absence streak for one engine and answers "may this upload go out?".
 *
 * @param {object} [io]
 * @param {() => boolean} [io.hasSyncedBefore]  this device has completed a sync
 *   before, so the remote file is known to have existed
 * @param {() => number}  [io.now]              epoch ms (injectable for tests)
 * @param {number}        [io.graceMs]          how long an absence is presumed
 *   temporary; defaults to the snapshot tier's window
 */
export function createAbsentRemoteSeedGuard({
  hasSyncedBefore = () => false,
  now = Date.now,
  graceMs = MISSING_GRACE_MS,
} = {}) {
  // 0 while the last read found a file (or nothing has been read yet); else the
  // epoch ms of the FIRST consecutive absent read, so the window measures the
  // whole streak instead of restarting on every cycle.
  let missingSince = 0;
  // Set by the read wrapper, consumed by the very next upload decision. One-shot
  // on purpose: a bare `engine.upload()` — either branch of the conflict dialog,
  // or anything added later — is not preceded by a read and must never be judged
  // by an absence some earlier cycle observed.
  let absencePending = false;

  return {
    /**
     * Record what a provider's `download()` resolved to. The falsy test mirrors
     * the engine's own `if (!downloaded)`, so the guard and the seed branch can
     * never disagree about which reads are "absent".
     */
    observeRead(result) {
      if (!result) {
        absencePending = true;
        return;
      }
      // A real read: the streak is over and the file is present again.
      missingSince = 0;
      absencePending = false;
    },

    /**
     * May the upload the engine is about to make proceed? Consumes the absence
     * observation, so the answer is about THIS read and no earlier one.
     *
     * `absence` reports whether THIS decision followed a read that found no file.
     * The verified-write gate needs it: an absent file has no ETag to validate a
     * write with, so only the seed branch may write without one.
     *
     * @returns {{allowed: boolean, missingSince: number, absence: boolean, reason?: string}}
     */
    decideUpload() {
      if (!absencePending) return { allowed: true, missingSince, absence: false };
      absencePending = false;
      const decision = evaluateMissingSnapshot({
        hasSyncedBefore: !!hasSyncedBefore(),
        missingSince,
        now: now(),
        graceMs,
      });
      missingSince = decision.missingSince;
      if (!decision.skip) return { allowed: true, missingSince, absence: true };
      return { allowed: false, missingSince, absence: true, reason: ABSENT_REMOTE_REASON };
    },

    /** What the guard is currently holding. For diagnostics and tests. */
    state: () => ({ missingSince, absencePending }),
  };
}

/**
 * Wrap each provider's `download` so the guard sees every read outcome.
 *
 * The engine calls `providers[cfg.provider].download(cfg)` — with the provider
 * as `this`, because the providers are object literals whose methods call
 * `this.getFileUrl(...)` — so the wrapper has to call through with the same
 * receiver. `engine.providers` IS the map the engine reads (the package returns
 * it by reference, "exposed for app-level features the engine doesn't own"), so
 * wrapping in place is what the engine observes.
 *
 * Idempotent, and exported because the engine builds its providers internally: a
 * caller that injects one of its own afterwards has to install the guard on it
 * explicitly.
 *
 * Takes any number of observers, each needing `observeRead(result)`. The
 * verified-write gate rides the same wrapper, so the absence rule and the record
 * of what was read can never disagree about which reads happened.
 *
 * @param {Record<string, object>} providers
 * @param {...{observeRead: (result: unknown) => void}} guards
 */
export function installAbsentRemoteSeedGuard(providers, ...guards) {
  const observers = guards.filter((guard) => guard && typeof guard.observeRead === 'function');
  for (const provider of Object.values(providers || {})) {
    if (!provider || typeof provider.download !== 'function') continue;
    if (provider.download.absentRemoteSeedGuarded) continue;
    const original = provider.download;
    // Every argument goes through: the engine's second one is the conditional
    // read (`{ ifNoneMatch }`, its idle gate), and a wrapper that took only
    // `cfg` turned every quiet poll into a full download of the sync file.
    // A 304 comes back as `{ notModified: true, etag }`: a truthy result, and
    // rightly a read of the target, since the server has just confirmed the
    // file is the one this device already merged.
    const wrapped = async function (...args) {
      const result = await original.apply(this, args);
      for (const observer of observers) observer.observeRead(result);
      return result;
    };
    wrapped.absentRemoteSeedGuarded = true;
    provider.download = wrapped;
  }
  return providers;
}
