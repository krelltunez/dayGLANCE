import { useEffect, useState } from 'react';
import { Power, Undo2, Zap } from 'lucide-react';

// The §6.5 MCP surface, restructured as an ambient bolt button + inline
// expansion (replacing the tray popup's persistent two-row banner and the
// macOS menu-bar glyph). Three hosts mount the same pieces:
//
//   - DesktopHeader's settings cluster — the CANONICAL surface: createTray()
//     is darwin-gated, so on Windows and Linux this is the only ambient
//     indication that a listener is bound, and the only reachable kill
//     switch and bulk undo outside Settings.
//   - TrayHeader's input row (macOS tray popup) — a convenience mirror.
//   - MobileLayout's timeline header — the same app renders MobileLayout in
//     narrow Electron windows (innerWidth < 721), not just on Capacitor, so
//     the canonical surface needs this narrow-viewport variant.
//
// VISIBILITY IS THE SIGNAL: the bolt renders only while the listener is
// bound. Its dot follows the settings-cluster convention (the same
// absolutely-positioned bordered span the cloud/book/refresh buttons use,
// colored from live feature state): green = enabled, no undoable writes;
// blue = undoable MCP writes exist; red = writes auto-disabled after
// repeated rate-limit violations (§4.3).
//
// Presentation only: everything behind it (journal store, applyUndoOps, IPC
// handlers, tier mapping) is untouched. Hosts own the expanded state so the
// panel can sit OUTSIDE the button's flex row (inline push-down, never a
// popover) and so each surface opens collapsed.

/** Live MCP state for one host: snapshot + journal over the existing IPC pushes. */
export function useMcpStatus() {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [snapshot, setSnapshot] = useState(null);
  const [journal, setJournal] = useState({ total: 0, entries: [] });

  useEffect(() => {
    if (!api?.localIntegrations) return undefined;
    let mounted = true;
    api.localIntegrations.get().then((s) => { if (mounted) setSnapshot(s); });
    api.mcpJournal?.get().then((j) => { if (mounted && j) setJournal(j); });
    const offStatus = api.localIntegrations.onStatus((s) => setSnapshot(s));
    const offJournal = api.mcpJournal?.onChanged((j) => setJournal(j));
    return () => { mounted = false; offStatus?.(); offJournal?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const gates = snapshot?.gates;
  const enabled = !!gates?.bound;
  const writesAutoDisabled = !!snapshot?.status?.mcp?.writesAutoDisabled;
  const dot = writesAutoDisabled ? 'red' : journal.total > 0 ? 'blue' : 'green';
  const tier = !enabled ? 'MCP server off'
    : gates.includeWrites
      ? (gates.includeNative ? 'Reads incl. device calendar + writes' : 'Reads dayGLANCE data + writes')
      : (gates.includeNative ? 'Reads incl. device calendar' : 'Reads dayGLANCE data');

  return { api, snapshot, journal, enabled, writesAutoDisabled, dot, tier };
}

const DOT_CLASS = { green: 'bg-green-500', blue: 'bg-blue-500', red: 'bg-red-500' };

/**
 * The bolt. Null while the listener is unbound — an absent bolt IS the
 * "nothing is listening" state. `variant` matches the host row's own button
 * styling so the addition never reflows it.
 */
export function McpBoltButton({ mcp, darkMode, open, onToggle, variant }) {
  if (!mcp.enabled) return null;

  const dotBorder = darkMode ? 'border-gray-800' : 'border-white';
  const cls = variant === 'cluster'
    ? `relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-stone-300'}`
    : `relative flex-shrink-0 p-2 rounded-lg transition-opacity hover:opacity-70 ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-500'}`;

  return (
    <button
      onClick={onToggle}
      className={cls}
      title={`MCP server on — ${mcp.tier}${mcp.journal.total > 0 ? ` · ${mcp.journal.total} undoable change${mcp.journal.total === 1 ? '' : 's'}` : ''}${mcp.writesAutoDisabled ? ' · writes auto-disabled' : ''}`}
      aria-expanded={open}
      aria-label="MCP server status"
    >
      <Zap size={variant === 'cluster' ? 18 : 16} className={variant === 'cluster' ? (darkMode ? 'text-gray-300' : 'text-stone-600') : undefined} />
      <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${dotBorder} ${DOT_CLASS[mcp.dot]}`} />
    </button>
  );
}

/**
 * The inline expansion: server status, tier, kill switch, journal count,
 * bulk undo. Hosts render it directly BELOW the row holding the bolt, so it
 * pushes content down. Renders null when collapsed or unbound (a kill switch
 * click collapses the whole surface with it).
 */
export function McpStatusPanel({ mcp, darkMode, open, borderClass }) {
  const [undoBusy, setUndoBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  if (!open || !mcp.enabled) return null;

  const textPrimary = darkMode ? 'text-gray-100' : 'text-stone-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-stone-500';
  const { status, ports } = mcp.snapshot;

  const serverLine = status.mcp.error
    ? status.mcp.error
    : status.mcp.running
      ? `Running on 127.0.0.1:${ports.mcpEffective}`
      : 'Starting…';

  const killSwitch = async () => {
    setNotice(null);
    const r = await mcp.api.localIntegrations.transition({ type: 'set-mcp-read-tier', tier: 'off' });
    if (!r?.ok) setNotice(r?.error || 'Could not turn the server off.');
  };

  const undoAll = async () => {
    setUndoBusy(true);
    setNotice(null);
    try {
      const r = await mcp.api.mcpJournal.undoAll();
      setNotice(r?.ok
        ? `Undid ${r.undone} change${r.undone === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} no longer applicable)` : ''}.`
        : (r?.error || 'Undo failed.'));
    } finally {
      setUndoBusy(false);
    }
  };

  return (
    <div className={`border-b ${borderClass} ${darkMode ? 'bg-amber-900/15' : 'bg-amber-50'} px-3 py-2 space-y-1.5`}>
      <div className={`text-xs font-semibold ${textPrimary}`}>MCP server on</div>
      <div className={`text-[11px] ${status.mcp.error ? 'text-red-500' : textSecondary}`}>{serverLine}</div>
      <div className={`text-[11px] ${textSecondary}`}>{mcp.tier}</div>
      {mcp.writesAutoDisabled && (
        <div className="text-[11px] text-red-500">
          Writes auto-disabled after repeated rate-limit violations. Restart dayGLANCE to re-enable.
        </div>
      )}
      <div className={`text-[11px] ${textSecondary}`}>
        {mcp.journal.total > 0
          ? `${mcp.journal.total} change${mcp.journal.total === 1 ? '' : 's'} by MCP this session`
          : 'No changes by MCP this session'}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={killSwitch}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${darkMode ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60' : 'bg-red-100 text-red-700 hover:bg-red-200'} transition-colors`}
          title="Turn the MCP server off. No apps will be able to connect until you re-enable it in Settings."
        >
          <Power size={12} />
          Turn off
        </button>
        {mcp.journal.total > 0 && (
          <button
            onClick={undoAll}
            disabled={undoBusy}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium disabled:opacity-50 ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'} transition-colors`}
            title="Reverse every change MCP clients made since dayGLANCE started (or since the last undo). Undone new tasks go to the recycle bin."
          >
            <Undo2 size={12} />
            {undoBusy ? 'Undoing…' : `Undo all (${mcp.journal.total})`}
          </button>
        )}
      </div>
      {notice && <p className={`text-[11px] ${textSecondary}`}>{notice}</p>}
    </div>
  );
}
