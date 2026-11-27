import React from 'react';
import { useTranslation } from 'react-i18next';
import { Unlink } from 'lucide-react';

/**
 * The badge an Inbox row shows when its task names a project this device does
 * not hold (utils/inboxFilter.js hasMissingProject). Showing the task is
 * display only; Unlink is the one write, a deliberate user edit that makes the
 * task standalone (App.jsx unlinkMissingProject).
 */
export default function MissingProjectBadge({ onUnlink }) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] pl-1.5 pr-0.5 py-0.5 rounded-full bg-black/25 text-white font-medium flex-shrink-0"
      title={t('inbox.projectMissingHint')}
      data-testid="missing-project-badge"
    >
      {t('inbox.projectMissing')}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onUnlink?.(); }}
        className="inline-flex items-center gap-0.5 px-1 rounded-full bg-white/25 hover:bg-white/40 transition-colors"
        aria-label={t('inbox.unlinkProject')}
      >
        <Unlink size={9} />
        {t('inbox.unlinkProject')}
      </button>
    </span>
  );
}
