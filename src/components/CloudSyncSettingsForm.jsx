import React, { useState } from 'react';
import { AlertTriangle, Cloud, Database, Eye, EyeOff, Lock, Network } from 'lucide-react';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { setupEncryptionKey, setSyncPassphrase, clearEncryptionKey, getSyncPassphrase } from '../utils/crypto.js';
import { directAccessEncryptsWrites } from '../sync/directAccessTransport.js';
import { getStoredVaultConfig, setVaultConfig, planVaultSave, planProVaultSave, isProConnection, PRO_VAULT_URL } from '../sync/vaultConfig.js';
import { enrollWithAccountKey } from '../sync/vaultProEnroll.js';
import { enableVaultIntentsForPro } from '../intents/vaultIntentsSetup.js';
import SettingsCard from './settings/SettingsCard.jsx';
import { webdavSaveConfig, encryptionSaveConfig, webdavDirty, encryptionDirty } from '../sync/syncFormPlan.js';
import { createDbEngine, resetDbRootKey, resetVaultSyncCursor } from '../sync/dbEngine.js';
import { testVaultConnection } from '../sync/vaultConnectionTest.js';
import { testFileTierConnection, providerServerUrl, BLOCKED_PRIVATE_ADDRESS } from '../sync/proxyTrustPreflight.js';
import { classifyVaultUrl } from '../sync/vaultUrlPolicy.js';
import { classifyWebdavUrl } from '../sync/webdavUrlPolicy.js';
import { normalizeSyncFolder } from '../utils/syncFolder.js';
import { useTranslation } from 'react-i18next';
import SyncUnreadableRemoteNotice from './SyncUnreadableRemoteNotice.jsx';

// Cloud sync settings form (extracted to avoid hooks-in-conditional issues)
const CloudSyncSettingsForm = ({ darkMode, textPrimary, textSecondary, borderClass, hoverBg, cloudSyncConfig, setCloudSyncConfig, cloudSyncTest, cloudSyncNow, provider, currentProvider, afterChannels, afterProxy, cloudSyncLastSynced, cloudSyncStatus, cloudSyncError, cloudSyncRemoteUnreadable, cloudSyncReplaceRemote, vaultSyncNow, vaultBootstrapSync, vaultStatus, vaultError, vaultLastSynced, vaultSkipped, onSyncKeyReady }) => {
  const { t } = useTranslation();
  // The WebDAV fields as saved; also what the WebDAV card's Cancel puts back.
  const savedFormData = () => {
    const initial = {
      provider: currentProvider,
      syncFolder: cloudSyncConfig?.syncFolder ?? 'GLANCE/dayglance',
    };
    // Populate fields from all providers so switching preserves filled values
    Object.values(cloudSyncProviders).forEach(p => {
      p.configFields.forEach(f => { initial[f.key] = cloudSyncConfig?.[f.key] || ''; });
    });
    return initial;
  };
  const [formData, setFormData] = useState(savedFormData);
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
  // The STORED config, paused or not: a paused connection is shown so it can be
  // resumed or disconnected (sync/vaultConfig.js, "Paused is not forgotten").
  const [vaultOriginal] = useState(() => getStoredVaultConfig());
  const [vaultEnabled, setVaultEnabled] = useState(() => !!vaultOriginal?.enabled);
  const [vaultUrl, setVaultUrl] = useState(() => vaultOriginal?.vaultUrl || '');
  const [vaultToken, setVaultToken] = useState(() => vaultOriginal?.vaultToken || '');
  const [vaultAccountId, setVaultAccountId] = useState(() => vaultOriginal?.accountId || '');
  const [vaultBootstrapping, setVaultBootstrapping] = useState(false);
  const [vaultBootstrapError, setVaultBootstrapError] = useState(null);
  const [showVaultToken, setShowVaultToken] = useState(false);
  // GLANCEvault Pro: the hosted vault. Checked, the card asks only for the
  // account key; the URL is fixed and the token and account come from
  // enrolling with the key on Save. The key lives in this state only and is
  // gone with the reload that follows a successful Save.
  const [vaultPro, setVaultPro] = useState(() => !!vaultOriginal?.pro);
  const [vaultAccountKey, setVaultAccountKey] = useState('');
  const [showAccountKey, setShowAccountKey] = useState(false);
  // Pre-save vault credential check (mirrors the WebDAV Test Connection UX above,
  // but the LOGIC is the vault getSalt probe — see testVaultConnection).
  const [vaultTesting, setVaultTesting] = useState(false);
  const [vaultTestResult, setVaultTestResult] = useState(null);
  // The sync passphrase, asked for in the GLANCEvault card itself when a new or
  // edited connection needs it and this session does not have it.
  const [vaultPassphrase, setVaultPassphrase] = useState('');
  const [encryptionSaving, setEncryptionSaving] = useState(false);
  // Desktop-only (issue #1642): origins the user has permitted the Electron IPC
  // proxy to reach despite resolving to a private network address. The main
  // process owns the list and the consent dialog; this is a view over it.
  const proxyTrust = typeof window !== 'undefined' ? window.electronAPI?.proxyTrust : null;
  const [trustedHosts, setTrustedHosts] = useState([]);
  const refreshTrustedHosts = React.useCallback(async () => {
    if (!proxyTrust) return;
    try { setTrustedHosts(await proxyTrust.list() ?? []); } catch { /* list is decorative */ }
  }, [proxyTrust]);
  React.useEffect(() => { refreshTrustedHosts(); }, [refreshTrustedHosts]);

  // Sync proxy (Electron): the outbound proxy server the desktop's sync traffic
  // connects through. The main process owns the config file and the dedicated
  // session (electron/syncProxySettings.ts); this is a view over it, saved
  // through its own IPC — deliberately NOT part of the cloudSyncConfig Save
  // below, because the proxy applies to WebDAV and GLANCEvault alike. It carries
  // no credentials: an authenticated proxy is out of scope, so nothing here
  // holds a secret and no field has to hide one.
  const syncProxyApi = typeof window !== 'undefined' ? window.electronAPI?.syncProxy : null;
  // What the main process last reported: the card's off state reads it, and
  // switching an active proxy off saves it with enabled:false, so the server,
  // port and rules are kept for the next time it is switched on.
  const [proxySaved, setProxySaved] = useState(null);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyScheme, setProxyScheme] = useState('http');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('');
  const [proxyPrivate, setProxyPrivate] = useState('direct');
  const [proxyBypass, setProxyBypass] = useState('');
  const [proxySaving, setProxySaving] = useState(false);
  const [proxySaveState, setProxySaveState] = useState(null); // { ok: boolean, reason?: string }
  React.useEffect(() => {
    if (!syncProxyApi) return undefined;
    let cancelled = false;
    syncProxyApi.get().then((snapshot) => {
      if (cancelled || !snapshot) return;
      setProxyEnabled(!!snapshot.active);
      setProxyScheme(snapshot.scheme || 'http');
      setProxyHost(snapshot.host || '');
      setProxyPort(snapshot.port ? String(snapshot.port) : '');
      setProxyPrivate(snapshot.privateAddresses === 'proxy' ? 'proxy' : 'direct');
      setProxyBypass((snapshot.bypassRules || []).join(', '));
      setProxySaved(snapshot);
    }).catch(() => { /* the section stays at defaults; a save reports the truth */ });
    return () => { cancelled = true; };
  }, [syncProxyApi]);

  // The card's switch. On opens the form; nothing is sent until Save, since a
  // proxy needs a server first. Off on an ACTIVE proxy takes effect at once,
  // as every other card's off does, and keeps what was saved: it re-sends the
  // saved settings with enabled:false, not the form, so a half-edited field
  // cannot block switching it off.
  const handleSyncProxyToggle = async (next) => {
    setProxyEnabled(next);
    setProxySaveState(null);
    if (next || !proxySaved?.active || !syncProxyApi) return;
    setProxySaving(true);
    try {
      const result = await syncProxyApi.set({
        enabled: false,
        scheme: proxySaved.scheme,
        host: proxySaved.host,
        port: proxySaved.port,
        privateAddresses: proxySaved.privateAddresses,
        bypassRules: proxySaved.bypassRules || [],
      });
      if (result?.ok && result.snapshot) {
        setProxySaved(result.snapshot);
      } else {
        setProxyEnabled(true);
        setProxySaveState({ ok: false, reason: t('sync.form.syncProxySaveFailed', { reason: result?.reason || '' }) });
      }
    } catch {
      setProxyEnabled(true);
      setProxySaveState({ ok: false, reason: t('sync.form.syncProxySaveFailed', { reason: '' }) });
    } finally {
      setProxySaving(false);
    }
  };

  const handleSaveSyncProxy = async () => {
    if (!syncProxyApi || proxySaving) return;
    const host = proxyHost.trim();
    const port = Number(proxyPort.trim());
    if (!host) {
      setProxySaveState({ ok: false, reason: t('sync.form.syncProxyInvalidHost') });
      return;
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setProxySaveState({ ok: false, reason: t('sync.form.syncProxyInvalidPort') });
      return;
    }
    setProxySaving(true);
    setProxySaveState(null);
    try {
      const result = await syncProxyApi.set({
        enabled: proxyEnabled,
        scheme: proxyScheme,
        host,
        port,
        privateAddresses: proxyPrivate,
        bypassRules: proxyBypass.trim() ? proxyBypass.split(',').map((r) => r.trim()).filter(Boolean) : [],
      });
      if (result?.ok) {
        if (result.snapshot) setProxySaved(result.snapshot);
        setProxySaveState({ ok: true });
      } else {
        setProxySaveState({ ok: false, reason: t('sync.form.syncProxySaveFailed', { reason: result?.reason || '' }) });
      }
    } catch {
      setProxySaveState({ ok: false, reason: t('sync.form.syncProxySaveFailed', { reason: '' }) });
    } finally {
      setProxySaving(false);
    }
  };

  const activeProvider = cloudSyncProviders[formData.provider] || provider;
  const requiredFieldsFilled = activeProvider.configFields.every(f => formData[f.key]) && !!formData.syncFolder;
  const webdavConfigured = requiredFieldsFilled;
  // WebDAV syncs only when the user has it toggled on AND the connection is complete.
  const webdavActive = webdavEnabled && webdavConfigured;

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
  // Pro: a pasted key, or the Pro connection already stored.
  const vaultProConnected = isProConnection(vaultOriginal);
  const vaultFilled = vaultEnabled && (vaultPro
    ? (!!vaultAccountKey.trim() || vaultProConnected)
    : (!!vaultUrl.trim() && !!vaultToken.trim() && !!vaultAccountId.trim()));
  // Transport-security check on the vault URL: block cleartext http:// on the public
  // internet (the Bearer token would travel unencrypted), allow it on localhost/LAN
  // with a warning. Only meaningful once a URL is typed; empty is handled by vaultFilled.
  const vaultUrlCheck = classifyVaultUrl(vaultPro ? PRO_VAULT_URL : vaultUrl);
  const vaultUrlOk = !vaultFilled || vaultUrlCheck.ok;
  // Each card saves on its own, so GLANCEvault depends on encryption as SAVED,
  // and takes the passphrase from its own field when the session has none.
  const passphraseAvailable = !!getSyncPassphrase() || vaultPassphrase.length > 0;
  const vaultEncryptionReady = !!alreadyEncrypted;

  // What Save does to the vault config (sync/vaultConfig.js planVaultSave):
  // switched off keeps the connection, paused; only a new or edited connection
  // needs the passphrase, a fresh key and fresh sync cursors, so pausing and
  // resuming the same connection asks for nothing and keeps its place.
  // Pro switched on plans through planProVaultSave (enroll first when a key
  // was pasted); switched off, Pro pauses like any connection.
  const vaultPlan = vaultEnabled && vaultPro
    ? planProVaultSave(vaultOriginal, { accountKey: vaultAccountKey })
    : planVaultSave(vaultOriginal, { enabled: vaultEnabled, vaultUrl, vaultToken, accountId: vaultAccountId });
  const nextVaultConfig = vaultPlan.next;
  const vaultChanged = vaultPlan.changed;
  const vaultConnectionChanged = vaultPlan.connectionChanged;
  const vaultPaused = !vaultOriginal?.enabled && !!(vaultOriginal?.vaultUrl && vaultOriginal?.vaultToken && vaultOriginal?.accountId);

  // GLANCEvault needs the passphrase to (re)derive its key — but only when we'll
  // actually use it, i.e. when the vault is being enabled or its config edited. An
  // already-enabled, unchanged vault doesn't bootstrap on Save, so it must NOT block
  // saving an unrelated change (e.g. the WebDAV toggle) just because the passphrase
  // isn't in memory after a reload.
  const vaultReady = !(vaultFilled && vaultConnectionChanged) || (vaultEncryptionReady && passphraseAvailable);

  // Save is enabled when EITHER transport is fully set up (vault no longer gated
  // on the WebDAV connection) OR the user is turning the vault OFF — so a
  // vault-only device can disable it even though nothing remains configured.
  // Per card: what differs from saved (its Save and Cancel show) and whether it
  // can be saved as it stands.
  const encryptionIsDirty = encryptionDirty({ saved: cloudSyncConfig, encryptionEnabled, passphrase });
  const encryptionCanSave = passphraseValid && !passphraseMismatch;
  const webdavIsDirty = webdavDirty({ saved: cloudSyncConfig, form: formData, webdavEnabled, providers: cloudSyncProviders, normalizeFolder: normalizeSyncFolder });
  const webdavCanSave = webdavEnabled ? webdavConfigured : true;
  // Flipping the Pro box alone is a change worth a Cancel, even before a key.
  const vaultIsDirty = vaultChanged || (vaultEnabled && vaultPro !== !!vaultOriginal?.pro);
  const vaultCanSave = (vaultEnabled ? vaultFilled : true) && vaultUrlOk && vaultReady;

  // On desktop, the pre-flight reports a private-network server the proxy would
  // refuse, instead of the synthetic 400 the probe gets back from it (#2024).
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testFileTierConnection(
        { ...formData, provider: formData.provider },
        { provider: activeProvider, probe: cloudSyncTest },
      );
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  // ── Saves, one per card ───────────────────────────────────────────────
  // End-to-end encryption: sets up, re-enters or clears the key, and stores the
  // flag over the SAVED WebDAV config (sync/syncFormPlan.js), so unsaved WebDAV
  // edits are not stored with it.
  const handleSaveEncryption = async () => {
    setEncryptionSaving(true);
    try {
      if (encryptionEnabled) {
        if (passphraseRequired && passphrase) {
          // First-time setup: generate salt + derive + cache key (also sets the session passphrase).
          await setupEncryptionKey(passphrase);
        } else if (passphrase) {
          // Re-entering the passphrase on an already-encrypted setup (new device).
          setSyncPassphrase(passphrase);
        }
        // If already encrypted and no passphrase entered, leave the session key as-is.
      } else if (alreadyEncrypted && !directAccessEncryptsWrites()) {
        // User disabled encryption. The Direct Access file uses the same key
        // (docs/direct-access-sync.md, Phase 6): while its switch is on, the key
        // stays, or that device would prompt again for the passphrase it has.
        await clearEncryptionKey();
      }
      setCloudSyncConfig(encryptionSaveConfig({ saved: cloudSyncConfig, encryptionEnabled, providers: cloudSyncProviders, provider: currentProvider }));
      onSyncKeyReady?.(encryptionEnabled);
      setPassphrase('');
      setPassphraseConfirm('');
    } finally {
      setEncryptionSaving(false);
    }
  };
  const handleCancelEncryption = () => {
    setEncryptionEnabled(!!cloudSyncConfig?.encryptionEnabled);
    setPassphrase('');
    setPassphraseConfirm('');
  };

  // WebDAV: stores the connection and on/off, enabled only when switched on AND
  // complete, keeping the SAVED encryption flag. Switched off keeps the details.
  const handleSaveWebdav = () => {
    setCloudSyncConfig(webdavSaveConfig({ saved: cloudSyncConfig, form: formData, webdavEnabled, configured: webdavConfigured, normalizeFolder: normalizeSyncFolder }));
    onSyncKeyReady?.(!!cloudSyncConfig?.encryptionEnabled);
  };
  const handleCancelWebdav = () => {
    setFormData(savedFormData());
    setWebdavEnabled(!!cloudSyncConfig?.enabled);
    setTestResult(null);
  };

  // GLANCEvault: its own stored config (planVaultSave). Touches neither the
  // WebDAV config nor the encryption flag.
  const handleSaveVault = async () => {
    setVaultBootstrapError(null);
    // Refuse to save a vault whose URL would send the Bearer token over cleartext on
    // the public internet (vaultCanSave already blocks this; this is the defensive guard).
    if (vaultFilled && !vaultUrlCheck.ok) {
      setVaultBootstrapError(t(vaultUrlCheck.messageKey));
      return;
    }
    // Pro with a pasted key: enroll this device first. The server answers with
    // this device's credential and the account the key belongs to, which
    // become the stored connection; the key itself is never stored.
    let saveConfig = nextVaultConfig;
    let saveConnectionChanged = vaultConnectionChanged;
    if (vaultEnabled && vaultPro && vaultPlan.needsEnroll) {
      setVaultBootstrapping(true);
      try {
        const enrolled = await enrollWithAccountKey(vaultAccountKey);
        const planned = vaultPlan.withEnrollment(enrolled);
        saveConfig = planned.next;
        saveConnectionChanged = planned.connectionChanged;
      } catch (err) {
        setVaultBootstrapping(false);
        setVaultBootstrapError(err?.code === 'KEY_REJECTED'
          ? t('sync.errors.vaultProKeyRejected')
          : t('sync.errors.vaultProUnavailable', { detail: err?.message || t('sync.errors.requestFailed') }));
        return;
      }
    }

    // The vault always shares the sync passphrase; make sure it is in the session
    // before deriving the DB root key.
    if (vaultEnabled && vaultPassphrase) setSyncPassphrase(vaultPassphrase);
    setVaultConfig(saveConfig);

    // A new or edited connection makes the entered passphrase authoritative: drop a cached
    // DB root key (in-memory + keystore/IndexedDB) so the next derive uses the
    // current passphrase + the server's account salt. Without this, a key cached
    // during an earlier attempt (wrong/old passphrase) stays locked in and pulling
    // another device's rows fails with "Decryption failed".
    //
    // Likewise drop the persisted sync cursors (snapshot / pull HWM / push-ack /
    // dirty set): they describe the PREVIOUS link. Re-linking (possibly to a
    // different vault/account) with a stale HWM would skip every existing vault
    // row below it, and a stale snapshot would diff local rows as clean/dirty
    // against the wrong baseline. Fresh cursors make the first cycle a full pull
    // + full-seed, which merges per-entity LWW (see resetVaultSyncCursor).
    // Pausing and resuming the SAME connection keeps both: the key and the
    // cursors still describe that link, so it picks up where it stopped.
    if (saveConnectionChanged) {
      await resetDbRootKey();
      resetVaultSyncCursor();
    }

    // Run the first real sync NOW, while the passphrase is in memory: this caches
    // the DB root key (IndexedDB on web, OS keystore on native) AND uploads/downloads
    // immediately, so data moves on Save instead of waiting for the post-reload
    // cadence. The passphrase itself is never persisted. It also validates the
    // vault URL/token AND the passphrase — on failure we surface the error and roll
    // back instead of reloading.
    if (vaultEnabled && saveConnectionChanged) {
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
      // Pro is one box for sync and intents. The first sync above has
      // established the account salt, and the passphrase is still in hand.
      if (vaultPro) {
        const passphraseNow = getSyncPassphrase();
        if (passphraseNow) await enableVaultIntentsForPro(passphraseNow);
      }
      setVaultBootstrapping(false);
    }

    // A vault change requires a reload so the DB engine is (re)constructed with
    // the new transport config on next mount (mirrors lastGLANCE).
    if (vaultChanged) window.location.reload();
  };
  const handleCancelVault = () => {
    setVaultEnabled(!!vaultOriginal?.enabled);
    setVaultUrl(vaultOriginal?.vaultUrl || '');
    setVaultToken(vaultOriginal?.vaultToken || '');
    setVaultAccountId(vaultOriginal?.accountId || '');
    setVaultPro(!!vaultOriginal?.pro);
    setVaultAccountKey('');
    setVaultPassphrase('');
    setVaultBootstrapError(null);
    setVaultTestResult(null);
  };

  // A card's Save and Cancel, shown only while it differs from what is saved.
  const cardActions = ({ dirty, canSave, busy, onSave, onCancel, saveLabel, id }) => (dirty ? (
    <div className="flex items-center justify-end gap-2 pt-1" data-sync-card-actions={id}>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors disabled:opacity-50`}
      >
        {t('common.cancel')}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!canSave || busy}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {saveLabel || t('common.save')}
      </button>
    </div>
  ) : null);

  // Manual "Sync now" triggers — WebDAV file tier and GLANCEvault DB tier.
  const handleSyncNow = async () => {
    if (!cloudSyncNow) return;
    setSyncingNow(true);
    try { await cloudSyncNow(); } catch { /* surfaced via cloudSyncError */ }
    finally { setSyncingNow(false); }
  };
  // Disconnect: the explicit forget. The connection, the cached key and the sync
  // cursors go, as switching off used to do; data on the server is untouched.
  const handleVaultDisconnect = async () => {
    if (typeof window !== 'undefined' && !window.confirm(t('sync.form.vaultDisconnectConfirm'))) return;
    setVaultConfig(null);
    await resetDbRootKey();
    resetVaultSyncCursor();
    window.location.reload();
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
      setVaultTestResult({ ok: false, message: t('sync.form.vaultUnreachableSimple') });
    } finally {
      setVaultTesting(false);
    }
  };

  // Raise the main process's native permission dialog for `url`. The dialog is
  // deliberately reachable only from an "Allow this address" click. Returns the
  // refusal message to show, or null once the origin is granted.
  // `warningLoopbackKey` names what the user is expected to be running locally.
  const requestPrivateAddressGrant = async (url, warningLoopbackKey) => {
    try {
      // The main process owns the dialog but holds no locale bundle, so the
      // translated chrome travels with the request (applicationMenu.ts pattern).
      const result = await proxyTrust.request(url, {
        title: t('sync.form.vaultConsentTitle'),
        question: t('sync.form.vaultConsentQuestion'),
        resolvesTo: t('sync.form.vaultConsentResolvesTo'),
        warning: t('sync.form.vaultConsentWarning'),
        warningLoopback: t(warningLoopbackKey),
        scope: t('sync.form.vaultConsentScope'),
        allow: t('sync.form.vaultConsentAllow'),
        cancel: t('common.cancel'),
      });
      await refreshTrustedHosts();
      return result?.ok ? null : (result?.reason || '');
    } catch {
      return '';
    }
  };

  // Vault: grant, then re-run the test so a granted address turns straight
  // into a green "Connected."
  const handleGrantPrivateAddress = async () => {
    if (!proxyTrust) return;
    setVaultTesting(true);
    let refusal;
    try {
      refusal = await requestPrivateAddressGrant(vaultUrl.trim(), 'sync.form.vaultConsentWarningLoopback');
    } finally {
      setVaultTesting(false);
    }
    if (refusal !== null) {
      setVaultTestResult({ ok: false, message: refusal || t('sync.form.vaultUnreachableSimple') });
      return;
    }
    await handleVaultTest();
  };

  // WebDAV / Nextcloud: the same grant, for the server URL the test inspected.
  const handleGrantWebdavPrivateAddress = async () => {
    const url = providerServerUrl(activeProvider, formData);
    if (!proxyTrust || !url) return;
    setTesting(true);
    let refusal;
    try {
      refusal = await requestPrivateAddressGrant(url, 'sync.form.privateConsentWarningLoopbackServer');
    } finally {
      setTesting(false);
    }
    if (refusal !== null) {
      setTestResult({ success: false, error: refusal || t('sync.form.privateAddressGrantFailed') });
      return;
    }
    await handleTest();
  };

  const handleRevokePrivateAddress = async (origin) => {
    if (!proxyTrust) return;
    try { await proxyTrust.revoke(origin); } catch { /* refresh below shows the truth */ }
    await refreshTrustedHosts();
  };

  // Shared section-header style (uppercase, like the lastGLANCE layout).
  const sectionHeader = `text-xs font-semibold uppercase tracking-wide ${textSecondary}`;
  const secondaryBtn = `px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors disabled:opacity-50`;
  const vaultPersistedEnabled = !!vaultOriginal?.enabled;

  return (
    <div className="space-y-4">
      {/* ── End-to-end encryption ─────────────────────────────────────────
          First, because it is shared: WebDAV uses it when on, and GLANCEvault
          always needs it. */}
      <SettingsCard
        cardId="encryption"
        icon={Lock}
        title={t('sync.form.encryptionTitle')}
        switchLabel={t('settings.enableE2EEncryption')}
        checked={encryptionEnabled}
        onToggle={(next) => {
          setEncryptionEnabled(next);
          setPassphrase('');
          setPassphraseConfirm('');
        }}
        footer={cardActions({ id: 'encryption', dirty: encryptionIsDirty, canSave: encryptionCanSave, busy: encryptionSaving, onSave: handleSaveEncryption, onCancel: handleCancelEncryption })}
        darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
      >
          <div className="space-y-3">
            <p className={`text-xs ${textSecondary}`}>
              {t('sync.form.encryptionExplainer')}
            </p>

            {alreadyEncrypted && !passphraseRequired && (
              <p className={`text-xs text-amber-500`}>
                {t('sync.form.encryptionAlreadyConfigured')}
              </p>
            )}

            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>
                {passphraseRequired ? t('sync.form.syncPassphraseLabel') : t('sync.form.syncPassphraseLabelOptional')}
              </label>
              <input
                type="password"
                placeholder={passphraseRequired ? t('sync.form.passphrasePlaceholderNew') : t('sync.form.passphrasePlaceholderReenter')}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
              />
            </div>

            {passphraseRequired && (
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('sync.form.confirmPassphraseLabel')}</label>
                <input
                  type="password"
                  placeholder={t('sync.form.confirmPassphrasePlaceholder')}
                  value={passphraseConfirm}
                  onChange={(e) => setPassphraseConfirm(e.target.value)}
                  className={`w-full px-3 py-2 border ${passphraseMismatch ? 'border-red-500' : borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                {passphraseMismatch && (
                  <p className="text-xs text-red-500 mt-0.5">{t('sync.form.passphraseMismatch')}</p>
                )}
              </div>
            )}

            <div className={`text-xs ${textSecondary} space-y-1 rounded-lg p-3 ${darkMode ? 'bg-gray-700' : 'bg-amber-50 border border-amber-200'}`}>
              <p className="font-medium text-amber-600">{t('sync.form.storePassphraseTitle')}</p>
              <p>{t('sync.form.storePassphraseBody')}</p>
            </div>
          </div>
      </SettingsCard>

      {/* ── WebDAV Sync ───────────────────────────────────────────────────── */}
      <SettingsCard
        cardId="webdav"
        icon={Cloud}
        title={t('sync.form.webdavTitle')}
        hint={t('sync.form.webdavToggleHint')}
        switchLabel={t('sync.form.webdavToggle')}
        checked={webdavEnabled}
        onToggle={setWebdavEnabled}
        summary={!webdavEnabled && webdavConfigured ? t('sync.form.pausedKept') : null}
        footer={cardActions({ id: 'webdav', dirty: webdavIsDirty, canSave: webdavCanSave, onSave: handleSaveWebdav, onCancel: handleCancelWebdav })}
        darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
      >
      {webdavEnabled && (
        <div className="space-y-4">
          <div>
            <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('settings.aiProvider')}</label>
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
              {field.type === 'url' && (() => {
                const urlCheck = classifyWebdavUrl(formData[field.key]);
                return urlCheck && (
                  <p className={`text-xs mt-0.5 ${urlCheck.level === 'danger' ? 'text-red-500' : 'text-amber-500'}`}>{t(urlCheck.messageKey)}</p>
                );
              })()}
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
            <p className={`text-xs ${textSecondary} mt-0.5`}>{t('sync.form.syncFolderHint')}</p>
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
              {testing ? t('settings.aiTesting') : t('settings.aiTestConnection')}
            </button>
            <button
              onClick={handleSyncNow}
              disabled={syncingNow || !cloudSyncConfig?.enabled}
              title={!cloudSyncConfig?.enabled ? t('sync.form.syncNowDisabledTitle') : t('sync.form.syncNowTitle')}
              className={secondaryBtn}
            >
              {(syncingNow || cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? t('common.syncing') : t('common.syncNow')}
            </button>
          </div>
          {testResult && (
            <p className={`text-sm ${testResult.success ? 'text-green-500' : 'text-red-500'}`}>
              {testResult.success
                ? t('sync.form.connectionSuccess')
                : testResult.code === BLOCKED_PRIVATE_ADDRESS
                  ? t(testResult.canGrant ? 'sync.form.privateAddressNeedsPermission' : 'sync.form.reservedAddressRefused', { origin: testResult.origin })
                  : testResult.error}
            </p>
          )}
          {/* A private-network server (LAN, Docker host, Tailscale) is refused by
              the desktop proxy until its origin is permitted (#2024). */}
          {testResult?.canGrant && proxyTrust && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={handleGrantWebdavPrivateAddress}
                disabled={testing}
                className={secondaryBtn}
              >
                {t('sync.form.vaultAllowPrivateAddress')}
              </button>
              <p className={`text-xs ${textSecondary}`}>{t('sync.form.vaultAllowPrivateAddressHint')}</p>
            </div>
          )}
          {/* Deliberately NOT gated on `cloudSyncStatus === 'error'`: the engine
              settles the status back to 'idle' on the line after it reports, so
              gating here hid every refusal (the absent-remote hold, an unverified
              write) and sync simply looked stopped. cloudSyncError is only ever
              set with a message and is cleared at the start of the next cycle. */}
          {cloudSyncError ? (
            <p className="text-xs text-red-500">{cloudSyncError}</p>
          ) : cloudSyncLastSynced ? (
            <p className={`text-xs ${textSecondary}`}>
              {t('common.lastSynced')}: {new Date(cloudSyncLastSynced).toLocaleString()}
            </p>
          ) : null}
          {/* Held from the first unreadable read until a sync succeeds, so the
              button does not come and go with the error text above (#2409). */}
          {cloudSyncRemoteUnreadable && cloudSyncReplaceRemote && (
            <SyncUnreadableRemoteNotice onReplace={cloudSyncReplaceRemote} darkMode={darkMode} />
          )}

          {migrationOldPath && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 space-y-1">
              <p className="font-semibold">{t('sync.form.migrationTitle')}</p>
              <p>{t('sync.form.migrationBody')}</p>
              <p className="font-mono break-all">{migrationOldPath} → GLANCE/dayglance/</p>
              <p>{t('sync.form.migrationInstruction')} <span className="font-mono">GLANCE/dayglance</span>.</p>
              <button
                onClick={() => {
                  localStorage.removeItem('dayglance-sync-migration-old-path');
                  localStorage.setItem('dayglance-sync-migration-checked', '1');
                }}
                className="text-amber-700 underline mt-1"
              >
                {t('common.dismiss')}
              </button>
            </div>
          )}
        </div>
      )}
      </SettingsCard>

      {/* ── GLANCEvault (Beta) ────────────────────────────────────────────── */}
      <SettingsCard
        cardId="vault"
        icon={Database}
        title={t('sync.form.vaultTitle')}
        hint={t('sync.form.vaultToggleHint')}
        switchLabel={t('sync.form.vaultToggle')}
        checked={vaultEnabled}
        onToggle={setVaultEnabled}
        summary={!vaultEnabled ? (
          <div className="space-y-2">
            <p className="text-amber-500 flex items-start gap-1.5">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{t('sync.form.vaultExperimentalWarning')}</span>
            </p>
            {vaultPaused && (
              <div className="flex items-center justify-between gap-3" data-vault-paused>
                <span>{t('sync.form.pausedKept')}</span>
                <button type="button" onClick={handleVaultDisconnect} className="text-red-500 hover:underline flex-shrink-0" data-vault-disconnect>
                  {t('sync.form.vaultDisconnect')}
                </button>
              </div>
            )}
          </div>
        ) : null}
        footer={cardActions({ id: 'vault', dirty: vaultIsDirty, canSave: vaultCanSave, busy: vaultBootstrapping, onSave: handleSaveVault, onCancel: handleCancelVault, saveLabel: vaultBootstrapping ? t('sync.form.enabling') : null })}
        darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
      >
        {!(vaultEnabled && vaultPro) && (
          <p className="text-xs text-amber-500 flex items-start gap-1.5">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>{t('sync.form.vaultExperimentalWarning')}</span>
          </p>
        )}
        {vaultEnabled && (
          <div className="space-y-3">
            <label className={`flex items-start gap-2 text-sm ${textPrimary} cursor-pointer`}>
              <input
                type="checkbox"
                checked={vaultPro}
                onChange={(e) => { setVaultPro(e.target.checked); setVaultTestResult(null); setVaultBootstrapError(null); }}
                className="mt-1"
                data-vault-pro
              />
              <span>
                <span className="block">{t('sync.form.vaultProToggle')}</span>
                <span className={`block text-xs ${textSecondary}`}>{t('sync.form.vaultProHint')}</span>
              </span>
            </label>
            {vaultPro ? (
              <div>
                {vaultProConnected && (
                  <p className={`text-xs ${textSecondary} mb-2`} data-vault-pro-connected>{t('sync.form.vaultProConnected')}</p>
                )}
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('sync.form.accountKeyLabel')}</label>
                <div className="relative">
                  <input
                    type={showAccountKey ? 'text' : 'password'}
                    placeholder="gvk_…"
                    value={vaultAccountKey}
                    onChange={(e) => setVaultAccountKey(e.target.value)}
                    autoComplete="off"
                    data-vault-account-key
                    className={`w-full px-3 py-2 pr-10 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowAccountKey(v => !v)}
                    aria-label={showAccountKey ? t('sync.form.hideAccountKey') : t('sync.form.showAccountKey')}
                    className={`absolute inset-y-0 right-0 flex items-center px-3 ${textSecondary}`}
                  >
                    {showAccountKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            ) : (<>
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('sync.form.vaultUrlLabel')}</label>
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
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('sync.form.deviceTokenLabel')}</label>
              <div className="relative">
                <input
                  type={showVaultToken ? 'text' : 'password'}
                  placeholder={t('sync.form.deviceTokenPlaceholder')}
                  value={vaultToken}
                  onChange={(e) => setVaultToken(e.target.value)}
                  className={`w-full px-3 py-2 pr-10 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                <button
                  type="button"
                  onClick={() => setShowVaultToken(v => !v)}
                  aria-label={showVaultToken ? t('sync.form.hideDeviceToken') : t('sync.form.showDeviceToken')}
                  className={`absolute inset-y-0 right-0 flex items-center px-3 ${textSecondary}`}
                >
                  {showVaultToken ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('sync.form.accountIdLabel')}</label>
              <input
                type="text"
                placeholder={t('sync.form.accountIdPlaceholder')}
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
                {vaultTesting ? t('settings.aiTesting') : t('settings.aiTestConnection')}
              </button>
            </div>
            {vaultTestResult && (
              <p className={`text-sm ${vaultTestResult.ok ? 'text-green-500' : 'text-red-500'}`}>
                {vaultTestResult.message}
              </p>
            )}
            {/* A private-network vault (LAN, Docker host, Tailscale) is refused by
                the desktop proxy until this origin is permitted. Offer the prompt
                right where the refusal is reported. */}
            {vaultTestResult?.canGrant && proxyTrust && (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={handleGrantPrivateAddress}
                  disabled={vaultTesting}
                  className={secondaryBtn}
                >
                  {t('sync.form.vaultAllowPrivateAddress')}
                </button>
                <p className={`text-xs ${textSecondary}`}>{t('sync.form.vaultAllowPrivateAddressHint')}</p>
              </div>
            )}
            </>)}
            <p className={`text-xs ${textSecondary}`}>{t('sync.form.vaultReloadHint')}</p>
            {!vaultEncryptionReady && (
              <p className="text-xs text-amber-500">
                {t('sync.form.vaultNeedsEncryption', { encryption: t('settings.enableE2EEncryption') })}
              </p>
            )}
            {vaultEncryptionReady && vaultFilled && vaultConnectionChanged && !getSyncPassphrase() && (
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('sync.form.syncPassphraseLabel')}</label>
                <input
                  type="password"
                  value={vaultPassphrase}
                  onChange={(e) => setVaultPassphrase(e.target.value)}
                  placeholder={t('sync.form.passphrasePlaceholderReenter')}
                  data-vault-passphrase
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                <p className={`text-xs ${textSecondary} mt-1`}>{t('sync.form.vaultNeedsPassphrase')}</p>
              </div>
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
                {(vaultSyncing || vaultStatus === 'uploading' || vaultStatus === 'downloading') ? t('common.syncing') : t('common.syncNow')}
              </button>
            </div>
            {vaultError && (
              <p className="text-xs text-red-500">{vaultError}</p>
            )}
            {/* Shown alongside an error too: the error is about the latest
                cycle (often a background one), and hiding the last good sync
                made it read as "nothing has synced" (#2035). */}
            {vaultLastSynced && (
              <p className={`text-xs ${textSecondary}`}>
                {t('common.lastSynced')}: {new Date(vaultLastSynced).toLocaleString()}
              </p>
            )}
            {vaultSkipped > 0 && (
              <p className="text-xs text-amber-500">
                {t('sync.form.vaultSkipped', { count: vaultSkipped })}
              </p>
            )}
          </>
        )}
      </SettingsCard>

      {afterChannels}

      {/* Sync proxy (Electron): the outbound proxy server sync traffic
          connects through, as a card like the channels above. Its own Save:
          the setting lives in the main process and applies to WebDAV and
          GLANCEvault alike, independent of the cloudSyncConfig Save below. */}
      {syncProxyApi && (
        <SettingsCard
          cardId="syncProxy"
          icon={Network}
          title={t('sync.form.syncProxyTitle')}
          hint={t('sync.form.syncProxyToggleHint')}
          switchLabel={t('sync.form.syncProxyToggle')}
          checked={proxyEnabled}
          onToggle={handleSyncProxyToggle}
          summary={!proxyEnabled && proxySaved?.host ? t('sync.form.pausedKept') : null}
          darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
        >
          <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('sync.form.syncProxyScheme')}</label>
                  <select
                    value={proxyScheme}
                    onChange={(e) => setProxyScheme(e.target.value)}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg ${darkMode ? 'bg-gray-700 text-white' : 'bg-stone-100 text-stone-900'}`}
                  >
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                    <option value="socks5">SOCKS5</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('sync.form.syncProxyHost')}</label>
                  <input
                    type="text"
                    placeholder="proxy.example.com"
                    value={proxyHost}
                    onChange={(e) => setProxyHost(e.target.value)}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                  />
                </div>
              </div>
              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('sync.form.syncProxyPort')}</label>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  placeholder="8080"
                  value={proxyPort}
                  onChange={(e) => setProxyPort(e.target.value)}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
              </div>
              {/* The one thing this feature cannot decide for the user: the same
                  private address means "reach it myself" on the LAN and "only
                  reachable through that proxy" when away, so it is asked, not
                  guessed. Loopback is never offered — it always connects
                  directly, in both modes. */}
              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('sync.form.syncProxyPrivate')}</label>
                <div className="space-y-1">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="syncProxyPrivate"
                      checked={proxyPrivate === 'direct'}
                      onChange={() => setProxyPrivate('direct')}
                      className="mt-1"
                    />
                    <span className={`text-sm ${textPrimary}`}>{t('sync.form.syncProxyPrivateDirect')}</span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="syncProxyPrivate"
                      checked={proxyPrivate === 'proxy'}
                      onChange={() => setProxyPrivate('proxy')}
                      className="mt-1"
                    />
                    <span className={`text-sm ${textPrimary}`}>{t('sync.form.syncProxyPrivateProxy')}</span>
                  </label>
                </div>
                <p className={`text-xs ${textSecondary} mt-0.5`}>{t('sync.form.syncProxyPrivateHint')}</p>
              </div>
              <div>
                <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('sync.form.syncProxyBypass')}</label>
                <input
                  type="text"
                  placeholder="192.168.1.0/24, *.internal"
                  value={proxyBypass}
                  onChange={(e) => setProxyBypass(e.target.value)}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none leading-normal text-base ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                <p className={`text-xs ${textSecondary} mt-0.5`}>{t('sync.form.syncProxyBypassHint')}</p>
              </div>
              {/* What this does NOT reach, said where it can be read: the two
                  limits the reviewer asked to state rather than document. */}
              <p className={`text-xs ${textSecondary}`}>{t('sync.form.syncProxyLimits')}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleSaveSyncProxy}
                  disabled={proxySaving}
                  className={secondaryBtn}
                >
                  {t('sync.form.syncProxySave')}
                </button>
                {proxySaveState && (
                  <p className={`text-sm ${proxySaveState.ok ? 'text-green-500' : 'text-red-500'}`}>
                    {proxySaveState.ok ? t('sync.form.syncProxySaved') : proxySaveState.reason}
                  </p>
                )}
              </div>
          </div>
        </SettingsCard>
      )}

      {/* Private addresses the desktop proxy may reach (#1642). Shared by
          WebDAV and GLANCEvault, so it sits outside both sections. */}
      {proxyTrust && trustedHosts.length > 0 && (
        <div className={`border-t ${borderClass} pt-4 space-y-1`}>
          <p className={sectionHeader}>{t('sync.form.vaultTrustedHostsTitle')}</p>
          <ul className="space-y-1">
            {trustedHosts.map((h) => (
              <li key={h.origin} className="flex items-center justify-between gap-2">
                <span className={`text-xs break-all ${textSecondary}`}>{h.origin}</span>
                <button
                  type="button"
                  onClick={() => handleRevokePrivateAddress(h.origin)}
                  className="text-xs text-red-500 hover:underline shrink-0"
                >
                  {t('sync.form.vaultTrustedHostRemove')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {afterProxy}

    </div>
  );
};

export default CloudSyncSettingsForm;
