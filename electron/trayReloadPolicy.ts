// Tray reload debounce policy under MCP write load (spec §3.6), extracted as a
// pure function in the startupQuit.ts style.
//
// THE PROBLEM (§3.6, measured in Phase 3): the tray:data-changed handler is a
// true trailing debounce at 500 ms — it coalesces only events closer together
// than 500 ms. An agent writing at the §4.3 rate limit (30/minute = one write
// every 2 s) never coalesces: every write becomes a tray popup reload, 30
// reloads/minute for as long as the agent runs. The 4.1.2 cycle spent three
// PRs getting idle reloads from ~240/hour to near zero; this would be 1800/hour.
//
// THE §3.6-SANCTIONED FIX: a LONGER debounce on the MCP path specifically —
// never a bypass of the emit. While MCP writes are landing, the debounce
// stretches so the storm coalesces to nothing; the reload fires once, after
// the writes go quiet. User-originated saves keep the snappy 500 ms.

/** The historical tray debounce for user-originated saves. */
export const TRAY_RELOAD_DEBOUNCE_MS = 500;
/** Stretched debounce while an agent is writing: longer than the 2 s gap at the rate limit. */
export const TRAY_RELOAD_MCP_DEBOUNCE_MS = 5_000;
/** How recently an MCP write must have landed for the stretched debounce to apply. */
export const MCP_WRITE_RECENCY_MS = 10_000;

/**
 * Which debounce the tray:data-changed handler should arm.
 *
 * @param nowMs          current clock reading
 * @param lastMcpWriteAt clock reading of the last MCP-originated write, or
 *                       null if none has happened this session
 *
 * A backwards clock jump (lastMcpWriteAt in the future) still selects the
 * stretched debounce: the failure mode of one over-coalesced reload is
 * strictly better than a reload storm.
 */
export function trayReloadDebounceMs(nowMs: number, lastMcpWriteAt: number | null): number {
  if (lastMcpWriteAt === null) return TRAY_RELOAD_DEBOUNCE_MS;
  const age = nowMs - lastMcpWriteAt;
  if (age < MCP_WRITE_RECENCY_MS) return TRAY_RELOAD_MCP_DEBOUNCE_MS;
  return TRAY_RELOAD_DEBOUNCE_MS;
}
