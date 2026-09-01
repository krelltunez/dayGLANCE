import React from 'react';
import Wordmark from './Wordmark';
import {
  BarChart3, Calendar, ChevronLeft, ChevronRight,
  Cloud, Eye, FileUp, Filter, Flag, Inbox, Mic, NotebookPen,
  RefreshCw, Search, Settings, Target, Trash2, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { isFileSystemAccessSupported } from '../obsidian.js';
import { isNativeApp } from '../native.js';

const MobileWelcomeModal = () => {
  const { t } = useTranslation();
  const {
    setShowWelcome,
    mobileWelcomeStep, setMobileWelcomeStep,
    setShowSettings,
    darkMode, textPrimary, textSecondary,
  } = useDayPlannerCtx();
  // Restore entry point for returning users (the welcome modal shows exactly
  // when the app has no data). Mobile browsers lack the File System Access
  // API, so this is always the plain backup-file picker here.
  const { restoreBackup } = useSyncCtx();
  // Obsidian needs the File System Access API (Chromium desktop) or a native
  // bridge; hide the onboarding mention where it can't actually be enabled.
  const obsidianAvailable = isFileSystemAccessSupported() || isNativeApp();

  return (
    <div className={`fixed inset-0 z-50 flex flex-col ${darkMode ? 'bg-gray-800' : 'bg-white'}`}>
      {/* Progress dots */}
      <div className="flex justify-center gap-2 pt-6 pb-4">
        {[0, 1, 2, 3, 4, 5, 6].map(i => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-colors ${i === mobileWelcomeStep ? 'bg-blue-500' : (darkMode ? 'bg-gray-600' : 'bg-stone-300')}`}
          />
        ))}
      </div>

      {/* Carousel content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-y-auto">
        {mobileWelcomeStep === 0 && (
          <div className="text-center">
            <div className="mb-6"><Wordmark className="text-5xl" darkMode={darkMode} /></div>
            <p className={`text-lg ${textPrimary}`}>{t('onboarding.welcomeTitle')}</p>
            <p className={`${textSecondary} text-xs mt-4`}>{t('onboarding.welcomeLocal')}</p>
            <label className={`mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg cursor-pointer ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary}`}>
              <FileUp size={14} /> {t('onboarding.restoreFromBackup')}
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => { const f = e.target.files[0]; if (f) restoreBackup(f); e.target.value = ''; }}
              />
            </label>
            <div className={`mt-5 flex items-center justify-center gap-2 text-xs ${textSecondary}`}>
              <a href="https://glance-apps.com/dayglance/privacy" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-500 transition-colors">{t('onboarding.privacyPolicy')}</a>
              <span className="opacity-50">·</span>
              <a href="https://www.glance-apps.com/eula" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-500 transition-colors">{t('onboarding.termsOfUse')}</a>
            </div>
          </div>
        )}
        {mobileWelcomeStep === 1 && (
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Eye size={32} className="text-blue-500" />
            </div>
            <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>{t('onboarding.mobileGlance')}</h2>
            <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
              <li>{t('onboarding.mobileGlanceSmartAgenda')}</li>
              <li>{t('onboarding.mobileGlanceAhead')}</li>
              <li>{t('onboarding.mobileGlanceProgress')} <BarChart3 size={14} className="inline mx-0.5" /></li>
              <li>{t('onboarding.mobileGlanceSearch')} <Search size={14} className="inline mx-0.5" /> <Filter size={14} className="inline mx-0.5" /></li>
              <li>{t('onboarding.mobileGlanceRecycleBin')} <Trash2 size={14} className="inline mx-0.5" /></li>
              <li>{t('onboarding.mobileGlanceFocusMode')} <Target size={14} className="inline mx-0.5" /></li>
            </ul>
          </div>
        )}
        {mobileWelcomeStep === 2 && (
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Calendar size={32} className="text-blue-500" />
            </div>
            <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>{t('onboarding.mobileTimelineTitle')}</h2>
            <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
              <li>{t('onboarding.mobileTimelineSwipeRight')}</li>
              <li>{t('onboarding.mobileTimelineSwipeLeft')}</li>
              <li>{t('onboarding.mobileTimelineDrag')}</li>
              <li>{t('onboarding.mobileTimelineExpand')}</li>
              <li><NotebookPen size={14} className="inline mx-0.5" /> {t('onboarding.mobileTimelineDailyNotes')}</li>
            </ul>
          </div>
        )}
        {mobileWelcomeStep === 3 && (
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Inbox size={32} className="text-blue-500" />
            </div>
            <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>{t('onboarding.mobileInboxTitle')}</h2>
            <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
              <li>{t('onboarding.mobileInboxSwipeRight')}</li>
              <li>{t('onboarding.mobileInboxSwipeLeft')}</li>
              <li>{t('onboarding.mobileInboxAdd')}</li>
              <li>{t('onboarding.mobileInboxPriority')}</li>
            </ul>
          </div>
        )}
        {mobileWelcomeStep === 4 && (
          <div className="text-center w-full max-w-xs mx-auto">
            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Zap size={32} className="text-purple-500" />
            </div>
            <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>{t('onboarding.makeItYoursTitle')}</h2>
            <p className={`${textSecondary} text-sm mb-4`}>{t('onboarding.makeItYoursDesc')}</p>
            <div className={`text-sm ${textSecondary} space-y-3 text-left`}>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 bg-teal-100 dark:bg-teal-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <RefreshCw size={16} className="text-teal-500" />
                </span>
                <span>{t('onboarding.mobileFeatureRoutines')}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 bg-rose-100 dark:bg-rose-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Target size={16} className="text-rose-500" />
                </span>
                <span>{t('onboarding.mobileFeatureHabits')}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Flag size={16} className="text-blue-500" />
                </span>
                <span>{t('onboarding.mobileFeatureGoals')}</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Mic size={16} className="text-amber-500" />
                </span>
                <span>{t('onboarding.mobileFeatureAi')}</span>
              </div>
            </div>
          </div>
        )}
        {mobileWelcomeStep === 5 && (
          <div className="text-center">
            <div className="w-16 h-16 bg-stone-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Settings size={32} className={textSecondary} />
            </div>
            <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>{t('onboarding.mobileSettingsTitle')}</h2>
            <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
              <li>{t('onboarding.mobileSettingsToggles')}</li>
              <li>{t('onboarding.mobileSettingsCalendars')}</li>
              <li>{t('onboarding.mobileSettingsCloudSync')}</li>
              <li>{t('onboarding.mobileSettingsBackup')}</li>
              <li>{t('onboarding.mobileSettingsNotifications')}</li>
              <li>{t('onboarding.mobileSettingsGlanceApps')}</li>
              {obsidianAvailable && <li>{t('onboarding.mobileSettingsObsidian')}</li>}
              <li>{t('onboarding.mobileSettingsMultiUser')}</li>
            </ul>
          </div>
        )}
        {mobileWelcomeStep === 6 && (
          <div className="text-center">
            <div className="mb-6"><Wordmark className="text-4xl" darkMode={darkMode} /></div>
            <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.allSetTitle')}</h2>
            <div className="space-y-3 w-full max-w-xs mx-auto">
              <button
                onClick={() => setShowWelcome(false)}
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium transition-colors"
              >
                {t('onboarding.justGetStarted')}
              </button>
              <button
                onClick={() => { setShowWelcome(false); setShowSettings(true); }}
                className={`w-full px-6 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-xl font-medium flex items-center justify-center gap-2 transition-colors`}
              >
                <Cloud size={18} /> {t('onboarding.setUpCloudSync')}
              </button>
            </div>
            <a
              href="https://docs.dayglance.app"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-block mt-4 text-sm ${textSecondary} hover:text-blue-500 transition-colors`}
            >
              {t('onboarding.exploreDocs')}
            </a>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between px-6 py-6">
        <button
          onClick={() => setShowWelcome(false)}
          className={`text-sm ${textSecondary} px-3 py-2`}
        >
          {t('common.skip')}
        </button>
        <div className="flex gap-3">
          {mobileWelcomeStep > 0 && (
            <button
              onClick={() => setMobileWelcomeStep(s => s - 1)}
              className={`p-2 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}
            >
              <ChevronLeft size={20} className={textSecondary} />
            </button>
          )}
          {mobileWelcomeStep < 6 && (
            <button
              onClick={() => setMobileWelcomeStep(s => s + 1)}
              className="p-2 rounded-full bg-blue-600"
            >
              <ChevronRight size={20} className="text-white" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobileWelcomeModal;
