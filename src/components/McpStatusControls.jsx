import { useEffect, useState } from 'react';
import { Power, Undo2, X, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { mcpSurfaceState } from '../utils/mcpSurfaceState.js';

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

function formatMcpStatusError(t, message) {
  const text = String(message || '');
  if (!text || text === 'The change was refused.') return t('settings.localIntegrationsChangeRefused');
  if (text === 'MCP server could not start. See the startup log for details.') return t('settings.mcpServerStartFailed');

  const portInUse = text.match(/^MCP server could not start: port (\d+) is already in use by another process\./);
  if (portInUse) return t('settings.mcpPortInUse', { port: portInUse[1] });

  const portDenied = text.match(/^MCP server could not start: binding 127\.0\.0\.1:(\d+) was denied \(([^)]+)\)\./);
  if (portDenied) return t('settings.mcpPortPermissionDenied', { port: portDenied[1], error: portDenied[2] });

  const bindFailure = text.match(/^MCP server could not start on 127\.0\.0\.1:(\d+): (.+)$/);
  if (bindFailure) return t('settings.mcpServerBindFailed', { port: bindFailure[1], error: bindFailure[2] });

  return t('settings.localIntegrationsErrorWithDetails', { error: text });
}

/** Live MCP state for one host: snapshot + journal over the existing IPC pushes. */
export function useMcpStatus() {
  const { t } = useTranslation();
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const [snapshot, setSnapshot] = useState(null);
  const [journal, setJournal] = useState({ total: 0, entries: [], groups: [] });

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
  // The state table lives in src/utils/mcpSurfaceState.js, pure and
  // mutation-verified — including the AMBER state that keeps bulk undo
  // reachable after the kill switch while undoable entries remain.
  const surface = mcpSurfaceState({ bound: enabled, writesAutoDisabled, journalTotal: journal.total });
  const tier = !enabled ? t('settings.mcpStatusServerOff')
    : gates.includeWrites
      ? (gates.includeNative ? t('settings.mcpStatusTierCalendarWrites') : t('settings.mcpStatusTierDayglanceWrites'))
      : (gates.includeNative ? t('settings.mcpStatusTierCalendar') : t('settings.mcpStatusTierDayglance'));

  return {
    api, snapshot, journal, enabled, writesAutoDisabled, tier,
    visible: surface.visible, dot: surface.dot, showKillSwitch: surface.showKillSwitch,
  };
}

export const DOT_CLASS = { green: 'bg-green-500', blue: 'bg-blue-500', red: 'bg-red-500', amber: 'bg-amber-500' };

/**
 * The bolt. Null while there is nothing to show — no bound listener AND no
 * undoable session writes. While bound its dot is green/blue/red; after the
 * kill switch it stays AMBER while undoable entries remain, because the kill
 * switch is most likely used when an agent misbehaved, which is exactly when
 * undo is needed. It disappears once the journal empties (undo or restart).
 * `variant` matches the host row's own button styling so the addition never
 * reflows it.
 */
export function McpBoltButton({ mcp, darkMode, open, onToggle, variant }) {
  const { t } = useTranslation();
  if (!mcp.visible) return null;

  const dotBorder = darkMode ? 'border-gray-800' : 'border-white';
  const cls = variant === 'cluster'
    ? `relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-stone-300'}`
    : variant === 'glance-row'
      // The mobile GLANCE tab's utility row (search/filter/mic/bucket): its
      // buttons are self-stretch px-2.5 with the row's own token colors.
      ? `relative flex-shrink-0 px-2.5 self-stretch flex items-center rounded-lg transition-colors ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'}`
      : `relative flex-shrink-0 p-2 rounded-lg transition-opacity hover:opacity-70 ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-500'}`;

  const titleParts = [t(mcp.enabled ? 'settings.mcpStatusServerOn' : 'settings.mcpStatusServerOff')];
  if (mcp.enabled) titleParts.push(mcp.tier);
  if (mcp.journal.total > 0) {
    const undoableChanges = t('settings.mcpStatusUndoableChanges', { count: mcp.journal.total });
    titleParts.push(mcp.enabled
      ? undoableChanges
      : t('settings.mcpStatusChangesRemain', { changes: undoableChanges }));
  }
  if (mcp.writesAutoDisabled) titleParts.push(t('settings.mcpStatusWritesAutoDisabledShort'));

  return (
    <button
      onClick={onToggle}
      className={cls}
      title={titleParts.join(' · ')}
      aria-expanded={open}
      aria-label={t('settings.mcpStatusAriaLabel')}
    >
      <Zap size={variant === 'cluster' ? 18 : 16} className={variant === 'cluster' ? (darkMode ? 'text-gray-400' : 'text-stone-600') : undefined} />
      <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${dotBorder} ${DOT_CLASS[mcp.dot]}`} />
    </button>
  );
}

/**
 * Shared body: heading line handled by the host shape; here the status,
 * tier, journal count, the per-task journal list, actions, and notice. The
 * amber (server off, undoable entries remain) form shows a clear off
 * indication and NO kill switch — there is nothing to kill, and the undo
 * path must survive the kill switch.
 *
 * The journal renders grouped by task (snapshot `groups`, computed over the
 * full journal in the main process), each group with its own undo reversing
 * that task to its pre-MCP state; "Undo all" stays alongside — still the
 * right answer for a runaway loop. The list scrolls inside a max-height so
 * a long session cannot outgrow the 320px tray strip or the modals.
 */
function McpPanelBody({ mcp, darkMode, textScale = 'text-[11px]' }) {
  const { t } = useTranslation();
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoTaskBusy, setUndoTaskBusy] = useState(null); // groupKey mid-undo
  const [notice, setNotice] = useState(null);

  const textPrimary = darkMode ? 'text-gray-100' : 'text-stone-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-stone-500';
  const groupBorder = darkMode ? 'border-gray-700' : 'border-stone-200';
  const { status, ports } = mcp.snapshot;

  const serverLine = status.mcp.error
    ? formatMcpStatusError(t, status.mcp.error)
    : status.mcp.running
      ? t('settings.mcpStatusRunning', { port: ports.mcpEffective })
      : t('settings.mcpStatusStarting');

  const killSwitch = async () => {
    setNotice(null);
    const r = await mcp.api.localIntegrations.transition({ type: 'set-mcp-read-tier', tier: 'off' });
    if (!r?.ok) setNotice(r?.error ? formatMcpStatusError(t, r.error) : t('settings.mcpStatusTurnOffFailed'));
  };

  const undoAll = async () => {
    setUndoBusy(true);
    setNotice(null);
    try {
      const r = await mcp.api.mcpJournal.undoAll();
      setNotice(r?.ok
        ? t(r.skipped ? 'settings.mcpStatusUndoAllSuccessSkipped' : 'settings.mcpStatusUndoAllSuccess', {
          changes: t('settings.mcpStatusChangeCount', { count: r.undone }),
          skipped: r.skipped,
        })
        : (r?.error ? formatMcpStatusError(t, r.error) : t('settings.mcpStatusUndoFailed')));
    } finally {
      setUndoBusy(false);
    }
  };

  // Per-task undo (§4.3): every journal entry for one task, reversed back to
  // its pre-MCP state in the main process; other tasks' entries stay undoable.
  const undoTask = async (group) => {
    setUndoTaskBusy(group.key);
    setNotice(null);
    try {
      const r = await mcp.api.mcpJournal.undoTask(group.key);
      setNotice(r?.ok
        ? t(r.skipped ? 'settings.mcpStatusUndoTaskSuccessSkipped' : 'settings.mcpStatusUndoTaskSuccess', {
          changes: t('settings.mcpStatusChangeCount', { count: r.undone }),
          skipped: r.skipped,
          task: group.label,
        })
        : (r?.error ? formatMcpStatusError(t, r.error) : t('settings.mcpStatusUndoFailed')));
    } finally {
      setUndoTaskBusy(null);
    }
  };

  // The journal, grouped per task, newest activity first. Group counts come
  // from the FULL journal; the rows under each group come from the trimmed
  // display list (last 50), so a busy group notes how many rows are elided.
  const groups = mcp.journal.groups ?? [];
  const entriesByGroup = new Map();
  for (const e of mcp.journal.entries ?? []) {
    const list = entriesByGroup.get(e.groupKey);
    if (list) list.push(e);
    else entriesByGroup.set(e.groupKey, [e]);
  }

  return (<>
    {mcp.enabled ? (<>
      <div className={`${textScale} ${status.mcp.error ? 'text-red-500' : textSecondary}`}>{serverLine}</div>
      <div className={`${textScale} ${textSecondary}`}>{mcp.tier}</div>
      {mcp.writesAutoDisabled && (
        <div className={`${textScale} text-red-500`}>
          {t('settings.mcpStatusWritesAutoDisabled')}
        </div>
      )}
    </>) : (
      <div className={`${textScale} ${textSecondary}`}>
        {t('settings.mcpStatusOffUndoAvailable')}
      </div>
    )}
    <div className={`${textScale} ${textSecondary}`}>
      {mcp.journal.total > 0
        ? t('settings.mcpStatusSessionChanges', {
          changes: t('settings.mcpStatusChangeCount', { count: mcp.journal.total }),
        })
        : t('settings.mcpStatusSessionNoChanges')}
    </div>
    {groups.length > 0 && (
      <div className="max-h-44 overflow-y-auto space-y-1.5" data-testid="mcp-journal-list">
        {groups.map((group) => {
          const rows = entriesByGroup.get(group.key) ?? [];
          return (
            <div key={group.key} className={`rounded-lg border ${groupBorder} px-2 py-1.5 space-y-0.5`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`${textScale} font-medium ${textPrimary} truncate min-w-0`} title={group.label}>
                  {group.label}
                </span>
                <button
                  onClick={() => undoTask(group)}
                  disabled={undoTaskBusy !== null || undoBusy}
                  className={`flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded ${textScale} font-medium disabled:opacity-50 ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'} transition-colors`}
                  title={t('settings.mcpStatusUndoTaskTitle')}
                >
                  <Undo2 size={10} />
                  {undoTaskBusy === group.key
                    ? t('settings.mcpStatusUndoing')
                    : t(group.count > 1 ? 'settings.mcpStatusUndoWithCount' : 'settings.mcpStatusUndo', { count: group.count })}
                </button>
              </div>
              {rows.map((row) => (
                <div key={row.seq} className={`${textScale} ${textSecondary} truncate`} title={row.summary}>
                  {row.summary}
                </div>
              ))}
              {group.count > rows.length && (
                <div className={`${textScale} ${textSecondary} italic`}>
                  {t('settings.mcpStatusEarlierChangesHidden', {
                    changes: t('settings.mcpStatusChangeCount', { count: group.count - rows.length }),
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    )}
    <div className="flex items-center gap-2">
      {mcp.showKillSwitch && (
        <button
          onClick={killSwitch}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg ${textScale} font-medium ${darkMode ? 'bg-red-900/40 text-red-300 hover:bg-red-900/60' : 'bg-red-100 text-red-700 hover:bg-red-200'} transition-colors`}
          title={t('settings.mcpStatusTurnOffTitle')}
        >
          <Power size={12} />
          {t('settings.mcpStatusTurnOff')}
        </button>
      )}
      {mcp.journal.total > 0 && (
        <button
          onClick={undoAll}
          disabled={undoBusy || undoTaskBusy !== null}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg ${textScale} font-medium disabled:opacity-50 ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'} transition-colors`}
          title={t('settings.mcpStatusUndoAllTitle')}
        >
          <Undo2 size={12} />
          {undoBusy ? t('settings.mcpStatusUndoing') : t('settings.mcpStatusUndoAll', { count: mcp.journal.total })}
        </button>
      )}
    </div>
    {notice && <p className={`${textScale} ${textSecondary}`}>{notice}</p>}
  </>);
}

/**
 * Inline shapes: the tray bolt's expansion strip (default) and the mobile
 * Settings tab's Sync-section card (variant="card"). The DESKTOP surface uses
 * McpStatusModal instead — inline expansion below the 80px header bar pushed
 * the whole calendar down, which read as layout breakage; the app's idiom for
 * settings-cluster actions is a modal (backup, help).
 *
 * Renders null when the surface is hidden (unbound with an empty journal).
 */
export function McpStatusPanel({ mcp, darkMode, open, borderClass, variant, cardBg }) {
  const { t } = useTranslation();
  if (!mcp.visible) return null;
  if (variant !== 'card' && !open) return null;

  const textPrimary = darkMode ? 'text-gray-100' : 'text-stone-900';

  const container = variant === 'card'
    ? `${cardBg} border ${borderClass} rounded-xl p-3 space-y-1.5`
    : `border-b ${borderClass} ${darkMode ? 'bg-amber-900/15' : 'bg-amber-50'} px-3 py-2 space-y-1.5`;

  return (
    <div className={container}>
      <div className={`text-xs font-semibold ${textPrimary} flex items-center gap-1.5`}>
        {variant === 'card' && <Zap size={12} className="text-amber-500" />}
        {t(mcp.enabled ? 'settings.mcpStatusServerOn' : 'settings.mcpStatusServerOff')}
      </div>
      <McpPanelBody mcp={mcp} darkMode={darkMode} />
    </div>
  );
}

/**
 * The desktop surface: same content in the app's standard modal chrome
 * (backup/help pattern — dimmed backdrop, centered card, X or backdrop click
 * to close). Renders null when hidden, closing the surface with it.
 */
export function McpStatusModal({ mcp, darkMode, open, onClose, borderClass, cardBg }) {
  const { t } = useTranslation();
  if (!open || !mcp.visible) return null;

  const textPrimary = darkMode ? 'text-gray-100' : 'text-stone-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-stone-500';

  return (
    // Escape-close follows the DatePicker/DailyNotesModal backdrop idiom: the
    // backdrop takes focus on mount (tabIndex -1 + ref focus) so the keydown
    // lands here without a document-level listener, and bubbling still
    // delivers it when focus sits on a control inside the card.
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 outline-none"
      onClick={onClose}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      tabIndex={-1}
      ref={(el) => el && el.focus()}
    >
      <div
        className={`${cardBg} rounded-xl shadow-xl border ${borderClass} w-full max-w-sm mx-4 overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('settings.mcpStatusAriaLabel')}
      >
        <div className={`flex items-center justify-between px-5 py-4 border-b ${borderClass}`}>
          <div className={`font-semibold ${textPrimary} flex items-center gap-2`}>
            <Zap size={16} className="text-amber-500" />
            {t(mcp.enabled ? 'settings.mcpStatusServerOn' : 'settings.mcpStatusServerOff')}
          </div>
          <button onClick={onClose} className={`${textSecondary} hover:${textPrimary} transition-colors`} aria-label={t('common.close')}>
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-2">
          <McpPanelBody mcp={mcp} darkMode={darkMode} textScale="text-xs" />
        </div>
      </div>
    </div>
  );
}

