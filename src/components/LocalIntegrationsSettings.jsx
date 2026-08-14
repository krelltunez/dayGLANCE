import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Copy, Plug, RefreshCw } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// Local integrations settings (docs/mcp-server-spec.md §6.2/§6.3/§6.4):
// the Stream Deck listener toggle and the MCP server's consent-tiered
// controls, shared between SettingsModal (desktop) and MobileSettingsPanel
// (narrow windows). Renders nothing outside Electron.
//
// The renderer holds NO authority here: every change is a typed transition
// action sent to the main process, whose consent-state machine
// (electron/localIntegrations.ts) accepts or refuses it. In particular the
// consentConfirmed flags are only ever set by the Accept button of the
// matching dialog below — there is no code path that enables MCP without one.

// ── §6.4 consent copy ────────────────────────────────────────────────────────
// Required content (base): other apps on this computer can read the data;
// those apps typically send it to an AI provider over the internet; dayGLANCE
// cannot see or control what they do; this falls outside dayGLANCE's
// encryption / no-server-access guarantees.
export const MCP_BASE_CONSENT = {
  title: 'Allow other apps to read your dayGLANCE data?',
  paragraphs: [
    'This lets other applications running on this computer, typically an AI assistant such as Claude Desktop, read your dayGLANCE data: your schedule, tasks, goals, and projects.',
    'AI assistants usually send what they read to their AI provider over the internet as part of your conversations. Once another app has read your data, dayGLANCE cannot see or control what it does with it.',
    'This is outside dayGLANCE’s encryption and no-server-access guarantees: dayGLANCE itself still never uploads your data anywhere, but an app you connect might.',
    'Only apps on this computer that present your access token (shown in settings after enabling) can connect.',
  ],
  accept: 'I understand, enable read access',
};

// Required content (device calendar tier): must additionally NAME what it
// exposes — event titles, attendees; other people's information the user did
// not create and those people did not consent to share.
export const MCP_CALENDAR_CONSENT = {
  title: 'Also share device calendar events?',
  paragraphs: [
    'This adds events from your device’s calendar accounts (work, school, shared family calendars) to what connected apps can read, not just data you created in dayGLANCE.',
    'Calendar events often contain other people’s information: event titles, attendee names and emails, and details of meetings other people invited you to. You did not create that information, and those people have not agreed to share it with an AI assistant or any other app.',
    'Connected apps can read these events exactly like your dayGLANCE data, and typically send them to an AI provider over the internet.',
    'Leave this off to share only the data you created in dayGLANCE yourself.',
  ],
  accept: 'I understand, include calendar events',
};

export const MCP_WRITES_CONSENT = {
  title: 'Allow connected apps to change your schedule?',
  paragraphs: [
    'Connected apps will be able to add, complete, move, and edit tasks (the same changes you can make yourself) without asking you before each one.',
    'Changes are rate-limited and can never touch device calendar events, but a misbehaving app could still rearrange or complete tasks you did not intend. You can turn this off at any time.',
  ],
  accept: 'I understand, allow changes',
};

const READ_TIER_OPTIONS = [
  {
    tier: 'off',
    label: 'Off',
    description: 'No MCP server runs and no port is opened.',
  },
  {
    tier: 'dayglance',
    label: 'dayGLANCE data only',
    description: 'Schedule, tasks, goals, and projects you created in dayGLANCE. Device calendar events are excluded.',
  },
  {
    tier: 'dayglance_calendar',
    label: 'Include device calendar events',
    description: 'Everything above, plus events from your device calendar accounts (marked read-only).',
  },
];

/**
 * variant:
 *  - default: a collapsible section for the desktop SettingsModal (hr +
 *    header button + chevron, per that modal's section idiom).
 *  - "page": bare content for the mobile Settings sub-view, which provides
 *    its own back header and title; always expanded, no hr, no section
 *    header. (Previously this component was mounted whole at the bottom of
 *    the mobile panel, stranding a desktop-shaped section in a page of row
 *    cards.)
 */
const LocalIntegrationsSettings = ({ variant }) => {
  const {
    collapsedSettings, toggleSettingsSection,
    darkMode, borderClass, textPrimary, textSecondary,
  } = useDayPlannerCtx();
  const isPage = variant === 'page';

  const api = typeof window !== 'undefined' ? window.electronAPI?.localIntegrations : undefined;
  const [snapshot, setSnapshot] = useState(null);
  // { copy, onAccept } — one dialog at a time; the calendar-from-off flow
  // chains base → calendar so each notice is accepted on its own.
  const [consent, setConsent] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [portDraft, setPortDraft] = useState(null); // null = not editing
  const [copied, setCopied] = useState(false);
  const [rotated, setRotated] = useState(false);
  // { ok, action, path, backupPath } | { ok:false, reason, path?, manualEntry } | null
  const [setupResult, setSetupResult] = useState(null);
  const [setupBusy, setSetupBusy] = useState(false);
  const copiedTimer = useRef(null);

  useEffect(() => {
    if (!api) return undefined;
    let mounted = true;
    api.get().then((s) => { if (mounted) setSnapshot(s); });
    const unsubscribe = api.onStatus((s) => setSnapshot(s));
    return () => {
      mounted = false;
      unsubscribe?.();
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!api || !snapshot) return null;

  const { config, status, ports } = snapshot;
  const readTier = config.mcp.readTier;
  const mcpOn = readTier !== 'off';

  const transition = async (action) => {
    setActionError(null);
    const result = await api.transition(action);
    if (result?.ok) {
      setSnapshot(result.snapshot);
      return true;
    }
    setActionError(result?.error || 'The change was refused.');
    return false;
  };

  const requestReadTier = (tier) => {
    setActionError(null);
    if (tier === readTier) return;
    // Downgrades (calendar → dayglance, anything → off) need no consent.
    if (tier === 'off' || (tier === 'dayglance' && readTier === 'dayglance_calendar')) {
      transition({ type: 'set-mcp-read-tier', tier });
      return;
    }
    if (readTier === 'off') {
      // Enabling from off always passes the base notice; the calendar tier
      // then additionally passes its own notice, one dialog after the other.
      setConsent({
        copy: MCP_BASE_CONSENT,
        onAccept: () => {
          if (tier === 'dayglance') {
            setConsent(null);
            transition({ type: 'set-mcp-read-tier', tier, consentConfirmed: true });
          } else {
            setConsent({
              copy: MCP_CALENDAR_CONSENT,
              onAccept: () => {
                setConsent(null);
                transition({
                  type: 'set-mcp-read-tier', tier,
                  consentConfirmed: true, calendarConsentConfirmed: true,
                });
              },
            });
          }
        },
      });
      return;
    }
    // Upgrade dayglance → dayglance_calendar: the calendar notice alone.
    setConsent({
      copy: MCP_CALENDAR_CONSENT,
      onAccept: () => {
        setConsent(null);
        transition({ type: 'set-mcp-read-tier', tier, calendarConsentConfirmed: true });
      },
    });
  };

  const requestWrites = (enabled) => {
    setActionError(null);
    if (!enabled) {
      transition({ type: 'set-mcp-writes', enabled: false });
      return;
    }
    setConsent({
      copy: MCP_WRITES_CONSENT,
      onAccept: () => {
        setConsent(null);
        transition({ type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true });
      },
    });
  };

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(config.mcp.token || '');
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denied — the token stays selectable in the input
    }
  };

  const rotateToken = async () => {
    setRotated(false);
    if (await transition({ type: 'rotate-token' })) setRotated(true);
  };

  const applyPort = async () => {
    const raw = (portDraft ?? '').trim();
    const okApplied = await transition({
      type: 'set-mcp-port',
      portOverride: raw === '' ? null : raw,
    });
    if (okApplied) setPortDraft(null);
  };

  const inputClass = `px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`;
  const smallBtn = `px-3 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors flex items-center gap-1.5`;

  const toggle = (checked, onChange, label, sub) => (
    <label className="flex items-center gap-3 cursor-pointer">
      <div className="relative flex-shrink-0">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
        <div className={`w-10 h-6 rounded-full transition-colors ${checked ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
          <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : 'translate-x-1'}`} />
        </div>
      </div>
      <span className={`text-sm ${textPrimary}`}>
        {label}
        {sub && <span className={`block text-xs ${textSecondary}`}>{sub}</span>}
      </span>
    </label>
  );

  const listenerError = (message) => (
    <div className={`p-3 rounded-lg border flex items-start gap-2 ${darkMode ? 'bg-red-900/20 border-red-800' : 'bg-red-50 border-red-200'}`}>
      <AlertTriangle size={14} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-red-400' : 'text-red-600'}`} />
      <p className={`text-xs ${darkMode ? 'text-red-300' : 'text-red-700'}`}>{message}</p>
    </div>
  );

  const anyEnabled = config.streamDeck.enabled || mcpOn;

  return (
    <>
      {!isPage && <hr className={borderClass} />}
      <div className="space-y-3">
        {!isPage && (
          <button onClick={() => toggleSettingsSection('localIntegrations')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
            <Plug size={16} className={textSecondary} />
            Local Integrations
            {anyEnabled && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
            <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.localIntegrations ? '' : 'rotate-180'}`} />
          </button>
        )}
        {(isPage || !collapsedSettings.localIntegrations) && (<>
          <p className={`${textSecondary} text-xs`}>
            Connections for other apps running on this computer. Both listen on 127.0.0.1 only and are never reachable from the network.
          </p>

          {/* Stream Deck (port 7892) — independent of the MCP server (§6.2) */}
          <div className="space-y-2">
            {toggle(
              config.streamDeck.enabled,
              (enabled) => transition({ type: 'set-stream-deck', enabled }),
              'Stream Deck support',
              `Lets the dayGLANCE Stream Deck plugin show and control your day (port ${ports.streamDeck}).`,
            )}
            {config.streamDeck.enabled && status.streamDeck.error && listenerError(status.streamDeck.error)}
          </div>

          {/* MCP server (port 7893 by default) */}
          <div className="space-y-2 pt-1">
            <h4 className={`text-sm font-medium ${textPrimary}`}>MCP server (AI assistants)</h4>
            <p className={`text-xs ${textSecondary}`}>
              Lets AI assistants on this computer read your schedule over the Model Context Protocol. What they can see is up to you:
            </p>
            <div className="space-y-1.5" role="radiogroup" aria-label="MCP read access">
              {READ_TIER_OPTIONS.map(({ tier, label, description }) => (
                <label key={tier} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mcp-read-tier"
                    checked={readTier === tier}
                    onChange={() => requestReadTier(tier)}
                    className="mt-0.5"
                  />
                  <span className={`text-sm ${textPrimary}`}>
                    {label}
                    <span className={`block text-xs ${textSecondary}`}>{description}</span>
                  </span>
                </label>
              ))}
            </div>

            {mcpOn && (<>
              {toggle(
                config.mcp.writesEnabled,
                requestWrites,
                'Allow schedule changes',
                'Separate opt-in: connected apps may add, complete, move, and edit tasks.',
              )}

              {/* Token — displayed for manual copy into the MCP client's config. */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Access token</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={config.mcp.token || ''}
                    onFocus={(e) => e.target.select()}
                    className={`${inputClass} flex-1 min-w-0 font-mono text-xs`}
                  />
                  <button onClick={copyToken} className={smallBtn} title="Copy token">
                    {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                  <button onClick={rotateToken} className={smallBtn} title="Generate a new token. The old one stops working immediately.">
                    <RefreshCw size={14} />
                    Rotate
                  </button>
                </div>
                <p className={`text-xs ${textSecondary} mt-1`}>
                  {rotated
                    ? 'New token generated. The old one no longer works, so update your MCP clients.'
                    : 'Paste this into your MCP client as the Bearer token. Rotating it cuts off every client using the old one.'}
                </p>
              </div>

              {/* Port override — §3.4: one fixed port, collisions surface loudly, never scanned around. */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Port</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder={String(ports.mcpDefault)}
                    value={portDraft ?? (config.mcp.portOverride ?? '')}
                    onChange={(e) => setPortDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && portDraft !== null) applyPort(); }}
                    className={`${inputClass} w-28`}
                  />
                  {portDraft !== null && (
                    <button onClick={applyPort} className={smallBtn}>Apply</button>
                  )}
                </div>
                <p className={`text-xs ${textSecondary} mt-1`}>
                  Endpoint: <code className={`px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}>http://127.0.0.1:{ports.mcpEffective ?? ports.mcpDefault}/mcp</code>
                  {'. '}Leave the port empty for the default. dayGLANCE never picks a different port by itself.
                </p>
              </div>

              {/* Claude Desktop setup. Direct-download macOS and Windows only:
                  the !__MAS_BUILD__ branch is dead-code-eliminated from the
                  MAS bundle at build time (§7; the main-process handler is
                  likewise excluded from MAS packaging), and Linux has no
                  Claude Desktop, plus an AppImage's mount path changes every
                  launch, so a written absolute path would go stale. */}
              {!__MAS_BUILD__ && ['darwin', 'win32'].includes(window.electronAPI?.platform) && (
                <div>
                  <button
                    onClick={async () => {
                      setSetupBusy(true);
                      setSetupResult(null);
                      try {
                        setSetupResult(await window.electronAPI.mcpSetupClaudeDesktop());
                      } finally {
                        setSetupBusy(false);
                      }
                    }}
                    disabled={setupBusy}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 ${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'} transition-colors`}
                    title="Adds a dayGLANCE entry to Claude Desktop's configuration, pointing at the bridge bundled with this app. Everything else in the file is preserved, and a backup is made first."
                  >
                    {setupBusy ? 'Setting up' : 'Set up Claude Desktop'}
                  </button>
                  {setupResult?.ok && (
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {setupResult.action === 'created'
                        ? 'Claude Desktop configuration created.'
                        : 'dayGLANCE entry added. Everything else in the file was preserved.'}
                      {setupResult.backupPath ? ' A backup of the previous file was saved next to it.' : ''}
                      {' '}Restart Claude Desktop to connect.
                    </p>
                  )}
                  {setupResult && !setupResult.ok && (
                    <div className={`text-xs ${textSecondary} mt-1 space-y-1`}>
                      <p className="text-amber-500">
                        {setupResult.reason === 'unparseable'
                          ? 'Your Claude Desktop configuration file could not be parsed, so dayGLANCE did not touch it. To finish setup by hand, fix or empty the file, or paste this entry into it:'
                          : 'The configuration could not be written automatically. To finish setup by hand, paste this entry into your Claude Desktop configuration file:'}
                      </p>
                      {setupResult.path && <p className="font-mono break-all">{setupResult.path}</p>}
                      {setupResult.manualEntry && (
                        <pre className={`p-2 rounded overflow-x-auto ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}>{setupResult.manualEntry}</pre>
                      )}
                    </div>
                  )}
                </div>
              )}
              {__MAS_BUILD__ && (
                <p className={`text-xs ${textSecondary}`}>
                  To connect Claude Desktop or other MCP apps, see the{' '}
                  <a
                    href="https://glance-apps.com/dayglance/mcp"
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-500 hover:underline"
                  >
                    setup guide
                  </a>
                  . You will paste the access token above into your MCP client.
                </p>
              )}

              {status.mcp.running && (
                <p className="text-xs text-green-500">MCP server running on 127.0.0.1:{ports.mcpEffective}.</p>
              )}
              {status.mcp.error && listenerError(status.mcp.error)}
            </>)}
          </div>

          {actionError && listenerError(actionError)}
        </>)}
      </div>

      {/* §6.4 consent dialog — the ONLY source of consentConfirmed flags. */}
      {consent && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => setConsent(null)}>
          <div
            className={`w-full max-w-md rounded-xl border ${borderClass} ${darkMode ? 'bg-gray-800' : 'bg-white'} p-5 space-y-3 shadow-xl`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={consent.copy.title}
          >
            <h4 className={`font-semibold ${textPrimary}`}>{consent.copy.title}</h4>
            {consent.copy.paragraphs.map((text, i) => (
              <p key={i} className={`text-sm ${textSecondary}`}>{text}</p>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setConsent(null)}
                className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
              >
                Cancel
              </button>
              <button
                onClick={consent.onAccept}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                {consent.copy.accept}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default LocalIntegrationsSettings;
