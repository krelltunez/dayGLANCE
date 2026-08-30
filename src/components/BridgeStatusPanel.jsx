import React, { useEffect, useState } from 'react';
import { Link2 } from 'lucide-react';
import { readVaultHeartbeatNative } from '../obsidian.js';
import { obsidianHeartbeatState } from '../utils/obsidianHeartbeat.js';
import { getBridgePairingMeta } from '../utils/obsidianBridgeStream.js';
import { deriveBridgeStatus } from '../utils/bridgeStatus.js';
import { useTranslation } from 'react-i18next';

// Read-only bridge status for NATIVE devices (Android + iOS) — the §6 mode
// indicator the desktop pairing panel already carries, without the pairing
// form: pairing is a one-time desktop act (the dead-drop is a file the
// native bridge can't write) and the per-vault granularity ruling means it
// covers this device automatically. What this panel adds beyond a nicety is
// THE MIDDLE STATE (see utils/bridgeStatus.js — the 2026-08-31 field
// incident): a device whose plugin is running but unpaired has silently
// fallen back to direct mode, usually because Obsidian Sync's
// community-plugin-settings sync flipped off, and until this panel the only
// way to notice the fleet had mode-split was opening plugin settings on
// each device. Status inputs: the NATIVE heartbeat read (the same one the
// sync cycle's arbitration uses, so this panel and the cycle can't
// disagree) plus the vault's meta:pairing row over the network.
const BridgeStatusPanel = ({ darkMode, textPrimary, textSecondary, borderClass }) => {
  const { t } = useTranslation();
  const [hb, setHb] = useState({ obsidianRunning: false, pluginAuthoritative: false });
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const probe = async () => {
      try {
        const state = obsidianHeartbeatState(readVaultHeartbeatNative());
        if (cancelled) return;
        setHb(state);
        // The meta row answers "is the VAULT paired" — which splits the
        // unpaired-here state into lost-credentials versus never-paired.
        // Right after a state change the cache may hold a stale negative;
        // one forced refresh past the TTL keeps the indicator current
        // (same pattern as the desktop panel).
        const m = (await getBridgePairingMeta())
          ?? (await getBridgePairingMeta({ force: true }));
        if (!cancelled) setMeta(m ?? null);
      } catch { /* a liveness probe must never break the settings UI */ }
    };
    probe();
    const id = setInterval(probe, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const status = deriveBridgeStatus(hb, meta);

  return (
    <div className={`border ${borderClass} rounded-lg p-3 space-y-2`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${textPrimary}`}>
        <Link2 size={14} className={textSecondary} />
        {t('settings.obsidianBridgeTitle')}
      </div>
      {status.state === 'active' && (
        <p className="text-xs text-green-500">
          {status.pairedDays === null
            ? t('settings.obsidianBridgeActiveModeUnknown')
            : status.pairedDays === 0
              ? t('settings.obsidianBridgeActiveModeToday')
              : t('settings.obsidianBridgeActiveMode', { days: status.pairedDays })}
        </p>
      )}
      {status.state === 'unpairedHere' && (
        <>
          <p className="text-xs text-amber-500">{t('settings.obsidianBridgeUnpairedHere')}</p>
          {status.vaultPaired ? (
            <>
              <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianBridgeUnpairedVaultPaired')}</p>
              <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianBridgeUnpairedRemediation')}</p>
            </>
          ) : (
            <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianBridgeUnpairedVaultUnpaired')}</p>
          )}
        </>
      )}
      {status.state === 'notDetected' && (
        <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianBridgeNotDetected')}</p>
      )}
      <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianBridgePairedOnce')}</p>
    </div>
  );
};

export default BridgeStatusPanel;
