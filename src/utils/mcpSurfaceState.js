// Visibility and dot state for the §6.5 MCP bolt surfaces (tray popup,
// desktop settings cluster, mobile Sync row), extracted pure so the state
// table is unit-tested and mutation-verified.
//
// THE TABLE:
//   bound, writes auto-disabled            → visible, red    (the §4.3 alarm)
//   bound, undoable writes exist           → visible, blue
//   bound, otherwise                       → visible, green
//   unbound, undoable writes exist         → visible, AMBER  (see below)
//   unbound, journal empty                 → hidden
//
// THE AMBER STATE exists because the kill switch is most likely used BECAUSE
// an agent misbehaved — exactly when bulk undo is needed. Hiding the bolt the
// instant the listener unbinds made undo unreachable until MCP was re-enabled
// in Settings: backwards. §6.5 requires a bound listener to be VISIBLE, not
// an unbound one to be invisible, so the bolt stays while undoable entries
// remain, in a state that cannot be read as "enabled" (amber, not green or
// blue), and disappears once the journal empties — by undo or by restart
// (the journal is session-scoped).
//
// showKillSwitch is false whenever unbound: there is nothing to kill.

export function mcpSurfaceState({ bound, writesAutoDisabled, journalTotal }) {
  const hasUndoable = journalTotal > 0;
  if (!bound) {
    return hasUndoable
      ? { visible: true, dot: 'amber', showKillSwitch: false }
      : { visible: false, dot: null, showKillSwitch: false };
  }
  return {
    visible: true,
    dot: writesAutoDisabled ? 'red' : hasUndoable ? 'blue' : 'green',
    showKillSwitch: true,
  };
}
