import React, { useEffect, useState } from 'react';
import { ChevronDown, Power, Undo2, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { isTrayMode } from '../utils/trayMode.js';

// §6.5 tray surface for the MCP listener: a distinct indicator while the
// server is bound, the current tier, the one-click kill switch, and the §4.3
// write journal with bulk undo. Renders ONLY in the tray popup (isTrayMode).
//
// Live, not snapshot: everything here arrives over IPC push
// (local-integrations:status / mcp-journal:changed), deliberately outside the
// popup's reload-on-data-change cycle — listener state changing while the
// popup is open updates in place.
//
// The tray is forbidden from persisting, and this component honors that by
// owning no state: the kill switch calls the main process's config transition
// directly (ipcMain.handle — NOT the tray:background-action relay, which
// silently drops without a main window), and undo asks the main process to
// replay the journal through the main window's store layer.

const TrayMcpStatus = () => {
  const { darkMode, borderClass, textPrimary, textSecondary } = useDayPlannerCtx();
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;

  const [snapshot, setSnapshot] = useState(null);
  const [journal, setJournal] = useState({ total: 0, entries: [] });
  const [expanded, setExpanded] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!isTrayMode || !api?.localIntegrations) return undefined;
    let mounted = true;
    api.localIntegrations.get().then((s) => { if (mounted) setSnapshot(s); });
    api.mcpJournal?.get().then((j) => { if (mounted && j) setJournal(j); });
    const offStatus = api.localIntegrations.onStatus((s) => setSnapshot(s));
    const offJournal = api.mcpJournal?.onChanged((j) => setJournal(j));
    return () => { mounted = false; offStatus?.(); offJournal?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isTrayMode || !api?.localIntegrations || !snapshot) return null;

  const { gates } = snapshot;
  // Visible while the listener is bound OR undoable session writes remain —
  // the kill switch must not take the undo path down with it.
  if (!gates.bound && journal.total === 0) return null;

  const tier = !gates.bound ? 'MCP server off'
    : gates.includeWrites
      ? (gates.includeNative ? 'Reads incl. device calendar + writes' : 'Reads dayGLANCE data + writes')
      : (gates.includeNative ? 'Reads incl. device calendar' : 'Reads dayGLANCE data');

  const killSwitch = async () => {
    setNotice(null);
    const r = await api.localIntegrations.transition({ type: 'set-mcp-read-tier', tier: 'off' });
    if (!r?.ok) setNotice(r?.error || 'Could not turn the server off.');
  };

  const undoAll = async () => {
    setUndoBusy(true);
    setNotice(null);
    try {
      const r = await api.mcpJournal.undoAll();
      setNotice(r?.ok
        ? `Undid ${r.undone} change${r.undone === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} no longer applicable)` : ''}.`
        : (r?.error || 'Undo failed.'));
    } finally {
      setUndoBusy(false);
    }
  };

  const fmtTime = (iso) => {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  };

  return (
    <div className={`flex-shrink-0 border-b ${borderClass} ${darkMode ? 'bg-amber-900/15' : 'bg-amber-50'} px-3 py-2 space-y-1.5`}>
      <div className="flex items-center gap-2">
        <Zap size={14} className={gates.bound ? 'text-amber-500' : textSecondary} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold ${textPrimary}`}>
            {gates.bound ? 'MCP server on' : 'MCP server off'}
          </div>
          <div className={`text-[11px] ${textSecondary} truncate`}>{tier}</div>
        </div>
        {gates.bound && (
          <button
            onClick={killSwitch}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium ${darkMode ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60' : 'bg-red-100 text-red-700 hover:bg-red-200'} transition-colors`}
            title="Turn the MCP server off. No apps will be able to connect until you re-enable it in Settings."
          >
            <Power size={12} />
            Turn off
          </button>
        )}
      </div>

      {journal.total > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded((v) => !v)}
              className={`flex items-center gap-1 text-[11px] ${textSecondary} hover:${textPrimary} transition-colors`}
            >
              <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
              {journal.total} change{journal.total === 1 ? '' : 's'} by MCP this session
            </button>
            <button
              onClick={undoAll}
              disabled={undoBusy}
              className={`ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium disabled:opacity-50 ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'} transition-colors`}
              title="Reverse every change MCP clients made since dayGLANCE started (or since the last undo)."
            >
              <Undo2 size={12} />
              {undoBusy ? 'Undoing…' : `Undo all (${journal.total})`}
            </button>
          </div>
          {expanded && (
            <ul className="max-h-32 overflow-y-auto space-y-0.5">
              {journal.entries.map((e) => (
                <li key={e.seq} className={`text-[11px] ${textSecondary} flex gap-1.5`}>
                  <span className="tabular-nums flex-shrink-0">{fmtTime(e.at)}</span>
                  <span className="truncate" title={`${e.tool}${e.idempotencyKey ? ` · key ${e.idempotencyKey}` : ''}`}>
                    {e.summary}
                  </span>
                </li>
              ))}
              {journal.total > journal.entries.length && (
                <li className={`text-[11px] ${textSecondary} italic`}>
                  …and {journal.total - journal.entries.length} earlier (all included in undo)
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {notice && <p className={`text-[11px] ${textSecondary}`}>{notice}</p>}
    </div>
  );
};

export default TrayMcpStatus;
