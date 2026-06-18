// Push-on-write bridge for the GLANCEvault DB transport (mirrors lastGLANCE
// src/sync/dirtyTracker.ts, including the post-48h-test debounce fix).
//
// It schedules a debounced vault sync after local writes so a change uploads
// promptly instead of waiting for a cadence trigger (load / focus / interval) —
// the bug the lastGLANCE fix addressed, where edits on a backgrounded device sat
// unsynced until the app was reopened.
//
// VAULT-ONLY by design (spec 6.5): this never pushes to WebDAV. The file tier
// keeps its cadence model, which is deliberate given its full-payload upload
// cost. dayGLANCE does not fan push-on-write out to WebDAV.
//
// Off-safe: every function is a no-op when no DB engine is registered (vault
// disabled), so it is safe to call unconditionally from the app's write path.

// Wait this long after the last write before pushing, so a burst of writes
// collapses into one sync.
const PUSH_DEBOUNCE_MS = 3000;

let dbEngine = null;
let pushTimer = null;

function cancelScheduledPush() {
  if (pushTimer != null) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

// Debounced vault sync. Each call resets the timer; the cycle runs once writes
// settle. dbSyncCycle has its own in-flight guard, so this never overlaps a
// cadence-triggered cycle.
export function schedulePush() {
  if (!dbEngine) return;
  cancelScheduledPush();
  pushTimer = setTimeout(() => {
    pushTimer = null;
    dbEngine?.dbSyncCycle().catch(() => { /* surfaced via the engine onError */ });
  }, PUSH_DEBOUNCE_MS);
}

// Wire the active DB engine on startup / config change, or null to detach it
// (vault disabled). Detaching also cancels any pending push.
export function registerDbEngine(engine) {
  cancelScheduledPush();
  dbEngine = engine;
}

// Mark an entity changed and schedule a debounced push. dayGLANCE computes the
// actual dirty set by diffing at cycle time (see dbEngine.createDbEngine), so the
// engine.markDirty call is a best-effort hint; the debounced schedule is the part
// that matters for prompt upload. Safe (no-op) when the vault is off.
export function markDirty(entityId) {
  if (!dbEngine) return;
  if (entityId != null && typeof dbEngine.markDirty === 'function') dbEngine.markDirty(String(entityId));
  schedulePush();
}

// Deletions resolve by absence (getLocalEntity returns null → soft-delete). The
// engine exposes no dedicated delete call, so this reuses the dirty path; kept as
// a named helper to document intent at delete sites.
export function markDeleted(entityId) {
  markDirty(entityId);
}
