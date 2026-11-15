/**
 * The file tier's answer to a remote sync file that is there but cannot be read
 * (#2409).
 *
 * ── What happens ───────────────────────────────────────────────────────────
 * The server answers 200 and the body is not a sync file: an upload that was cut
 * off and left half a JSON document, a server that answers 200 with a page for a
 * path that does not exist, a proxy's error page. `@glance-apps/sync` throws
 * from `download()`, and its engine files every error it has no code for under
 * NETWORK_ERROR, so the user was told to check a connection that was fine, on
 * every cycle, for as long as the file stayed that way. A truncated file never
 * repairs itself.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * Unreadable is not absent, and it is not a licence to write. A 200 that cannot
 * be read is exactly what a captive portal or a misrouted proxy sends, and
 * putting this device's snapshot over the real file on that evidence would lose
 * whatever the other devices had written (the hazard absentRemoteSeedGuard.js
 * describes for a 404). So the automatic cycle does what it did: nothing.
 *
 * What changes is that the failure is named (REMOTE_UNREADABLE, with words that
 * say nothing was written), and that the user can end it: "Replace the server
 * copy" reads the file again and, only if that read is unreadable too, uploads
 * this device's data in its place (`replaceUnreadableRemote` in adapter.js, mode
 * 'replace' in verifiedWriteGuard.js). A file that reads normally is never
 * replaced by it: that case runs an ordinary cycle, which merges.
 */

export const REMOTE_UNREADABLE_CODE = 'REMOTE_UNREADABLE';

/**
 * Handed to `onError`; the UI renders `sync.errors.REMOTE_UNREADABLE`. What was
 * seen, that nothing was written, and that the local copy is safe, in that
 * order. The way out is the button beside it in the sync settings.
 */
export const REMOTE_UNREADABLE_REASON =
  'The sync file on your sync server is damaged or is not a sync file, so it could not be read. ' +
  'Nothing was written over it, and your changes are safe on this device.';

// The package's Electron and Android transports parse the body themselves and
// throw this (providers.js, webdavFetch); the web transport hands back a real
// Response, whose json() throws a SyntaxError. unreadableRemote.test.js holds
// both shapes against the installed package.
const NON_JSON = /^Server returned non-JSON response \(status \d+\)$/;

/** Did `download()` fail because the body was not JSON? */
export function isUnreadableRemoteError(err) {
  if (!err) return false;
  if (err.code === REMOTE_UNREADABLE_CODE) return true;
  if (err instanceof SyntaxError || err.name === 'SyntaxError') return true;
  return typeof err.message === 'string' && NON_JSON.test(err.message);
}

/**
 * Is a result `download()` resolved to JSON that is not a sync file? Mirrors the
 * engine's own first check (validateEnvelope: an object with a `data` field), so
 * the two can never disagree about which bodies are usable. A 304 carries no
 * payload and is not judged.
 */
export function isUnusablePayload(result) {
  if (!result || result.notModified) return false;
  const payload = result.payload;
  return !payload || typeof payload !== 'object' || !payload.data;
}

const unreadableError = (cause) => {
  const err = new Error(REMOTE_UNREADABLE_REASON);
  err.code = REMOTE_UNREADABLE_CODE;
  err.cause = cause;
  return err;
};

/**
 * Remembers whether the last read was unreadable, for the error the engine is
 * about to report and for the UI's "is it still broken?".
 */
export function createUnreadableRemoteTracker({ now = Date.now } = {}) {
  // Epoch ms of the FIRST consecutive unreadable read; 0 once a read succeeds.
  let since = 0;
  // Set by an unreadable read, taken by the next error the engine reports: the
  // engine reports it as NETWORK_ERROR, and this is how adapter.js knows which
  // NETWORK_ERROR it was.
  let pending = false;

  return {
    observeUnreadable() {
      if (!since) since = now();
      pending = true;
    },
    /** A read that resolved, to a file or to none: the streak is over. */
    observeRead() {
      since = 0;
      pending = false;
    },
    /** True once per unreadable read. */
    takeReport() {
      const report = pending;
      pending = false;
      return report;
    },
    state: () => ({ since, pending }),
  };
}

/**
 * Wrap each provider's `download` so an unreadable body is one named error.
 *
 * Installed BEFORE the verified-write guard, so it sits inside that guard's own
 * wrapper: JSON that is not a sync file must not be recorded as a verified read
 * of the target, which is what it was while only the engine judged it.
 *
 * Idempotent, and tolerant of a missing map or a provider without `download`.
 *
 * @param {Record<string, object>} providers
 * @param {...{observeUnreadable?: Function, observeRead?: Function}} observers
 */
export function installUnreadableRemoteGuard(providers, ...observers) {
  const tell = (method, ...args) => {
    for (const observer of observers) observer?.[method]?.(...args);
  };
  for (const provider of Object.values(providers || {})) {
    if (!provider || typeof provider.download !== 'function') continue;
    if (provider.download.unreadableRemoteGuarded) continue;
    const original = provider.download;
    const wrapped = async function (...args) {
      let result;
      try {
        result = await original.apply(this, args);
      } catch (err) {
        if (!isUnreadableRemoteError(err)) throw err;
        tell('observeUnreadable');
        throw unreadableError(err);
      }
      if (isUnusablePayload(result)) {
        tell('observeUnreadable');
        throw unreadableError(null);
      }
      return result;
    };
    wrapped.unreadableRemoteGuarded = true;
    provider.download = wrapped;
  }
  return providers;
}
