import React, { useState } from 'react';
import { Check, Copy, Stethoscope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  collectICloudDiagnostics,
  formatDiagnosticsReport,
  formatBytes,
} from '../utils/icloudDiagnostics.js';

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

  // User-triggered, never on mount: readICloudSync is a SYNCHRONOUS bridge call
  // on iOS that returns the whole snapshot, so running it on render would block
  // the JS thread every time this pane opens.
  const run = async () => {
    setBusy(true);
    setCopied(false);
    try {
      setReport(await collectICloudDiagnostics());
    } finally {
      setBusy(false);
    }
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
            <Row label={t('icloudDiag.platform')} value={report.platform} />
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
            <Row label={t('icloudDiag.snapshot')} value={snapshotLabel(report.snapshot)} />
            {/* Only when there are real file bytes. A sentinel response is the
                bridge's status object, not a file, and showing its length as a
                size reads as though a tiny file exists. */}
            {(report.snapshot.state === 'present' || report.snapshot.bytes > 0) && (
              <>
                <Row label={t('icloudDiag.size')} value={formatBytes(report.snapshot.bytes)} />
                <Row label={t('icloudDiag.lastModified')} value={report.snapshot.lastModified ?? t('icloudDiag.none')} />
                <Row
                  label={t('icloudDiag.remoteCounts')}
                  value={`${report.snapshot.taskCount ?? t('icloudDiag.none')} / ${report.snapshot.inboxCount ?? t('icloudDiag.none')}`}
                />
              </>
            )}
            {report.snapshot.error && (
              <Row label={t('icloudDiag.snapshotError')} value={report.snapshot.error} />
            )}

            {/* iCloud's own sync record. Until it existed this panel could only
                show the WebDAV key, so an iCloud-only device always read "never"
                — true of WebDAV, and silent about the tier it actually used. */}
            <Row label={t('icloudDiag.icloudSynced')} value={report.transports.icloud?.lastSynced ?? t('icloudDiag.never')} />

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

            <Row
              label={t('icloudDiag.localCounts')}
              value={`${report.local.taskCount} / ${report.local.inboxCount}`}
            />
          </div>

          {/* The finding worth calling out: a resolvable container is exactly what
              a user who has switched iCloud off does not expect to see. */}
          {report.available.value === true && report.snapshot.state === 'present' && (
            <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded p-2">
              {t('icloudDiag.readingNote')}
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
