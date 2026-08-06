import React, { useState } from 'react';
import { AlertTriangle, Loader, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { isAvailable as isICloudAvailable } from '../intents/icloudFileTransport.js';
import { resetAppData, reloadAfterReset } from '../utils/resetAppData.js';

/**
 * "Reset app data" — the way back to an empty app.
 *
 * Deleting the iOS app does not do this: the iCloud snapshot lives outside the
 * app sandbox and survives an uninstall, so a reinstall reads it straight back
 * (see utils/resetAppData.js for the full story — including why that happens
 * even with the app's iCloud toggle off). Hence the scope choice — clearing this
 * device is not the same as clearing the copy in iCloud, and where that file
 * exists only the second one actually sticks.
 *
 * Destructive and irreversible, so it is deliberately three deliberate taps:
 * open → choose scope → confirm. Rendered in both the mobile settings Backups
 * view and the desktop backup menu.
 */
const ResetAppDataSection = ({ darkMode, textPrimary, textSecondary, onExportBackup }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // 'device' | 'everywhere' — 'device' is the safer default, so a mis-tap on a
  // synced setup cannot silently wipe the other devices too.
  const [scope, setScope] = useState('device');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState(null);

  // The cloud option is meaningless where there is no iCloud transport
  // (Android, web, non-Mac Electron) — hide it rather than offer a no-op.
  const cloudAvailable = isICloudAvailable();

  const runReset = async () => {
    setBusy(true);
    setErrors(null);
    const result = await resetAppData({ scope });
    if (result.errors.length) {
      // Local data is already gone at this point; surface what could not be
      // cleared so the user knows the cloud copy may still restore itself,
      // rather than reloading into an app that silently refills.
      setErrors(result.errors);
      setBusy(false);
      return;
    }
    reloadAfterReset();
  };

  const rowBg = darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200';

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className={`w-full px-4 py-3 ${rowBg} rounded-lg text-left transition-colors`}
      >
        <div className="font-medium flex items-center gap-2 text-red-600 dark:text-red-400">
          <Trash2 size={16} />
          {t('reset.title')}
        </div>
        <div className={`text-sm ${textSecondary}`}>{t('reset.subtitle')}</div>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-red-300 dark:border-red-900/60 bg-red-50 dark:bg-red-900/10 p-4 space-y-3">
      <div className="flex items-center gap-2 font-medium text-red-700 dark:text-red-400">
        <AlertTriangle size={16} />
        {t('reset.title')}
      </div>

      <p className={`text-sm ${textSecondary}`}>{t('reset.warning')}</p>

      {onExportBackup && (
        <button
          onClick={onExportBackup}
          disabled={busy}
          className={`text-sm underline ${textPrimary} disabled:opacity-50`}
        >
          {t('reset.exportFirst')}
        </button>
      )}

      {cloudAvailable && (
        <div className="space-y-2">
          <label className={`flex items-start gap-2 text-sm ${textPrimary} cursor-pointer`}>
            <input
              type="radio"
              name="dg-reset-scope"
              className="mt-1"
              checked={scope === 'device'}
              onChange={() => setScope('device')}
              disabled={busy}
            />
            <span>
              <span className="font-medium">{t('reset.scopeDevice')}</span>
              <span className={`block ${textSecondary}`}>{t('reset.scopeDeviceHint')}</span>
            </span>
          </label>
          <label className={`flex items-start gap-2 text-sm ${textPrimary} cursor-pointer`}>
            <input
              type="radio"
              name="dg-reset-scope"
              className="mt-1"
              checked={scope === 'everywhere'}
              onChange={() => setScope('everywhere')}
              disabled={busy}
            />
            <span>
              <span className="font-medium">{t('reset.scopeEverywhere')}</span>
              <span className={`block ${textSecondary}`}>{t('reset.scopeEverywhereHint')}</span>
            </span>
          </label>
        </div>
      )}

      {errors && (
        <div className="text-sm text-red-700 dark:text-red-400 space-y-1">
          <div className="font-medium">{t('reset.partialFailure')}</div>
          <ul className="list-disc pl-5">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={runReset}
          disabled={busy}
          className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {busy && <Loader size={14} className="animate-spin" />}
          {busy ? t('reset.working') : t('reset.confirm')}
        </button>
        <button
          onClick={() => { setExpanded(false); setErrors(null); }}
          disabled={busy}
          className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} transition-colors disabled:opacity-60`}
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
};

export default ResetAppDataSection;
