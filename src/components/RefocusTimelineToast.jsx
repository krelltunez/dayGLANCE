import React from 'react';
import { Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// "Refocus timeline": the pill that appears when the now line has been
// scrolled out of view, and brings it back. One component for every
// timeline that scrolls (MULTI, JOBO), so they look and read the same.
export default function RefocusTimelineToast({ onRefocus, isMobile = false }) {
  const { t } = useTranslation();
  return (
    <div data-refocus-timeline className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-auto" style={{ bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom, 0px))' : '1.5rem' }}>
      <button
        type="button"
        onClick={onRefocus}
        className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium bg-blue-600 text-white active:bg-blue-700 transition-opacity"
      >
        <Clock size={14} />
        <span>{t('app.refocusTimeline')}</span>
      </button>
    </div>
  );
}
