import React, { useState } from 'react';
import { Check, Copy, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  collectICloudDiagnostics,
  formatDiagnosticsReport,
  formatBytes,
} from '../utils/icloudDiagnostics.js';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { directAccessTransport } from '../sync/directAccessTransport.js';
import { decryptData, getSyncPassphrase, hasEncryptionReady } from '../utils/crypto.js';

/**
 * Read-only readout of what this device sees in the iCloud container.
 *
 * Exists because the equivalent check via Safari Web Inspector needs a Debug or
 * TestFlight build, a Mac, a cable, and two settings toggles — and the TestFlight
 * half of that does not currently work (WebView.swift gates isInspectable on an
 * unreliable receipt check). This renders on any build.
 *
 * The line that matters is "Container": ICloudBridge.isAvailable() only asks
 * whether a path resolves, not whether iCloud is enabled for the app. Available
 * on a device where the user has switched dayGLANCE's iCloud toggle off means the
 * app is reading a store they believe is disabled.
 */
const ICloudDiagnostics = ({ darkMode, textPrimary, textSecondary, borderClass }) => {
  const { t } = useTranslation();
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  // The dry-run merge needs this device's payload; the app hands a builder
  // through the sync context. Null outside the app tree (tests), which simply
  // leaves the dry-run rows out.
  const syncCtx = useSyncCtx();

  // User-triggered, never on mount: readICloudSync is a SYNCHRONOUS bridge call
  // on iOS that returns the whole snapshot, so running it on render would block
  // the JS thread every time this pane opens.
  const run = async () => {
    setBusy(true);
    setCopied(false);
    try {
      setReport(await collectICloudDiagnostics({
        nativeBridge: typeof window !== 'undefined' ? window.DayGlanceNative : null,
        electronAPI: typeof window !== 'undefined' ? window.electronAPI : null,
        localStorage: typeof window !== 'undefined' ? window.localStorage : null,
        buildSyncPayload: syncCtx?.buildSyncPayload ?? null,
        getSyncRetentionDays: syncCtx?.getSyncRetentionDays ?? null,
        directAccess: directAccessTransport,
        decryptData,
        encryptionReady: () => hasEncryptionReady() || !!getSyncPassphrase(),
        usersPath: (() => { try { const raw = localStorage.getItem('dayglance-multi-user-config'); return raw ? (JSON.parse(raw).usersPath ?? undefined) : undefined; } catch { return undefined; } })(),
        eventsPath: (() => { try { const raw = localStorage.getItem('dayglance-intent-config'); return raw ? (JSON.parse(raw).eventsPath ?? undefined) : undefined; } catch { return undefined; } })(),
      }));
    } finally {
      setBusy(false);
    }
  };

  // Phase 8: merge and remove the copies now, then look again.
  const sweep = async () => {
    if (!syncCtx?.sweepConflictCopies) return;
    setSweeping(true);
    try { await syncCtx.sweepConflictCopies(); await run(); }
    finally { setSweeping(false); }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(formatDiagnosticsReport(report));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const Row = ({ label, value, tone }) => (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className={`text-xs ${textSecondary}`}>{label}</span>
      <span className={`text-xs font-mono text-right break-all ${tone || textPrimary}`}>{value}</span>
    </div>
  );

  const containerTone = (v) =>
    v === true ? 'text-amber-600 dark:text-amber-400'
      : v === false ? textSecondary
        : textSecondary;

  const snapshotLabel = (s) => t(`icloudDiag.state.${s.state}`, { defaultValue: s.state });

  const SnapshotRows = ({ snapshot }) => (
    <>
      <Row label={t('icloudDiag.snapshot')} value={snapshotLabel(snapshot)} />
      {/* Only when there are real file bytes. A sentinel response is the
          bridge's status object, not a file, and showing its length as a
          size reads as though a tiny file exists. */}
      {(snapshot.state === 'present' || snapshot.bytes > 0) && (
        <>
          <Row label={t('icloudDiag.size')} value={formatBytes(snapshot.bytes)} />
          <Row label={t('icloudDiag.lastModified')} value={snapshot.lastModified ?? t('icloudDiag.none')} />
          <Row
            label={t('icloudDiag.remoteCounts')}
            value={`${snapshot.taskCount ?? t('icloudDiag.none')} / ${snapshot.inboxCount ?? t('icloudDiag.none')}`}
          />
        </>
      )}
      {snapshot.error && (
        <Row label={t('icloudDiag.snapshotError')} value={snapshot.error} />
      )}
    </>
  );

  // The cycle's merge, run against the file without applying or writing,
  // through the same comparison the cycle decides by
  // (sync/snapshotMergeExplain.js). "Would write" and "would apply" are what
  // the cycle would do; the merge flags are what the merge said; the two lists
  // are what the result really differs in. A slice that differs on every run
  // with nothing edited is a value that cannot converge. This is how an idle
  // Mac rewriting the file every 15 s got named (2026-10-05).
  const MergeRows = ({ merge }) => {
    if (!merge) return null;
    if (merge.error) return <Row label={t('icloudDiag.mergeError')} value={merge.error} />;
    return (
      <>
        <Row
          label={t('icloudDiag.wouldWrite')}
          value={merge.wouldWrite ? t('icloudDiag.yes') : t('icloudDiag.no')}
          tone={merge.wouldWrite ? 'text-amber-600 dark:text-amber-400' : undefined}
        />
        <Row
          label={t('icloudDiag.wouldApply')}
          value={merge.wouldApply ? t('icloudDiag.yes') : t('icloudDiag.no')}
        />
        <Row
          label={t('icloudDiag.mergeFlags')}
          value={`${merge.remoteChanged ? t('icloudDiag.yes') : t('icloudDiag.no')} / ${merge.localChanged ? t('icloudDiag.yes') : t('icloudDiag.no')}`}
        />
        <Row
          label={t('icloudDiag.fileDiffers')}
          value={merge.fileDiffs.length ? merge.fileDiffs.map((d) => d.summary).join('; ') : t('icloudDiag.none')}
        />
        <Row
          label={t('icloudDiag.deviceDiffers')}
          value={merge.deviceDiffs.length ? merge.deviceDiffs.map((d) => d.summary).join('; ') : t('icloudDiag.none')}
        />
        {merge.flagWithoutDiff && (
          <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded p-2">
            {merge.writeFlagWithoutDiff && merge.applyFlagWithoutDiff
              ? t('icloudDiag.bothFlagsWithoutDiff')
              : merge.applyFlagWithoutDiff
                ? t('icloudDiag.applyFlagWithoutDiff')
                : t('icloudDiag.flagWithoutDiff')}
          </p>
        )}
      </>
    );
  };

  return (
    <div className={`rounded-lg border ${borderClass} p-3 space-y-2`}>
      <div className="flex items-center justify-between gap-2">
        <div className={`text-sm font-medium ${textPrimary} flex items-center gap-2`}>
          <Stethoscope size={15} className={textSecondary} />
          {t('icloudDiag.title')}
        </div>
        <button
          onClick={run}
          disabled={busy}
          className={`text-xs px-2 py-1 rounded ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} disabled:opacity-60`}
        >
          {busy ? t('icloudDiag.running') : t('icloudDiag.run')}
        </button>
      </div>

      <p className={`text-xs ${textSecondary}`}>{t('icloudDiag.hint')}</p>

      {report && (
        <>
          <div className="pt-1">
            <Row label={t('icloudDiag.platform')} value={t(`icloudDiag.platformName.${report.platform}`, { defaultValue: report.platform })} />
            {/* The iCloud rows only where iCloud exists; elsewhere they could
                only say "not probeable / unsupported / never". The Direct
                Access block below has always been conditional the same way. */}
            {(report.icloud ?? true) && (<>
            <Row
              label={t('icloudDiag.container')}
              value={
                report.available.value === null
                  ? t('icloudDiag.notProbeable')
                  : report.available.value
                    ? t('icloudDiag.available')
                    : t('icloudDiag.unavailable')
              }
              tone={containerTone(report.available.value)}
            />
            {report.available.error && (
              <Row label={t('icloudDiag.containerError')} value={report.available.error} />
            )}
            <SnapshotRows snapshot={report.snapshot} />

            {/* The in-app preference, which #1333's "start fresh on this device"
                sets. Without this row a device with a perfectly reachable
                container but sync deliberately switched off looks identical to a
                healthy one. */}
            <Row
              label={t('icloudDiag.syncPref')}
              value={report.syncEnabled ? t('icloudDiag.on') : t('icloudDiag.off')}
              tone={report.syncEnabled ? undefined : 'text-amber-600 dark:text-amber-400'}
            />

            {/* iCloud's own sync record. Until it existed this panel could only
                show the WebDAV key, so an iCloud-only device always read "never"
                — true of WebDAV, and silent about the tier it actually used. */}
            <Row label={t('icloudDiag.icloudSynced')} value={report.transports.icloud?.lastSynced ?? t('icloudDiag.never')} />
            </>)}

            {/* The other transports. Without these, an unavailable container
                leaves "so where did this data come from?" unanswerable. */}
            <Row
              label={t('icloudDiag.webdav')}
              value={report.transports.webdav.configured
                ? `${t('icloudDiag.configured')} (${report.transports.webdav.provider ?? '?'})`
                : t('icloudDiag.notConfigured')}
            />
            <Row label={t('icloudDiag.webdavSynced')} value={report.transports.webdav.lastSynced ?? t('icloudDiag.never')} />
            <Row
              label={t('icloudDiag.vault')}
              value={report.transports.vault.configured ? t('icloudDiag.configured') : t('icloudDiag.notConfigured')}
            />
            <Row label={t('icloudDiag.vaultSynced')} value={report.transports.vault.lastSynced ?? t('icloudDiag.never')} />
            {report.transports.vault.hasConfig && (
              <>
                <Row
                  label={t('icloudDiag.vaultConfig')}
                  value={[report.transports.vault.enabled, report.transports.vault.hasUrl, report.transports.vault.hasToken, report.transports.vault.hasAccountId]
                    .map((v) => (v ? t('icloudDiag.yes') : t('icloudDiag.no'))).join(' / ')}
                  tone={report.transports.vault.configured ? undefined : 'text-amber-600 dark:text-amber-400'}
                />
                <Row
                  label={t('icloudDiag.vaultCursor')}
                  value={`${report.transports.vault.highWaterMark ?? t('icloudDiag.none')} / ${report.transports.vault.pushAck ?? t('icloudDiag.none')}`}
                />
                <Row
                  label={t('icloudDiag.vaultRows')}
                  value={`${report.transports.vault.dirtyCount} / ${report.transports.vault.quarantineCount}`}
                  tone={report.transports.vault.quarantineCount > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}
                />
                {report.transports.vault.credentialHalt && (
                  <Row
                    label={t('icloudDiag.vaultHalt')}
                    value={`${report.transports.vault.credentialHalt.at ?? '?'} ${report.transports.vault.credentialHalt.message ?? ''}`}
                    tone="text-amber-600 dark:text-amber-400"
                  />
                )}
              </>
            )}

            <Row
              label={t('icloudDiag.localCounts')}
              value={`${report.local.taskCount} / ${report.local.inboxCount}`}
            />

            {(report.icloud ?? true) && <MergeRows merge={report.merge} />}
          </div>

          {/* The Direct Access folder, on platforms that have the bridge: the
              same file readout and dry run, through the transport the cycle
              uses. Two Macs trading rewrites of an identical Nextcloud file
              while the iCloud file held still (2026-10-05) could not be
              explained from this panel until it looked at that file too. */}
          {report.directAccess && (
            <div className={`pt-2 border-t ${borderClass}`}>
              <p className={`text-xs font-medium ${textPrimary} pb-1`}>{t('icloudDiag.directAccessTitle')}</p>
              <Row
                label={t('icloudDiag.folder')}
                value={report.directAccess.name ?? t('icloudDiag.none')}
              />
              <Row
                label={t('icloudDiag.folderStatus')}
                value={t(`icloudDiag.folderState.${report.directAccess.status}`, { defaultValue: report.directAccess.status })}
                tone={report.directAccess.status === 'unreachable' ? 'text-amber-600 dark:text-amber-400' : undefined}
              />
              <Row
                label={t('icloudDiag.syncPref')}
                value={report.directAccess.enabled === false ? t('icloudDiag.off') : t('icloudDiag.on')}
              />
              {report.directAccess.snapshot && <SnapshotRows snapshot={report.directAccess.snapshot} />}
              {report.directAccess.snapshot?.state === 'present' && (
                <Row label={t('icloudDiag.encryption')} value={report.directAccess.snapshot.encrypted ? t('icloudDiag.envelope') : t('icloudDiag.plaintext')} />
              )}
              {report.directAccess.snapshot && (
                <Row label={t('icloudDiag.encryptSwitch')} value={report.directAccess.encrypt ? t('icloudDiag.on') : t('icloudDiag.off')} />
              )}
              {report.directAccess.snapshot && report.directAccess.keyReady !== null && report.directAccess.keyReady !== undefined && (
                <Row
                  label={t('icloudDiag.key')}
                  value={report.directAccess.keyReady ? t('icloudDiag.keyReady') : t('icloudDiag.keyNeeded')}
                  tone={report.directAccess.keyReady ? undefined : 'text-amber-600 dark:text-amber-400'}
                />
              )}
              <MergeRows merge={report.directAccess.merge} />
              {Array.isArray(report.directAccess.conflicts) && (
                <>
                  <Row
                    label={t('icloudDiag.conflictCopies')}
                    value={report.directAccess.conflicts.length === 0 ? t('icloudDiag.none') : String(report.directAccess.conflicts.length)}
                    tone={report.directAccess.conflicts.length > 0 ? 'text-amber-600 dark:text-amber-400' : undefined}
                  />
                  {report.directAccess.conflicts.map((c) => (
                    <p key={c.rel} className={`text-xs font-mono break-all pl-3 ${textSecondary}`}>{c.name}</p>
                  ))}
                  {report.directAccess.lastSweep && (
                    <Row
                      label={t('icloudDiag.lastSweep')}
                      value={`${new Date(report.directAccess.lastSweep.at).toLocaleString()} · ${t('icloudDiag.sweepCounts', {
                        merged: report.directAccess.lastSweep.copies.filter((c) => c.outcome === 'merged').length,
                        removed: report.directAccess.lastSweep.copies.filter((c) => c.outcome === 'removed').length,
                        left: report.directAccess.lastSweep.copies.filter((c) => !['merged', 'removed'].includes(c.outcome)).length,
                      })}`}
                    />
                  )}
                  {report.directAccess.conflicts.length > 0 && syncCtx?.sweepConflictCopies && (
                    <button
                      type="button"
                      onClick={sweep}
                      disabled={sweeping || busy}
                      className={`mt-1 px-3 py-1.5 text-xs rounded-lg border ${borderClass} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'} ${textPrimary} disabled:opacity-50`}
                    >
                      {sweeping ? t('icloudDiag.sweeping') : t('icloudDiag.sweep')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Flag the state the user would want to know about but cannot see:
              this device holds data and is NOT syncing it anywhere.

              The previous version fired on `available && snapshot present`, which
              is the NORMAL working state for every iCloud user — it dated from the
              hypothesis that the app read containers the user had disabled, and
              on-device testing disproved that (the probe correctly reports false
              when iCloud is off). So it told healthy users their setup was broken.
              Warn about sync being off, not about sync working. */}
          {report.local.taskCount > 0 && (report.available.value === false || !report.syncEnabled) && (
            <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded p-2">
              {t('icloudDiag.notSyncingNote')}
            </p>
          )}

          <button
            onClick={copy}
            className={`text-xs flex items-center gap-1.5 ${textSecondary} hover:underline`}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? t('icloudDiag.copied') : t('icloudDiag.copy')}
          </button>
        </>
      )}
    </div>
  );
};

export default ICloudDiagnostics;
