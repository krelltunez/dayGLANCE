import React, { useEffect, useState } from 'react';
import { Link2, Loader } from 'lucide-react';
import { readVaultHeartbeat } from '../obsidian.js';
import { obsidianHeartbeatState } from '../utils/obsidianHeartbeat.js';
import { startBridgePairing, cancelBridgePairing } from '../utils/obsidianBridgePairing.js';
import { getBridgePairingMeta } from '../utils/obsidianBridgeStream.js';
import { useTranslation } from 'react-i18next';

// Bridge-plugin pairing (Obsidian build-out Phase 6, spec §3.2/§3.4): mints
// the dead-drop offer and shows the one-time code the user types into
// Obsidian. Shown only in the FSA-connected branch — pairing is initiated
// from a device with direct vault access, because the dead-drop is a file.
//
// The status line does its OWN heartbeat read (polled while the panel is
// open) rather than consuming useObsidianSync's per-cycle snapshot: pairing
// confirmation should show up when the plugin starts beating `paired`, not
// up to a sync cycle later. Same reasoning as the launch-suppression
// readers — freshness checks happen where the answer needs to be current.
const BridgePairingPanel = ({ vaultHandleRef, darkMode, textPrimary, textSecondary, borderClass }) => {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const [code, setCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [hb, setHb] = useState({ obsidianRunning: false, pluginAuthoritative: false });
  // Days since pairing, from the discovered meta:pairing row — feeds the
  // §6 Phase 6 mode indicator ("Bridge plugin active (paired N days ago).
  // Direct vault access disabled."), which is what makes the arbitration
  // flip legible: without it the first symptom of plugin mode is the vault
  // folder picker apparently no longer mattering. null = unknown.
  const [pairedDays, setPairedDays] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      const handle = vaultHandleRef?.current;
      if (!handle || handle === 'native') return;
      try {
        const state = obsidianHeartbeatState(await readVaultHeartbeat(handle));
        if (cancelled) return;
        setHb(state);
        // The plugin deletes the offer once it stores the credentials, so a
        // paired heartbeat means the displayed code has served its purpose.
        if (state.pluginAuthoritative) {
          setCode((prev) => (prev ? null : prev));
          const meta = await getBridgePairingMeta();
          if (cancelled) return;
          const t = meta?.pairedAt ? Date.parse(meta.pairedAt) : NaN;
          setPairedDays(Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null);
        }
      } catch { /* a liveness probe must never break the settings UI */ }
    };
    probe();
    const id = setInterval(probe, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [vaultHandleRef]);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await startBridgePairing(vaultHandleRef?.current, token);
      setCode(result.code);
      setToken('');
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    await cancelBridgePairing(vaultHandleRef?.current);
    setCode(null);
  };

  return (
    <div className={`border ${borderClass} rounded-lg p-3 space-y-2`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${textPrimary}`}>
        <Link2 size={14} className={textSecondary} />
        {t('settings.obsidianBridgeTitle')}
      </div>
      <p className={`text-xs ${hb.pluginAuthoritative ? 'text-green-500' : textSecondary}`}>
        {hb.pluginAuthoritative
          ? (pairedDays === null
            ? t('settings.obsidianBridgeActiveModeUnknown')
            : pairedDays === 0
              ? t('settings.obsidianBridgeActiveModeToday')
              : t('settings.obsidianBridgeActiveMode', { days: pairedDays }))
          : hb.obsidianRunning
            ? t('settings.obsidianBridgeRunning')
            : t('settings.obsidianBridgeNotDetected')}
      </p>
      {code ? (
        <div className="space-y-2">
          <div className={`text-xl font-mono tracking-widest text-center py-2 rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-stone-100 text-stone-900'}`}>
            {code}
          </div>
          <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianBridgeCodeHint')}</p>
          <button
            onClick={cancel}
            className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
          >
            {t('settings.obsidianBridgeCancel')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianBridgeHint')}</p>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianBridgeToken')}</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianBridgeTokenHint')}</p>
          </div>
          <button
            onClick={start}
            disabled={busy}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {busy && <Loader size={14} className="animate-spin" />}
            {t('settings.obsidianBridgeStart')}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
};

export default BridgePairingPanel;
