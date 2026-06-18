import React, { useState } from 'react';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { setupEncryptionKey, setSyncPassphrase, clearEncryptionKey } from '../utils/crypto.js';
import { getVaultConfig, setVaultConfig } from '../sync/vaultConfig.js';
import { useTranslation } from 'react-i18next';

// Cloud sync settings form (extracted to avoid hooks-in-conditional issues)
const CloudSyncSettingsForm = ({ darkMode, textPrimary, textSecondary, borderClass, hoverBg, cloudSyncConfig, setCloudSyncConfig, cloudSyncTest, provider, currentProvider, onClose, cloudSyncLastSynced, cloudSyncStatus, cloudSyncError, onSyncKeyReady }) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState(() => {
    const initial = {
      provider: currentProvider,
      syncFolder: cloudSyncConfig?.syncFolder ?? 'GLANCE/dayglance',
    };
    // Populate fields from all providers so switching preserves filled values
    Object.values(cloudSyncProviders).forEach(p => {
      p.configFields.forEach(f => { initial[f.key] = cloudSyncConfig?.[f.key] || ''; });
    });
    return initial;
  });
  const [encryptionEnabled, setEncryptionEnabled] = useState(cloudSyncConfig?.encryptionEnabled ?? false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [migrationOldPath] = useState(() => localStorage.getItem('dayglance-sync-migration-old-path'));

  // GLANCEvault (DB transport) — independent of the WebDAV provider above. Runs
  // ALONGSIDE WebDAV; your WebDAV data is never modified. Saved to its own
  // localStorage key; toggling it requires a reload so the engines reconstruct.
  const [vaultOriginal] = useState(() => getVaultConfig());
  const [vaultEnabled, setVaultEnabled] = useState(() => !!vaultOriginal?.enabled);
  const [vaultUrl, setVaultUrl] = useState(() => vaultOriginal?.vaultUrl || '');
  const [vaultToken, setVaultToken] = useState(() => vaultOriginal?.vaultToken || '');
  const [vaultAccountId, setVaultAccountId] = useState(() => vaultOriginal?.accountId || '');

  const activeProvider = cloudSyncProviders[formData.provider] || provider;
  const requiredFieldsFilled = activeProvider.configFields.every(f => formData[f.key]) && !!formData.syncFolder;

  // When enabling encryption, require a passphrase (confirmed) on fresh enable.
  // When already enabled, allow saving without re-entering (passphrase field is optional).
  const alreadyEncrypted = cloudSyncConfig?.encryptionEnabled;
  const passphraseRequired = encryptionEnabled && !alreadyEncrypted;
  const passphraseMismatch = passphraseRequired && passphraseConfirm && passphrase !== passphraseConfirm;
  const passphraseValid = !passphraseRequired || (passphrase.length > 0 && passphrase === passphraseConfirm);
  const canSave = requiredFieldsFilled && passphraseValid && !passphraseMismatch;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await cloudSyncTest({ ...formData, provider: formData.provider });
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async () => {
    const newConfig = { ...formData, provider: formData.provider, enabled: true, encryptionEnabled };

    if (encryptionEnabled) {
      if (passphraseRequired && passphrase) {
        // First-time setup: generate salt + derive + cache key.
        await setupEncryptionKey(passphrase);
      } else if (!alreadyEncrypted && passphrase) {
        // Re-entering passphrase on existing encrypted setup (new device via settings form).
        setSyncPassphrase(passphrase);
      }
      // If alreadyEncrypted and no passphrase entered, leave session key as-is.
    } else if (alreadyEncrypted) {
      // User disabled encryption.
      await clearEncryptionKey();
    }

    setCloudSyncConfig(newConfig);
    onSyncKeyReady?.(encryptionEnabled);

    // GLANCEvault is saved/cleared independently of the file engine. Only stored
    // when the toggle is on; cleared (reverting to file-only) when off.
    const nextVault = vaultEnabled
      ? { enabled: true, vaultUrl: vaultUrl.trim(), vaultToken: vaultToken.trim(), accountId: vaultAccountId.trim() }
      : null;
    const vaultChanged = JSON.stringify(nextVault) !== JSON.stringify(vaultOriginal || null);
    setVaultConfig(nextVault);

    // A vault change requires a reload so the DB engine is (re)constructed with
    // the new transport config on next mount (mirrors lastGLANCE).
    if (vaultChanged) { window.location.reload(); return; }
    onClose();
  };

  const handleDisable = () => {
    setCloudSyncConfig({ ...cloudSyncConfig, enabled: false });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Provider</label>
        <select
          value={formData.provider}
          onChange={(e) => setFormData(prev => ({ ...prev, provider: e.target.value }))}
          className={`w-full px-3 py-2 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-stone-100 text-stone-900'}`}
        >
          {Object.entries(cloudSyncProviders).map(([key, p]) => (
            <option key={key} value={key}>{p.name}</option>
          ))}
        </select>
      </div>

      {activeProvider.configFields.map(field => (
        <div key={field.key}>
          <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{field.label}</label>
          <input
            type={field.type}
            placeholder={field.placeholder}
            value={formData[field.key] || ''}
            onChange={(e) => setFormData(prev => ({ ...prev, [field.key]: e.target.value }))}
            className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
          />
          {field.type === 'password' && (
            <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.aiApiKeyHint')}</p>
          )}
        </div>
      ))}

      <div>
        <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('settings.syncFolder')}</label>
        <input
          type="text"
          placeholder="GLANCE/dayglance"
          value={formData.syncFolder || ''}
          onChange={(e) => setFormData(prev => ({ ...prev, syncFolder: e.target.value }))}
          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
        />
        <p className={`text-xs ${textSecondary} mt-0.5`}>Path on your WebDAV server where sync files are stored.</p>
      </div>

      {activeProvider.helpText && (
        <p className={`text-xs ${textSecondary}`}>{activeProvider.helpText}</p>
      )}

      {/* Encryption section */}
      <div className={`border-t ${borderClass} pt-4 space-y-3`}>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={encryptionEnabled}
            onChange={(e) => {
              setEncryptionEnabled(e.target.checked);
              setPassphrase('');
              setPassphraseConfirm('');
            }}
            className="w-5 h-5 rounded flex-shrink-0"
          />
          <span className={`text-sm font-medium ${textPrimary}`}>{t('settings.enableE2EEncryption')}</span>
        </label>

        {encryptionEnabled && (
          <div className="ml-7 space-y-3">
            <p className={`text-xs ${textSecondary}`}>
              Your data is encrypted on-device before upload. The server never sees your plaintext.
              Use a <strong>sync passphrase</strong> — not your WebDAV password.
            </p>

            {alreadyEncrypted && !passphraseRequired && (
              <p className={`text-xs text-amber-500`}>
                Encryption is already configured. Leave the passphrase field blank to keep your existing key, or enter it again to re-authenticate on this device.
              </p>
            )}

            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>
                Sync passphrase{passphraseRequired ? '' : ' (optional)'}
              </label>
              <input
                type="password"
                placeholder={passphraseRequired ? 'Choose a strong passphrase' : 'Re-enter to re-authenticate'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
              />
            </div>

            {passphraseRequired && (
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>Confirm passphrase</label>
                <input
                  type="password"
                  placeholder="Re-enter your passphrase"
                  value={passphraseConfirm}
                  onChange={(e) => setPassphraseConfirm(e.target.value)}
                  className={`w-full px-3 py-2 border ${passphraseMismatch ? 'border-red-500' : borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                {passphraseMismatch && (
                  <p className="text-xs text-red-500 mt-0.5">Passphrases do not match.</p>
                )}
              </div>
            )}

            <div className={`text-xs ${textSecondary} space-y-1 rounded-lg p-3 ${darkMode ? 'bg-gray-700' : 'bg-amber-50 border border-amber-200'}`}>
              <p className="font-medium text-amber-600">Important — store your passphrase safely</p>
              <p>This passphrase cannot be recovered. You will need it to set up sync on new devices. Store it in a password manager.</p>
            </div>
          </div>
        )}
      </div>

      {/* GLANCEvault (DB transport) — independent toggle, runs alongside WebDAV */}
      <div className={`border-t ${borderClass} pt-4 space-y-3`}>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={vaultEnabled}
            onChange={(e) => setVaultEnabled(e.target.checked)}
            className="w-5 h-5 rounded flex-shrink-0"
          />
          <span className={`text-sm font-medium ${textPrimary}`}>GLANCEvault (database sync)</span>
        </label>
        <p className={`text-xs ${textSecondary} ml-7`}>
          Row-grained database sync. Runs alongside your existing WebDAV sync. Your WebDAV data is never modified.
          Uses the same encryption passphrase as above.
        </p>
        {vaultEnabled && (
          <div className="ml-7 space-y-3">
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>Vault URL</label>
              <input
                type="text"
                placeholder="https://vault.glance-apps.com"
                value={vaultUrl}
                onChange={(e) => setVaultUrl(e.target.value)}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
              />
            </div>
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>Device token</label>
              <input
                type="password"
                placeholder="Device bearer token"
                value={vaultToken}
                onChange={(e) => setVaultToken(e.target.value)}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
              />
            </div>
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>Account ID</label>
              <input
                type="text"
                placeholder="Household account id"
                value={vaultAccountId}
                onChange={(e) => setVaultAccountId(e.target.value)}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
              />
            </div>
            <p className={`text-xs ${textSecondary}`}>Saving a GLANCEvault change reloads the app so the sync engines reconstruct.</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !requiredFieldsFilled}
          className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors disabled:opacity-50`}
        >
          {testing ? 'Testing...' : 'Test Connection'}
        </button>
        {testResult && (
          <span className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
            {testResult.success ? 'Connection successful!' : testResult.error}
          </span>
        )}
      </div>

      {migrationOldPath && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">Optional: move sync folder</p>
          <p>Your sync file is at the old location. You can move it for cleaner organization — sync will continue to work either way.</p>
          <p className="font-mono break-all">{migrationOldPath} → GLANCE/dayglance/</p>
          <p>After moving the file, update your Sync folder setting above to <span className="font-mono">GLANCE/dayglance</span>.</p>
          <button
            onClick={() => {
              localStorage.removeItem('dayglance-sync-migration-old-path');
              localStorage.setItem('dayglance-sync-migration-checked', '1');
            }}
            className="text-amber-700 underline mt-1"
          >
            Dismiss
          </button>
        </div>
      )}
      {cloudSyncStatus === 'error' && cloudSyncError ? (
        <p className="text-xs text-red-500">{cloudSyncError}</p>
      ) : cloudSyncLastSynced ? (
        <p className={`text-xs ${textSecondary}`}>
          Last synced: {new Date(cloudSyncLastSynced).toLocaleString()}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}
        >
          Cancel
        </button>
        {cloudSyncConfig?.enabled && (
          <button
            onClick={handleDisable}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Disable
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {cloudSyncConfig?.enabled ? 'Save' : 'Save & Enable'}
        </button>
      </div>
    </div>
  );
};

export default CloudSyncSettingsForm;
