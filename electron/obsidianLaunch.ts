// Launch-on-write debounce (Obsidian build-out Phase 1): after a quiet window
// following vault writes, the last-written file is opened via obsidian:// so
// Obsidian Sync pushes the change. Pure module with injected timers so the
// debounce is unit-testable without Electron (same pattern as fsRetry.ts and
// obsidianUri.ts).
//
// WHY THIS LIVES IN THE MAIN PROCESS: every desktop vault write funnels through
// the obsidian:write-file IPC handler — the one place that both knows the
// resolved absolute path and knows whether the write succeeded. The renderer
// only ever pushes a boolean toggle over IPC; it never supplies a URI or path,
// preserving the http/https-only external-URL posture documented in
// obsidianUri.ts.

// 8 seconds, trailing edge, reset on every write (spec §6 Phase 1): a leisurely
// triage session can have 5-plus second gaps between task edits, which a
// shorter window would split into multiple launches, while past 8 seconds
// nothing further coalesces in practice. An extra launch is nearly free (it
// focuses or no-ops); added delay is invisible.
export const LAUNCH_ON_WRITE_QUIET_MS = 8_000;

export interface LaunchOnWriteTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface LaunchScheduler {
  /** Renderer-pushed toggle. Turning off clears any pending launch. */
  setEnabled(enabled: boolean): void;
  /** Record a successful vault write; (re)starts the quiet window. */
  noteWrite(absPath: string): void;
  /**
   * Drop any pending launch without touching the enabled flag — for
   * obsidian:disconnect and obsidian:pick, where the pending path belongs to
   * a vault the user just swapped away from.
   */
  cancelPending(): void;
  /** Fire a pending launch immediately (app quit) instead of dropping it. */
  flush(): void;
}

const defaultTimers: LaunchOnWriteTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createLaunchScheduler(
  launch: (absPath: string) => void,
  quietMs: number = LAUNCH_ON_WRITE_QUIET_MS,
  timers: LaunchOnWriteTimers = defaultTimers,
): LaunchScheduler {
  let enabled = false;
  let timer: unknown = null;
  let pendingPath: string | null = null;

  const clearPending = () => {
    if (timer !== null) {
      timers.clearTimeout(timer);
      timer = null;
    }
    pendingPath = null;
  };

  return {
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) clearPending();
    },

    noteWrite(absPath: string) {
      if (!enabled) return;
      // A burst opens the last-written file; any file in the vault wakes Sync.
      pendingPath = absPath;
      if (timer !== null) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => {
        timer = null;
        const path = pendingPath;
        pendingPath = null;
        if (path) launch(path);
      }, quietMs);
    },

    cancelPending: clearPending,

    flush() {
      if (pendingPath === null) return;
      const path = pendingPath;
      clearPending();
      launch(path);
    },
  };
}
