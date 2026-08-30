// THE DEVICE-WIDE VAULT REQUEST BRAKE — one 429 backoff for every
// app-owned GLANCEvault request path.
//
// The server rate-limits per IP (default 600/min): ONE budget shared by
// every path on this device (and every device behind the same NAT). A 429
// on any path is the limiter saying the same thing to all of them, so the
// brake is deliberately a single module-level instance — a bridge 429
// pauses db-intents requests and vice versa, because retrying on a sister
// path against the same exhausted window is the same mistake. Born as the
// bridge brake (#1481, obsidianBridgeStream.js), extracted here when
// db-intents — the last unbraked caller — joined (the "each new caller has
// to remember" pattern this module ends). The DB sync engine keeps its own
// cycle breaker (cycle-level gating + deferred retry, different semantics);
// unification lives in @glance-apps/sync's client when the brake moves
// into it — at that point this module's consumers swap one import.
//
// Semantics:
//  • One arming per burst: concurrent 429s from one incident don't
//    compound; escalation comes from failing again AFTER a brake lifted.
//    Exponential 30s → 10min. The arming line is the once-per-incident
//    visibility — gated paths stay silent by design.
//  • DECAY, never amnesty (the plugin-side live bug of 2026-08-30): a
//    success clears the GATE (the window demonstrably has room) but only
//    HALVES the escalation memory, so the next 429 re-arms at the storm's
//    level; a genuine recovery drains the memory to zero within a few
//    quiet successes. Both transitions log.
//  • While braked, emits still QUEUE (the outboxes are the durable
//    buffers) — only network attempts pause.

const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;
let backoffMs = 0;
let backoffUntil = 0;

export function vaultRateLimited(nowMs = Date.now()) {
  return nowMs < backoffUntil;
}

/** True when the error is the server's rate limiter (or a 429 quota). */
export function isRateLimitError(err) {
  return err?.status === 429;
}

/**
 * Note a 429 from any vault request path. `source` names the path that saw
 * it ('bridge', 'db-intent', …) — one arming log per incident, so the
 * console says which path met the limiter without every gated sibling
 * repeating it.
 */
export function noteVaultRateLimit(source = 'vault') {
  if (vaultRateLimited()) return;
  backoffMs = Math.min(backoffMs ? backoffMs * 2 : BACKOFF_BASE_MS, BACKOFF_MAX_MS);
  backoffUntil = Date.now() + backoffMs;
  console.info(`[${source}] BRAKE: rate-limited (429) — vault requests paused for ~${Math.round(backoffMs / 1000)}s (all app-owned vault paths).`);
}

export function noteVaultRequestSuccess() {
  backoffUntil = 0;
  if (backoffMs === 0) return;
  backoffMs = Math.floor(backoffMs / 2);
  if (backoffMs < BACKOFF_BASE_MS) {
    backoffMs = 0;
    console.info('[vault] brake released — request succeeded.');
  } else {
    console.info(`[vault] brake decaying — request succeeded (a new 429 would pause ~${Math.round(Math.min(backoffMs * 2, BACKOFF_MAX_MS) / 1000)}s).`);
  }
}

/** Test seam. */
export function __resetVaultBrakeForTests() {
  backoffMs = 0;
  backoffUntil = 0;
}
