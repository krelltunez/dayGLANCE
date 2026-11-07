// GLANCElauncher in Settings (utils/launcherPromo.js says who sees it, and
// when): a one-time card at the top of the mobile Settings page, and a
// permanent entry under Integrations, so the link can still be found once the
// card is dismissed. Both open the flavour's link the way every external link
// in the app does, an anchor the Android shell hands to a Custom Tab.
import React, { useCallback, useState } from 'react';
import { ExternalLink, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SettingsCard from './settings/SettingsCard.jsx';
import {
  readLauncherPromoInfo, launcherPromoUrl, launcherPromoStore,
  shouldShowLauncherPromoCard, dismissLauncherPromo,
} from '../utils/launcherPromo.js';

/**
 * The launcher's link on this device (null where it is not offered), whether
 * the one-time card shows, and its dismiss. The native facts are read once
 * per mount.
 */
export function useLauncherPromo({ readInfo = readLauncherPromoInfo, storage, now } = {}) {
  const [info] = useState(() => readInfo());
  const url = launcherPromoUrl(info);
  const [showCard, setShowCard] = useState(() => shouldShowLauncherPromoCard(info, { storage, now }));
  const dismiss = useCallback(() => {
    dismissLauncherPromo({ storage });
    setShowCard(false);
  }, [storage]);
  return { url, showCard, dismiss };
}

const LINK_LABEL_KEY = {
  github: 'settings.launcherPromo.viewOnGithub',
  play: 'settings.launcherPromo.getOnPlay',
  other: 'settings.launcherPromo.getIt',
};

function LauncherPromoLink({ url, className }) {
  const { t } = useTranslation();
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-launcher-promo-link
      className={className}
    >
      <ExternalLink size={14} />
      {t(LINK_LABEL_KEY[launcherPromoStore(url)])}
    </a>
  );
}

/** The one-time card: the launcher, its link, and Not now. */
export function LauncherPromoCard({ url, onDismiss, cardBg = '', borderClass = '', textPrimary = '', textSecondary = '' }) {
  const { t } = useTranslation();
  return (
    <section data-launcher-promo-card className={`${cardBg} border ${borderClass} rounded-xl p-4 space-y-2`}>
      <div className="flex items-center gap-2">
        <Smartphone size={18} className={`${textSecondary} flex-shrink-0`} />
        <h3 className={`font-medium ${textPrimary}`}>{t('settings.launcherPromo.title')}</h3>
      </div>
      <p className={`text-xs ${textSecondary}`}>{t('settings.launcherPromo.body')}</p>
      <div className="flex items-center gap-2 pt-1">
        <LauncherPromoLink
          url={url}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white"
        />
        <button
          type="button"
          data-launcher-promo-dismiss
          onClick={onDismiss}
          className={`flex-1 py-2 rounded-lg text-sm font-medium border ${borderClass} ${textPrimary}`}
        >
          {t('settings.launcherPromo.notNow')}
        </button>
      </div>
    </section>
  );
}

/** The permanent Integrations entry: the same text and link, never dismissed. */
export function LauncherPromoEntry({ url, darkMode, borderClass = '', textPrimary = '', textSecondary = '' }) {
  const { t } = useTranslation();
  return (
    <SettingsCard
      cardId="glanceLauncher"
      collapsible
      icon={Smartphone}
      title={t('settings.launcherPromo.title')}
      darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
    >
      <div className="space-y-2" data-launcher-promo-entry>
        <p className={`text-xs ${textSecondary}`}>{t('settings.launcherPromo.body')}</p>
        <LauncherPromoLink
          url={url}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-500 hover:text-blue-400"
        />
      </div>
    </SettingsCard>
  );
}
