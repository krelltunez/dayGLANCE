// Settings: the Sync topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React from 'react';
import { Cloud } from 'lucide-react';
import CloudSyncSettingsForm from '../../CloudSyncSettingsForm.jsx';
import ICloudDiagnostics from '../../ICloudDiagnostics.jsx';
import ICloudSyncToggle from '../../ICloudSyncToggle.jsx';
import DirectAccessSyncCard from '../../DirectAccessSyncCard.jsx';
import { isDirectAccessSupported } from '../../../sync/directAccessTransport.js';
import { cloudSyncProviders } from '../../../utils/cloudSyncProviders.js';
import { isAvailable as isICloudAvailable } from '../../../intents/icloudFileTransport.js';
import { useDayPlannerCtx } from '../../../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../../../context/SyncContext.jsx';

export default function useSyncTopic() {
  const {
    darkMode, borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();
  const {
    cloudSyncConfig, setCloudSyncConfig, cloudSyncTest, cloudSyncLastSynced,
    cloudSyncStatus, cloudSyncError, cloudSyncNow, vaultSyncNow,
    cloudSyncRemoteUnreadable, cloudSyncReplaceRemote,
    vaultBootstrapSync, vaultStatus, vaultError, vaultLastSynced, vaultSkipped,
    setSyncKeyReady, vaultEnabled,
  } = useSyncCtx();
  const currentProvider = cloudSyncConfig?.provider || 'nextcloud';
  const provider = cloudSyncProviders[currentProvider];

  // A failed sync marks the Sync topic red, in the dialog's list and on the
  // phone's row: the channel in use is WebDAV when it is on, else GLANCEvault.
  const syncStatus = cloudSyncConfig?.enabled ? cloudSyncStatus : vaultEnabled ? vaultStatus : null;

  return {
    cloudSync: {
      show: true,
      attention: syncStatus === 'error' ? 'red' : null,
      node: (
        <>
            {/* Cloud Sync Section */}
            <div className="space-y-3">
              {/* The page is the section now (docs/settings-redesign.md): no
                  heading of its own, and each channel is a card with its own
                  switch and status. */}
              {(<>
              <CloudSyncSettingsForm
                darkMode={darkMode}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                borderClass={borderClass}
                hoverBg={hoverBg}
                cloudSyncConfig={cloudSyncConfig}
                setCloudSyncConfig={setCloudSyncConfig}
                cloudSyncTest={cloudSyncTest}
                provider={provider}
                currentProvider={currentProvider}
                cloudSyncLastSynced={cloudSyncLastSynced}
                cloudSyncStatus={cloudSyncStatus}
                cloudSyncError={cloudSyncError}
                cloudSyncRemoteUnreadable={cloudSyncRemoteUnreadable}
                cloudSyncReplaceRemote={cloudSyncReplaceRemote}
                cloudSyncNow={cloudSyncNow}
                vaultSyncNow={vaultSyncNow}
                vaultBootstrapSync={vaultBootstrapSync}
                vaultStatus={vaultStatus}
                vaultError={vaultError}
                vaultLastSynced={vaultLastSynced}
                vaultSkipped={vaultSkipped}
                onSyncKeyReady={(ready) => setSyncKeyReady(ready)}
                afterChannels={(
                  <>
                  {/* Desktop only — the Electron main process holds the folder
                      (docs/direct-access-sync.md). */}
                  {isDirectAccessSupported() && (
                    <DirectAccessSyncCard
                      darkMode={darkMode}
                      textPrimary={textPrimary}
                      textSecondary={textSecondary}
                      borderClass={borderClass}
                    />
                  )}
                  </>
                )}
                // iCloud follows the network proxy: the proxy is about the
                // channels above it, iCloud is a channel of its own.
                afterProxy={(
                  <>
                  {/* Apple platforms only — on Android/web every probe reports
                      unsupported, so the panel would be an empty box. */}
                  {isICloudAvailable() && (
                    <ICloudSyncToggle
                      darkMode={darkMode}
                      textPrimary={textPrimary}
                      textSecondary={textSecondary}
                      borderClass={borderClass}
                    />
                  )}
                  </>
                )}
              />
              {/* Last: read-only, and about every transport above. */}
              {/* On every platform: the panel reports GLANCEvault and WebDAV
                  everywhere, the iCloud container on Apple platforms, and the
                  Direct Access folder wherever the bridge exists, each block
                  only where its transport is (docs/direct-access-sync.md). */}
              <ICloudDiagnostics
                darkMode={darkMode}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                borderClass={borderClass}
              />
              </>)}
            </div>
        </>
      ),
    },
  };
}
