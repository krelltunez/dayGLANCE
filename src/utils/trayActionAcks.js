// Pending-acknowledgment bookkeeping for tray background actions, pure
// (trayFetchGate.js style) so the expiry rules are unit-tested and
// mutation-verified apart from the React wiring in TrayApp.jsx.
//
// Why this exists: the tray applies actions to its own state optimistically
// and relays them to the main window, and that relay used to be
// fire-and-forget. With no live main renderer (window closed on non-macOS,
// or a crashed renderer that the main process's live() check cannot see),
// the send vanished and the user's checkbox tick silently reverted on the
// next reload. Each action now carries an id; the main renderer acks after
// applying; silence past the timeout means the change did not land, and the
// tray reloads from storage with a visible notice instead of lying.
//
// The timeout errs long DELIBERATELY: the apply path goes through a React
// state update in the main window, slower than the MCP bridge's IPC ping,
// and a spurious "did not reach dayGLANCE" notice on a busy machine is worse
// than the bug this fixes.

export const ACK_TIMEOUT_MS = 3000;

/** Record a sent action. Returns a new list; entries are { id, at }. */
export function addPending(pending, id, now) {
  return [...(pending ?? []), { id, at: now }];
}

/** Settle an acknowledged action. Unknown ids are a no-op (late ack after expiry). */
export function resolvePending(pending, id) {
  return (pending ?? []).filter((p) => p.id !== id);
}

/**
 * Split the pending list into expired and still-waiting at `now`. An entry
 * expires once its age REACHES the timeout (>=, not >), so a sweep landing
 * exactly on the boundary fails closed rather than waiting another sweep.
 */
export function expirePending(pending, now, timeoutMs = ACK_TIMEOUT_MS) {
  const list = pending ?? [];
  return {
    expired: list.filter((p) => now - p.at >= timeoutMs).map((p) => p.id),
    remaining: list.filter((p) => now - p.at < timeoutMs),
  };
}
