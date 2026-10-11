import React, { useEffect, useState } from 'react';
import { FolderOpen, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import useDirectAccessStatus from '../hooks/useDirectAccessStatus.js';
import { isNativeAndroid, isNativeIOS } from '../native.js';
import { directAccessTransport, DIRECT_ACCESS_LAST_SYNCED_KEY } from '../sync/directAccessTransport.js';
import { getSyncPassphrase, hasEncryptionReady, setupEncryptionKey, decryptData, isEncryptedEnvelope } from '../utils/crypto.js';
import { removeDirectAccessEncryption } from '../sync/directAccessEncryption.js';
import { getDirectAccessIntentsEnabledFlag } from '../intents/directAccessIntentsConfig.js';

/**
 * Settings → Cloud Sync: the Direct Access card (docs/direct-access-sync.md).
 *
 * Shows the connection, offers the native picker (a folder on desktop and
 * Android, the sync file itself on iPhone and iPad), and carries the
 * per-device on/off switch, which mirrors ICloudSyncToggle: turning it off is
 * inert, not destructive — the shared copy and the other devices are untouched.
 *
 * The encryption switch (Phase 6) uses the file-tier key WebDAV encryption
 * uses, so a device that already has that key just flips it; one without is
 * asked for the sync passphrase first (`crypto` is injectable for tests).
 */
/**
 * What a tap on the encryption switch does. The switch flips at once when a
 * key (or the passphrase) is in memory; otherwise the passphrase fields open
 * and the switch turns on with them. Turning it off never touches the file
 * (the file decides, docs/direct-access-sync.md Phase 6).
 */
export const decideEncryptToggle = ({ encrypt, keyInMemory }) => (encrypt ? 'off' : keyInMemory ? 'on' : 'ask');

/**
 * Turns the switch on from a freshly chosen passphrase: derives and caches
 * the file-tier key first, so the upgrade the kick writes can be sealed.
 * Returns `{ ok: true }` or `{ ok: false, error }` with the message to show.
 */
export async function turnOnEncryption({ passphrase, confirm, setupEncryptionKey, transport, t }) {
  const p = (passphrase ?? '').trim();
  if (!p) return { ok: false, error: null };
  if (p !== (confirm ?? '').trim()) return { ok: false, error: t('sync.form.passphraseMismatch') };
  try {
    await setupEncryptionKey(p);
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
  transport.setEncryptsWrites(true);
  return { ok: true };
}

const DirectAccessSyncCard = ({ darkMode, textPrimary, textSecondary, borderClass, multiUserEnabled = false, transport = directAccessTransport, crypto = { getSyncPassphrase, hasEncryptionReady, setupEncryptionKey, decryptData, isEncryptedEnvelope } }) => {
  const { t } = useTranslation();
  const status = useDirectAccessStatus(transport);
  const [busy, setBusy] = useState(false);

  // Phase 8: the one sanctioned downgrade, behind a confirmation. Offered
  // when this device holds the key; the action itself says whether the file
  // was an envelope.
  const [removeStep, setRemoveStep] = useState(null);   // null | 'confirm' | {outcome, detail}
  const removeEncryption = async () => {
    setBusy(true);
    try {
      const r = await removeDirectAccessEncryption({ transport, io: { decryptData: crypto.decryptData ?? decryptData, isEncryptedEnvelope: crypto.isEncryptedEnvelope ?? isEncryptedEnvelope } });
      setRemoveStep(r);
    } finally { setBusy(false); }
  };

  const [askPassphrase, setAskPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [passphraseError, setPassphraseError] = useState(null);
  const toggleEncrypt = () => {
    const keyInMemory = crypto.hasEncryptionReady() || !!crypto.getSyncPassphrase();
    const action = decideEncryptToggle({ encrypt: !!status.encrypt, keyInMemory });
    if (action === 'off') { transport.setEncryptsWrites(false); setAskPassphrase(false); return; }
    if (action === 'on') { transport.setEncryptsWrites(true); return; }
    setPassphrase(''); setPassphraseConfirm(''); setPassphraseError(null);
    setAskPassphrase(true);
  };
  const submitPassphrase = async (e) => {
    e?.preventDefault?.();
    setBusy(true);
    try {
      const r = await turnOnEncryption({ passphrase, confirm: passphraseConfirm, setupEncryptionKey: crypto.setupEncryptionKey, transport, t });
      if (r.ok) { setAskPassphrase(false); setPassphrase(''); setPassphraseConfirm(''); setPassphraseError(null); }
      else setPassphraseError(r.error);
    } finally { setBusy(false); }
  };

  // The cycle stamps this on every real read; re-read it while the card is open.
  const readLastSynced = () => {
    try { return localStorage.getItem(DIRECT_ACCESS_LAST_SYNCED_KEY); } catch { return null; }
  };
  const [lastSynced, setLastSynced] = useState(readLastSynced);
  useEffect(() => {
    setLastSynced(readLastSynced());
    const timer = setInterval(() => setLastSynced(readLastSynced()), 15 * 1000);
    return () => clearInterval(timer);
  }, [status.status]);

  // On iPhone and iPad the bookmark is of the sync file, not the folder: the
  // Files providers (Nextcloud, Drive, Dropbox) cannot hand over a folder
  // (DirectAccessBridge.swift). So the card offers the file: pick the one a
  // device already seeded, or create it in a folder for a first device.
  const ios = isNativeIOS();
  const run = (fn) => async () => {
    setBusy(true);
    try { await fn(); }
    finally { setBusy(false); }
  };
  const pick = run(() => (ios ? transport.pickFile() : transport.pickFolder()));
  const create = run(() => transport.createFile());
  // The household roster on an iPhone is a second bookmarked file (Phase 5):
  // the same two flows, for glance-users.json.
  const pickRoster = run(() => transport.pickUsersFile());
  const createRoster = run(() => transport.createUsersFile());
  const forgetRoster = run(() => transport.forgetUsersFile());
  const roster = status.roster;
  // The intents event set on an iPhone is a third bookmarked file (Phase 7),
  // offered once the Direct Access intents opt-in is on.
  const pickEvents = run(() => transport.pickEventsFile());
  const createEvents = run(() => transport.createEventsFile());
  const forgetEvents = run(() => transport.forgetEventsFile());
  const events = status.events;
  const intentsOn = getDirectAccessIntentsEnabledFlag();
  const disconnect = async () => {
    setBusy(true);
    try { await transport.disconnect(); }
    finally { setBusy(false); }
  };
  const toggle = () => transport.setEnabled(!status.enabled);

  const button = `px-3 py-1.5 text-sm rounded-lg border ${borderClass} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${textPrimary} disabled:opacity-50`;

  return (
    <div className={`rounded-lg border ${borderClass} p-3 space-y-3`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${textPrimary} flex items-center gap-2`}>
            <FolderOpen size={14} className={textSecondary} />
            {t('directAccess.title')}
          </p>
          <p className={`text-xs ${textSecondary}`}>{t('directAccess.desc')}</p>
          {/* The Google Drive and Dropbox apps do not offer a folder tree to the
              Android picker; only an app that mirrors to local storage works. */}
          {isNativeAndroid() && (
            <p className={`text-xs ${textSecondary} mt-1`}>{t('directAccess.androidHint')}</p>
          )}
          {isNativeIOS() && (
            <p className={`text-xs ${textSecondary} mt-1`}>{t('directAccess.iosHint')}</p>
          )}
        </div>
        {status.connected && (
          <button
            type="button"
            onClick={toggle}
            role="switch"
            aria-checked={status.enabled}
            aria-label={t('directAccess.title')}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${
              status.enabled ? 'bg-green-500' : darkMode ? 'bg-gray-600' : 'bg-stone-300'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
                status.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        )}
      </div>

      {/* Why the last pick failed, from the shell (no bookmark, no result).
          Without this a failed pick looked exactly like a cancelled one. */}
      {status.pickError && (
        <p className="text-xs text-red-700 dark:text-red-300 break-words">
          {t('directAccess.pickFailed', { reason: status.pickError })}
        </p>
      )}
      {!status.connected ? (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className={`text-xs ${textSecondary}`}>{ios ? t('directAccess.notConnectedFile') : t('directAccess.notConnected')}</p>
          <div className="flex gap-2">
            <button type="button" onClick={pick} disabled={busy || status.status === 'unknown'} className={button}>
              {ios ? t('directAccess.chooseFile') : t('directAccess.chooseFolder')}
            </button>
            {ios && (
              <button type="button" onClick={create} disabled={busy || status.status === 'unknown'} className={button}>
                {t('directAccess.createFile')}
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0">
            <p className={`text-sm ${textPrimary} truncate`} title={status.path ?? undefined}>
              {t('directAccess.connectedTo')} <span className="font-medium">{status.name}</span>
            </p>
            {status.status === 'unreachable' ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">{t('directAccess.unreachable')}</p>
            ) : (
              <p className={`text-xs ${textSecondary}`}>
                {status.enabled ? t('directAccess.onHint') : t('directAccess.offHint')}
              </p>
            )}
            <p className={`text-xs ${textSecondary}`}>
              {lastSynced
                ? `${t('common.lastSynced')}: ${new Date(lastSynced).toLocaleString()}`
                : t('directAccess.neverSynced')}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={pick} disabled={busy} className={button}>
              {ios ? t('directAccess.changeFile') : t('directAccess.changeFolder')}
            </button>
            <button type="button" onClick={disconnect} disabled={busy} className={button}>
              {t('directAccess.disconnect')}
            </button>
          </div>
          <div className={`pt-2 border-t ${borderClass} space-y-2`}>
            <label className="flex items-start gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!status.encrypt || askPassphrase}
                onChange={toggleEncrypt}
                disabled={busy}
                className="mt-0.5 w-4 h-4 rounded flex-shrink-0"
                aria-label={t('directAccess.encrypt')}
              />
              <span className="min-w-0">
                <span className={`text-sm ${textPrimary} flex items-center gap-1.5`}>
                  <Lock size={12} className={textSecondary} />
                  {t('directAccess.encrypt')}
                </span>
                <span className={`block text-xs ${textSecondary}`}>
                  {status.encrypt ? t('directAccess.encryptOnHint') : t('directAccess.encryptHint')}
                </span>
              </span>
            </label>
            {askPassphrase && !status.encrypt && (
              <form onSubmit={submitPassphrase} className="ml-7 space-y-2">
                <p className={`text-xs ${textSecondary}`}>{t('directAccess.encryptPassphraseHint')}</p>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t('sync.form.passphrasePlaceholderNew')}
                  aria-label={t('sync.form.syncPassphraseLabel')}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                <input
                  type="password"
                  value={passphraseConfirm}
                  onChange={(e) => setPassphraseConfirm(e.target.value)}
                  placeholder={t('sync.form.confirmPassphrasePlaceholder')}
                  aria-label={t('sync.form.confirmPassphraseLabel')}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                />
                {passphraseError && <p className="text-xs text-red-600 dark:text-red-400">{passphraseError}</p>}
                <div className="flex gap-2">
                  <button type="submit" disabled={busy || !passphrase.trim()} className={button}>{t('directAccess.encryptTurnOn')}</button>
                  <button type="button" disabled={busy} onClick={() => setAskPassphrase(false)} className={button}>{t('common.cancel')}</button>
                </div>
              </form>
            )}
            {(crypto.hasEncryptionReady() || !!crypto.getSyncPassphrase()) && (
              <div className="ml-7 space-y-2">
                {removeStep === null && (
                  <button type="button" onClick={() => setRemoveStep('confirm')} disabled={busy} className={`text-xs underline ${textSecondary}`}>
                    {t('directAccess.removeEncryption')}
                  </button>
                )}
                {removeStep === 'confirm' && (
                  <>
                    <p className={`text-xs ${textSecondary}`}>{t('directAccess.removeEncryptionConfirm')}</p>
                    <div className="flex gap-2">
                      <button type="button" onClick={removeEncryption} disabled={busy} className={button}>{t('directAccess.removeEncryptionGo')}</button>
                      <button type="button" onClick={() => setRemoveStep(null)} disabled={busy} className={button}>{t('common.cancel')}</button>
                    </div>
                  </>
                )}
                {removeStep && typeof removeStep === 'object' && (
                  <p className={`text-xs ${removeStep.outcome === 'removed' || removeStep.outcome === 'already-plaintext' ? textSecondary : 'text-red-700 dark:text-red-300'}`} data-remove-outcome={removeStep.outcome}>
                    {t(`directAccess.removeEncryptionOutcome.${removeStep.outcome}`, { detail: removeStep.detail ?? '' })}
                    {' '}
                    <button type="button" onClick={() => setRemoveStep(null)} className="underline">{t('common.ok')}</button>
                  </p>
                )}
              </div>
            )}
          </div>
          {ios && multiUserEnabled && roster && (
            <div className={`pt-2 border-t ${borderClass} space-y-2`}>
              <p className={`text-xs ${textSecondary}`}>{t('directAccess.iosRosterHint')}</p>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className={`text-xs ${textPrimary}`} title={roster.path ?? undefined}>
                  {roster.configured
                    ? t('directAccess.rosterChosen', { name: roster.name })
                    : t('directAccess.rosterNotChosen')}
                </p>
                <div className="flex gap-2">
                  {roster.configured ? (
                    <>
                      <button type="button" onClick={pickRoster} disabled={busy} className={button}>{t('directAccess.rosterChange')}</button>
                      <button type="button" onClick={forgetRoster} disabled={busy} className={button}>{t('directAccess.rosterForget')}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={pickRoster} disabled={busy} className={button}>{t('directAccess.rosterChoose')}</button>
                      <button type="button" onClick={createRoster} disabled={busy} className={button}>{t('directAccess.rosterCreate')}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
          {ios && intentsOn && events && (
            <div className={`pt-2 border-t ${borderClass} space-y-2`}>
              <p className={`text-xs ${textSecondary}`}>{t('directAccess.iosEventsHint')}</p>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className={`text-xs ${textPrimary}`} title={events.path ?? undefined}>
                  {events.configured
                    ? t('directAccess.eventsChosen', { name: events.name })
                    : t('directAccess.eventsNotChosen')}
                </p>
                <div className="flex gap-2">
                  {events.configured ? (
                    <>
                      <button type="button" onClick={pickEvents} disabled={busy} className={button}>{t('directAccess.eventsChange')}</button>
                      <button type="button" onClick={forgetEvents} disabled={busy} className={button}>{t('directAccess.eventsForget')}</button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={pickEvents} disabled={busy} className={button}>{t('directAccess.eventsChoose')}</button>
                      <button type="button" onClick={createEvents} disabled={busy} className={button}>{t('directAccess.eventsCreate')}</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DirectAccessSyncCard;
