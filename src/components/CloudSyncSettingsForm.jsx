import React, { useState } from 'react';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { setupEncryptionKey, setSyncPassphrase, clearEncryptionKey, getSyncPassphrase } from '../utils/crypto.js';
import { getVaultConfig, setVaultConfig } from '../sync/vaultConfig.js';
import { createDbEngine, resetDbRootKey } from '../sync/dbEngine.js';
import { testVaultConnection } from '../sync/vaultConnectionTest.js';
import { classifyVaultUrl } from '../sync/vaultUrlPolicy.js';
import { useTranslation } from 'react-i18next';

// Cloud sync settings form (extracted to avoid hooks-in-conditional issues)
const CloudSyncSettingsForm = ({ darkMode, textPrimary, textSecondary, borderClass, hoverBg, cloudSyncConfig, setCloudSyncConfig, cloudSyncTest, cloudSyncNow, provider, currentProvider, onClose, cloudSyncLastSynced, cloudSyncStatus, cloudSyncError, vaultSyncNow, vaultBootstrapSync, vaultStatus, vaultError, vaultLastSynced, vaultSkipped, onSyncKeyReady }) => {
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
  // WebDAV on/off, independent of whether the connection fields are filled — lets a
  // device keep its WebDAV credentials but stop syncing (e.g. moving fully to
  // GLANCEvault). Existing configured devices start checked; fresh ones start off
  // and reveal the connection fields when checked (mirrors the encryption/vault toggles).
  const [webdavEnabled, setWebdavEnabled] = useState(() => cloudSyncConfig?.enabled ?? false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [vaultSyncing, setVaultSyncing] = useState(false);
  const [migrationOldPath] = useState(() => localStorage.getItem('dayglance-sync-migration-old-path'));

  // GLANCEvault (DB transport) — independent of the WebDAV provider above. Runs
  // ALONGSIDE WebDAV; your WebDAV data is never modified. Saved to its own
  // localStorage key; toggling it requires a reload so the engines reconstruct.
  const [vaultOriginal] = useState(() => getVaultConfig());
  const [vaultEnabled, setVaultEnabled] = useState(() => !!vaultOriginal?.enabled);
  const [vaultUrl, setVaultUrl] = useState(() => vaultOriginal?.vaultUrl || '');
  const [vaultToken, setVaultToken] = useState(() => vaultOriginal?.vaultToken || '');
  const [vaultAccountId, setVaultAccountId] = useState(() => vaultOriginal?.accountId || '');
  const [vaultBootstrapping, setVaultBootstrapping] = useState(false);
  const [vaultBootstrapError, setVaultBootstrapError] = useState(null);
  const [showVaultToken, setShowVaultToken] = useState(false);
  // Pre-save vault credential check (mirrors the WebDAV Test Connection UX above,
  // but the LOGIC is the vault getSalt probe — see testVaultConnection).
  const [vaultTesting, setVaultTesting] = useState(false);
  const [vaultTestResult, setVaultTestResult] = useState(null);

  const activeProvider = cloudSyncProviders[formData.provider] || provider;
  const requiredFieldsFilled = activeProvider.configFields.every(f => formData[f.key]) && !!formData.syncFolder;
  const webdavConfigured = requiredFieldsFilled;
  // WebDAV syncs only when the user has it toggled on AND the connection is complete.
  const webdavActive = webdavEnabled && webdavConfigured;
  // True when the user is turning a previously-active WebDAV sync off, so Save stays
  // enabled even if nothing else (vault) is configured.
  const webdavBeingDisabled = !!cloudSyncConfig?.enabled && !webdavEnabled;

  // When enabling encryption, require a passphrase (confirmed) on fresh enable.
  // When already enabled, allow saving without re-entering (passphrase field is optional).
  const alreadyEncrypted = cloudSyncConfig?.encryptionEnabled;
  const passphraseRequired = encryptionEnabled && !alreadyEncrypted;
  const passphraseMismatch = passphraseRequired && passphraseConfirm && passphrase !== passphraseConfirm;
  const passphraseValid = !passphraseRequired || (passphrase.length > 0 && passphrase === passphraseConfirm);

  // GLANCEvault is independent of WebDAV and always end-to-end encrypted: enabling
  // it needs (a) all three vault fields and (b) the sync passphrase. The passphrase
  // lives only in memory, so after a reload `getSyncPassphrase()` is null even when
  // WebDAV encryption works off its cached key — in that case the user must
  // (re)enter it in the encryption field above. A passphrase setup must therefore
  // exist (encryption on, or already configured) and a passphrase must be in hand.
  const vaultFilled = vaultEnabled && !!vaultUrl.trim() && !!vaultToken.trim() && !!vaultAccountId.trim();
  // Transport-security check on the vault URL: block cleartext http:// on the public
  // internet (the Bearer token would travel unencrypted), allow it on localhost/LAN
  // with a warning. Only meaningful once a URL is typed; empty is handled by vaultFilled.
  const vaultUrlCheck = classifyVaultUrl(vaultUrl);
  const vaultUrlOk = !vaultFilled || vaultUrlCheck.ok;
  const passphraseAvailable = !!getSyncPassphrase() || passphrase.length > 0;
  const vaultEncryptionReady = encryptionEnabled || alreadyEncrypted;

  // The vault config the user is about to save (null when toggled off), compared
  // against what's persisted. Save only bootstraps/derives the vault key when this
  // is true (see handleSave), so the passphrase is only actually required then.
  const nextVaultConfig = vaultEnabled
    ? { enabled: true, vaultUrl: vaultUrl.trim(), vaultToken: vaultToken.trim(), accountId: vaultAccountId.trim() }
    : null;
  const vaultChanged = JSON.stringify(nextVaultConfig) !== JSON.stringify(vaultOriginal || null);

  // GLANCEvault needs the passphrase to (re)derive its key — but only when we'll
  // actually use it, i.e. when the vault is being enabled or its config edited. An
  // already-enabled, unchanged vault doesn't bootstrap on Save, so it must NOT block
  // saving an unrelated change (e.g. the WebDAV toggle) just because the passphrase
  // isn't in memory after a reload.
  const vaultReady = !(vaultFilled && vaultChanged) || (vaultEncryptionReady && passphraseAvailable);

  // Save is enabled when EITHER transport is fully set up (vault no longer gated
  // on the WebDAV connection) OR the user is turning the vault OFF — so a
  // vault-only device can disable it even though nothing remains configured.
  const vaultBeingDisabled = !!vaultOriginal?.enabled && !vaultEnabled;
  const canSave = (webdavActive || vaultFilled || vaultBeingDisabled || webdavBeingDisabled) && passphraseValid && !passphraseMismatch && vaultReady && vaultUrlOk;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await cloudSyncTest({ ...formData, provider: formData.provider });
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async () => {
    setVaultBootstrapError(null);
    // Refuse to save a vault whose URL would send the Bearer token over cleartext on
    // the public internet (canSave already blocks this; this is the defensive guard).
    if (vaultFilled && !vaultUrlCheck.ok) {
      setVaultBootstrapError(t(vaultUrlCheck.messageKey));
      return;
    }
    // WebDAV is marked enabled only when the user toggled it on AND the connection is
    // configured — so enabling GLANCEvault alone never writes a bogus enabled WebDAV
    // config, and unchecking the toggle disables sync while keeping the credentials.
    const newConfig = { ...formData, provider: formData.provider, enabled: webdavActive, encryptionEnabled };

    if (encryptionEnabled) {
      if (passphraseRequired && passphrase) {
        // First-time setup: generate salt + derive + cache key (also sets the session passphrase).
        await setupEncryptionKey(passphrase);
      } else if (passphrase) {
        // Re-entering the passphrase on an already-encrypted setup (new device, or
        // to make it available to GLANCEvault after a reload).
        setSyncPassphrase(passphrase);
      }
      // If already encrypted and no passphrase entered, leave the session key as-is.
    } else if (alreadyEncrypted) {
      // User disabled encryption.
      await clearEncryptionKey();
    }

    setCloudSyncConfig(newConfig);
    onSyncKeyReady?.(encryptionEnabled);

    // GLANCEvault is saved/cleared independently of the file engine. Only stored
    // when the toggle is on; cleared (reverting to file-only) when off. Uses the
    // hoisted nextVaultConfig/vaultChanged so the gate above and this save agree on
    // exactly when the vault is changing (and therefore needs the passphrase).
    const nextVault = nextVaultConfig;

    // The vault always shares the sync passphrase; make sure it is in the session
    // before deriving the DB root key (covers re-entry on an already-encrypted setup).
    if (vaultEnabled && passphrase) setSyncPassphrase(passphrase);
    setVaultConfig(nextVault);

    // Any enable/disable makes the entered passphrase authoritative: drop a cached
    // DB root key (in-memory + keystore/IndexedDB) so the next derive uses the
    // current passphrase + the server's account salt. Without this, a key cached
    // during an earlier attempt (wrong/old passphrase) stays locked in and pulling
    // another device's rows fails with "Decryption failed".
    if (vaultChanged) await resetDbRootKey();

    // Run the first real sync NOW, while the passphrase is in memory: this caches
    // the DB root key (IndexedDB on web, OS keystore on native) AND uploads/downloads
    // immediately, so data moves on Save instead of waiting for the post-reload
    // cadence. The passphrase itself is never persisted. It also validates the
    // vault URL/token AND the passphrase — on failure we surface the error and roll
    // back instead of reloading.
    if (vaultEnabled && vaultChanged) {
      setVaultBootstrapping(true);
      try {
        let result = { ok: true };
        if (vaultBootstrapSync) {
          result = await vaultBootstrapSync();
        } else {
          const boot = createDbEngine({ getData: () => ({}), commitData: () => {} });
          if (boot) await boot.ensureRootKey();
        }
        if (!result.ok) { const e = new Error(result.error || 'sync failed'); e.code = result.code; throw e; }
      } catch (err) {
        setVaultBootstrapping(false);
        await resetDbRootKey(); // don't leave a bad key cached after a failed attempt
        setVaultConfig(vaultOriginal || null); // roll back so we don't half-enable
        const msg = err?.message || '';
        const code = err?.code;
        let key, opts;
        if (code === 'VERIFIER_UNSUPPORTED' || code === 'ACCOUNT_ID_REQUIRED') {
          key = `sync.errors.${code}`;
        } else if (code === 'KEY_MISMATCH' || /decrypt/i.test(msg)) {
          key = 'sync.errors.KEY_MISMATCH';
        } else if (/passphrase/i.test(msg)) {
          key = 'sync.errors.passphraseNeeded';
        } else {
          key = 'sync.errors.vaultUnreachable';
          opts = { detail: msg || t('sync.errors.requestFailed') };
        }
        setVaultBootstrapError(t(key, opts));
        return;
      }
      setVaultBootstrapping(false);
    }

    // A vault change requires a reload so the DB engine is (re)constructed with
    // the new transport config on next mount (mirrors lastGLANCE).
    if (vaultChanged) { window.location.reload(); return; }
    onClose();
  };

  // Manual "Sync now" triggers — WebDAV file tier and GLANCEvault DB tier.
  const handleSyncNow = async () => {
    if (!cloudSyncNow) return;
    setSyncingNow(true);
    try { await cloudSyncNow(); } catch { /* surfaced via cloudSyncError */ }
    finally { setSyncingNow(false); }
  };
  const handleVaultSyncNow = async () => {
    if (!vaultSyncNow) return;
    setVaultSyncing(true);
    try { await vaultSyncNow(); } catch { /* surfaced via vaultError */ }
    finally { setVaultSyncing(false); }
  };

  // Pre-save TEST only: probe the entered vault credentials with an authenticated
  // getSalt and surface a typed outcome. Does NOT save, enable, or derive a key —
  // it just tells the user whether the credentials work, so bad vault credentials
  // no longer save silently and fail invisibly at first sync.
  const handleVaultTest = async () => {
    // Enforce the same URL policy before probing: a cleartext public URL never
    // reaches the network (the token would leak in the test request too).
    const urlCheck = classifyVaultUrl(vaultUrl);
    if (!urlCheck.ok) {
      setVaultTestResult({ ok: false, message: t(urlCheck.messageKey) });
      return;
    }
    setVaultTesting(true);
    setVaultTestResult(null);
    try {
      const result = await testVaultConnection({ vaultUrl, vaultToken, accountId: vaultAccountId });
      setVaultTestResult(result);
    } catch {
      // testVaultConnection classifies every failure itself; this is defensive.
      setVaultTestResult({ ok: false, message: 'Could not reach the vault at this URL.' });
    } finally {
      setVaultTesting(false);
    }
  };

  // Shared section-header style (uppercase, like the lastGLANCE layout).
  const sectionHeader = `text-xs font-semibold uppercase tracking-wide ${textSecondary}`;
  const secondaryBtn = `px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors disabled:opacity-50`;
  const vaultPersistedEnabled = !!vaultOriginal?.enabled;

  return (
    <div className="space-y-4">
      {/* ── WebDAV Sync ───────────────────────────────────────────────────── */}
      <h3 className={sectionHeader}>WebDAV Sync</h3>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={webdavEnabled}
          onChange={(e) => setWebdavEnabled(e.target.checked)}
          className="w-5 h-5 rounded flex-shrink-0"
        />
        <span className={`text-sm font-medium ${textPrimary}`}>Sync via WebDAV</span>
      </label>
      <p className={`text-xs ${textSecondary} ml-7`}>
        Sync to any WebDAV server (Nextcloud, ownCloud, etc.). Turn this off to keep your
        connection details but stop syncing on this device — for example when moving fully to GLANCEvault.
      </p>

      {webdavEnabled && (
        <div className="ml-7 space-y-4">
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

          {/* WebDAV actions: Test Connection + Sync Now, with status below. */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTest}
              disabled={testing || !requiredFieldsFilled}
              className={secondaryBtn}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button
              onClick={handleSyncNow}
              disabled={syncingNow || !cloudSyncConfig?.enabled}
              title={!cloudSyncConfig?.enabled ? 'Enable WebDAV sync first' : 'Sync with WebDAV now'}
              className={secondaryBtn}
            >
              {(syncingNow || cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>
          {testResult && (
            <p className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
              {testResult.success ? 'Connection successful!' : testResult.error}
            </p>
          )}
          {cloudSyncStatus === 'error' && cloudSyncError ? (
            <p className="text-xs text-red-500">{cloudSyncError}</p>
          ) : cloudSyncLastSynced ? (
            <p className={`text-xs ${textSecondary}`}>
              Last synced: {new Date(cloudSyncLastSynced).toLocaleString()}
            </p>
          ) : null}

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
        </div>
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

      {/* ── GLANCEvault (Beta) ────────────────────────────────────────────── */}
      <div className={`border-t ${borderClass} pt-4 space-y-3`}>
        <h3 className={sectionHeader}>GLANCEvault (Beta)</h3>
        <p className="text-xs text-amber-500 flex items-start gap-1.5">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>Experimental. Requires a self-hosted GLANCEvault server. Not recommended for most users.</span>
        </p>

        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={vaultEnabled}
            onChange={(e) => setVaultEnabled(e.target.checked)}
            className="w-5 h-5 rounded flex-shrink-0"
          />
          <span className={`text-sm font-medium ${textPrimary}`}>Sync via GLANCEvault</span>
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
              {vaultUrl.trim() && !vaultUrlCheck.ok && (
                <p className="text-xs text-red-500 mt-0.5">{t(vaultUrlCheck.messageKey)}</p>
              )}
              {vaultUrl.trim() && vaultUrlCheck.ok && vaultUrlCheck.warning && (
                <p className="text-xs text-amber-500 mt-0.5">{t(vaultUrlCheck.messageKey)}</p>
              )}
            </div>
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>Device token</label>
              <div className="relative">
                <input
                  type={showVaultToken ? 'text' : 'password'}
                  placeholder="Device bearer token"
                  value={vaultToken}
                  onChange={(e) => setVaultToken(e.target.value)}
                  className={`w-full px-3 py-2 pr-10 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowVaultToken(v => !v)}
                  aria-label={showVaultToken ? 'Hide device token' : 'Show device token'}
                  className={`absolute inset-y-0 right-0 flex items-center px-3 ${textSecondary}`}
                >
                  {showVaultToken ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
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
            {/* Vault actions: pre-save Test Connection (mirrors the WebDAV button
                above), with the typed outcome shown below. This verifies the
                credentials with a getSalt probe; it does not save or enable. */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleVaultTest}
                disabled={vaultTesting || !vaultFilled}
                className={secondaryBtn}
              >
                {vaultTesting ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
            {vaultTestResult && (
              <p className={`text-sm ${vaultTestResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                {vaultTestResult.message}
              </p>
            )}
            <p className={`text-xs ${textSecondary}`}>Saving a GLANCEvault change reloads the app so the sync engines reconstruct.</p>
            {!vaultEncryptionReady && (
              <p className="text-xs text-amber-500">
                GLANCEvault is always end-to-end encrypted. Turn on “{t('settings.enableE2EEncryption')}” above and set your sync passphrase to enable it.
              </p>
            )}
            {vaultEncryptionReady && vaultChanged && !passphraseAvailable && (
              <p className="text-xs text-amber-500">
                Enter your sync passphrase in the encryption section above to enable GLANCEvault on this device.
              </p>
            )}
            {vaultBootstrapError && (
              <p className="text-xs text-red-500">{vaultBootstrapError}</p>
            )}
          </div>
        )}

        {/* GLANCEvault actions: Sync Now, with status below. Enabled once the
            saved config is active (and the engine therefore exists). */}
        {vaultPersistedEnabled && (
          <>
            <div className="flex items-center gap-2">
              <button
                onClick={handleVaultSyncNow}
                disabled={vaultSyncing}
                className={secondaryBtn}
              >
                {(vaultSyncing || vaultStatus === 'uploading' || vaultStatus === 'downloading') ? 'Syncing...' : 'Sync Now'}
              </button>
            </div>
            {vaultError ? (
              <p className="text-xs text-red-500">{vaultError}</p>
            ) : vaultLastSynced ? (
              <p className={`text-xs ${textSecondary}`}>
                Last synced: {new Date(vaultLastSynced).toLocaleString()}
              </p>
            ) : null}
            {vaultSkipped > 0 && (
              <p className="text-xs text-amber-500">
                {vaultSkipped} item{vaultSkipped === 1 ? '' : 's'} couldn’t be read (skipped). This usually means a different sync passphrase was used on another device.
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          onClick={onClose}
          className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave || vaultBootstrapping}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {vaultBootstrapping ? 'Enabling…' : ((cloudSyncConfig?.enabled || vaultOriginal?.enabled) ? 'Save' : 'Save & Enable')}
        </button>
      </div>
    </div>
  );
};

export default CloudSyncSettingsForm;
