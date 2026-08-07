import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isICloudSyncEnabled, setICloudSyncEnabled } from '../utils/icloudSyncPref.js';

/**
 * On/off switch for this device's iCloud sync.
 *
 * Two reasons it exists rather than leaving iCloud purely zero-config:
 *
 *  1. It makes the first-run "start fresh on this device" choice reversible. That
 *     choice writes the same preference this reads, so a user who declined the
 *     restore has somewhere to change their mind.
 *  2. macOS has no alternative. electron/icloud.ts resolves the container by raw
 *     filesystem path and never registers with the iCloud daemon, so the Mac app
 *     never appears under "Apps syncing to iCloud Drive" and System Settings
 *     offers no way to stop it. This is the only off switch that platform has.
 *
 * Default stays ON: the preference is tri-state and absence means enabled, so
 * existing users are unaffected and zero-config still holds.
 *
 * Turning it off is inert, not destructive — the container copy stays where it is
 * and other devices keep syncing. Turning it back on resumes on the next cycle,
 * which will merge whatever the cloud copy now holds.
 */
const ICloudSyncToggle = ({ darkMode, textPrimary, textSecondary, borderClass }) => {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(() => isICloudSyncEnabled());

  const toggle = () => {
    const next = !enabled;
    setICloudSyncEnabled(next);
    setEnabled(next);
  };

  return (
    <div className={`rounded-lg border ${borderClass} p-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${textPrimary}`}>{t('icloudSync.title')}</p>
          <p className={`text-xs ${textSecondary}`}>
            {enabled ? t('icloudSync.onHint') : t('icloudSync.offHint')}
          </p>
        </div>
        <button
          type="button"
          onClick={toggle}
          role="switch"
          aria-checked={enabled}
          aria-label={t('icloudSync.title')}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
            enabled ? 'bg-green-500' : darkMode ? 'bg-gray-600' : 'bg-stone-300'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
              enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </div>
  );
};

export default ICloudSyncToggle;
