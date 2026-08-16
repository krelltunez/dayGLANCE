// Pure crash-recovery decisions for the renderer windows, startupQuit.ts
// style: the whole state machine lives here, unit-tested and
// mutation-verified, and main.ts wires it to render-process-gone events.
//
// The recovery ladder runs inside a rolling window: the first qualifying
// crash reloads the existing window (cheapest, preserves bounds, fullscreen
// state, listeners, and crucially the hidden-not-quit state on macOS), a
// second escalates to destroy-and-recreate (a poisoned renderer can survive
// reload), and anything further gives up rather than strobe the CPU with an
// unbounded reload loop. Attempts older than the window are forgotten: a
// crash a day after the last one is a new incident, not an escalation.
//
// Never recovered from:
//  - 'clean-exit': fires during ordinary teardown and navigation.
//  - isQuitting: recovery must not fight the shutdown sequence. The caller
//    re-checks this flag inside its deferred tick as well, closing the
//    crash-a-moment-before-quit race this pure function cannot see.
//  - unknown reasons (e.g. 'integrity-failure'): log-only, fail-safe.
//
// 'launch-failed' means the renderer never loaded at all, so first-rung
// recovery is a full loadURL rather than a reload of a frame that never had
// content; the escalation rungs are shared.

export const RECOVER_REASONS = ['crashed', 'oom', 'killed', 'abnormal-exit'] as const;
export const RECOVERY_WINDOW_MS = 30_000;
/** reload (or load-url), then recreate, then stop. */
export const MAX_RECOVERY_ATTEMPTS = 3;

export type RecoveryAction = 'ignore' | 'reload' | 'load-url' | 'recreate' | 'give-up';

export interface RecoveryDecision {
  action: RecoveryAction;
  /** The caller's next attempts list (pruned; appended only when acting). */
  attempts: number[];
}

export function decideRecovery(input: {
  reason: string;
  isQuitting: boolean;
  attempts: number[];
  now: number;
  windowMs?: number;
  maxAttempts?: number;
}): RecoveryDecision {
  const windowMs = input.windowMs ?? RECOVERY_WINDOW_MS;
  const maxAttempts = input.maxAttempts ?? MAX_RECOVERY_ATTEMPTS;
  const recent = (input.attempts ?? []).filter((t) => input.now - t < windowMs);

  if (input.isQuitting) return { action: 'ignore', attempts: recent };
  // Recovery is allowlist-only: 'clean-exit' (ordinary teardown and
  // navigation) and unknown reasons are excluded by not being listed, one
  // path with no redundant guard to drift.
  const qualifies =
    (RECOVER_REASONS as readonly string[]).includes(input.reason) || input.reason === 'launch-failed';
  if (!qualifies) return { action: 'ignore', attempts: recent };

  // The ladder position is the count of recent attempts: 0 reload, 1
  // recreate, and the final rung never acts, so a run of crashes performs
  // exactly maxAttempts - 1 recoveries before going quiet.
  if (recent.length >= maxAttempts - 1) {
    return { action: 'give-up', attempts: recent };
  }
  const firstRung = input.reason === 'launch-failed' ? 'load-url' : 'reload';
  return {
    action: recent.length === 0 ? firstRung : 'recreate',
    attempts: [...recent, input.now],
  };
}
