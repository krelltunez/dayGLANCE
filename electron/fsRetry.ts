/**
 * Retry wrapper for filesystem calls against the iCloud container.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * Observed in a Mac App Store build:
 *
 *     iCloud unavailable: EINTR: interrupted system call, read
 *
 * EINTR means the read(2) syscall was interrupted by a signal before it
 * transferred anything. It is not an iCloud problem, not a permissions problem,
 * and not a missing file: the correct response has always been to reissue the
 * call. Node retries EINTR internally in some paths but not in fs.readFileSync,
 * and reads from ~/Library/Mobile Documents are unusually exposed to it because
 * the iCloud daemon is materialising the file underneath us.
 *
 * Unretried, it surfaced through icloud.ts's catch-all as a structured error,
 * which the renderer reports as "iCloud unavailable" and flashes as a sync
 * failure — a scary, wrong message for a condition that resolves on the next
 * attempt.
 *
 * ── No delay between attempts, deliberately ────────────────────────────────
 * The interrupting signal has already been handled by the time the call returns,
 * so an immediate reissue is the standard remedy and normally succeeds first
 * time. A sleep here would block the Electron main process, which is worse than
 * the error being fixed.
 */

/**
 * Errno codes that mean "the call did not happen, try it again".
 *
 * Deliberately narrow. EBUSY and ENOENT are NOT here: EBUSY can persist for as
 * long as another process holds the file, and ENOENT is a real answer about the
 * world that callers already handle (icloud.ts distinguishes "no remote file
 * yet" from "iCloud unavailable" on exactly that basis). Retrying either would
 * turn a fast, correct result into a slow, identical one.
 */
export const TRANSIENT_FS_CODES: ReadonlySet<string> = new Set(['EINTR', 'EAGAIN']);

/** True when an error is one of the retryable interruptions. */
export function isTransientFsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && TRANSIENT_FS_CODES.has(code);
}

/**
 * Runs a synchronous filesystem operation, reissuing it on a transient
 * interruption.
 *
 * Anything not in TRANSIENT_FS_CODES is rethrown on the first attempt, so a
 * genuine failure (no iCloud account, permissions, a corrupt path) still reaches
 * the caller's error handling immediately rather than after N pointless retries.
 * A transient error that survives every attempt is also rethrown, since at that
 * point it is no longer behaving transiently and the caller should hear about it.
 *
 * @param op        the filesystem call
 * @param attempts  total attempts including the first (minimum 1)
 */
export function retryTransientFs<T>(op: () => T, attempts = 3): T {
  const total = Math.max(1, attempts);
  let lastErr: unknown;
  for (let i = 0; i < total; i++) {
    try {
      return op();
    } catch (err) {
      if (!isTransientFsError(err)) throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}
