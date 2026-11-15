import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

// The way out of a sync file on the server that cannot be read (#2409), shown
// in the sync settings for as long as it stays that way (the error text is on
// the line above it).
//
// The button does not overwrite on its word alone: `onReplace` reads the file
// once more and replaces it only if that read is unreadable too
// (replaceUnreadableRemote in sync/adapter.js). When it works, a sync succeeds
// and this notice goes away with the error, so the only outcome it has to
// speak for itself is the one where nothing was replaced.
export default function SyncUnreadableRemoteNotice({ onReplace, darkMode }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const replace = async () => {
    if (busy || !onReplace) return;
    setBusy(true);
    setFailed(false);
    let outcome = 'failed';
    try { outcome = (await onReplace())?.outcome ?? 'failed'; } catch { outcome = 'failed'; }
    setBusy(false);
    // 'not-needed' ran an ordinary cycle, which reports for itself.
    setFailed(outcome === 'failed' || outcome === 'busy' || outcome === 'disabled');
  };

  return (
    <div
      data-sync-unreadable-remote
      role="alert"
      className={`rounded-lg border px-3 py-2.5 text-xs space-y-2 ${darkMode ? 'bg-red-900/20 border-red-800 text-red-200' : 'bg-red-50 border-red-200 text-red-800'}`}
    >
      <p className="flex items-start gap-2">
        <AlertTriangle size={14} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>{t('sync.form.replaceRemoteHint')}</span>
      </p>
      <button
        type="button"
        data-sync-replace-remote
        onClick={replace}
        disabled={busy}
        className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
      >
        {t('sync.form.replaceRemote')}
      </button>
      {failed && <p data-sync-replace-failed>{t('sync.form.replaceRemoteFailed')}</p>}
    </div>
  );
}
