import React from 'react';
import {
  BarChart3, Calendar, ChevronLeft, ChevronRight,
  Cloud, Eye, Filter, Inbox, Mic, NotebookPen,
  RefreshCw, Search, Settings, Target, Trash2, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const MobileWelcomeModal = () => {
  const { t } = useTranslation();
  const {
    setShowWelcome,
    mobileWelcomeStep, setMobileWelcomeStep,
    setShowSettings,
    darkMode, textPrimary, textSecondary,
  } = useDayPlannerCtx();

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
            <img
              src={darkMode ? './dayglance-dark.svg' : './dayglance-light.svg'}
              alt="dayGLANCE"
              className="h-24 mx-auto mb-6"
            />
            <h1 className={`text-2xl font-bold ${textPrimary} mb-2`}>{t('onboarding.welcomeTitle')}</h1>
            <p className={`${textSecondary}`}>{t('onboarding.welcomeSubtitle')}</p>
            <p className={`${textSecondary} text-xs mt-4`}>{t('onboarding.welcomeLocal')}</p>
          </div>
        )}
        {mobileWelcomeStep === 1 && (
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Eye size={32} className="text-blue-500" />
            </div>
            <h2 className={`text-xl font-bold ${textPrimary} mb-2`}>{t('onboarding.mobileGlance')}</h2>
            <ul className={`${textSecondary} text-sm text-center space-y-2 max-w-xs mx-auto list-none`}>
              <li>Your <strong className={textPrimary}>smart agenda</strong> — see <strong className={textPrimary}>overdue</strong>, <strong className={textPrimary}>in-progress</strong>, and <strong className={textPrimary}>upcoming</strong> tasks in real time</li>
              <li>Track your progress with <strong className={textPrimary}>daily</strong> and <strong className={textPrimary}>all-time summaries</strong> <BarChart3 size={14} className="inline mx-0.5" /></li>
              <li><strong className={textPrimary}>Search</strong> <Search size={14} className="inline mx-0.5" /> across all your tasks and events, and filter your day by <strong className={textPrimary}>#tags</strong> <Filter size={14} className="inline mx-0.5" /></li>
              <li>Deleted something by mistake? Restore it from the <strong className={textPrimary}>Recycle Bin</strong> <Trash2 size={14} className="inline mx-0.5" /></li>
              <li>Tap <strong className={textPrimary}>Focus Mode</strong> <Target size={14} className="inline mx-0.5" /> on an in-progress task for a distraction-free deep work session with a Pomodoro timer</li>
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
              <li>Swipe a task <strong className={textPrimary}>right</strong> to move it to inbox</li>
              <li>Swipe a task <strong className={textPrimary}>left</strong> to edit it</li>
              <li><strong className={textPrimary}>Long-press</strong> and drag to reschedule a task</li>
              <li>Expand tasks to add <strong className={textPrimary}>notes</strong> and <strong className={textPrimary}>subtasks</strong></li>
              <li>Tap <NotebookPen size={14} className="inline mx-0.5" /> on a date to write <strong className={textPrimary}>daily notes</strong></li>
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
              <li>Swipe a task <strong className={textPrimary}>right</strong> to schedule it</li>
              <li>Swipe a task <strong className={textPrimary}>left</strong> to edit it</li>
              <li>Tap the <strong className={textPrimary}>+</strong> button to add a new inbox task</li>
              <li>Use the <strong className={textPrimary}>priority filter</strong> to focus on what matters</li>
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
                <span><strong className={textPrimary}>Routines</strong> — daily task templates for each day of the week</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 bg-rose-100 dark:bg-rose-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Target size={16} className="text-rose-500" />
                </span>
                <span><strong className={textPrimary}>Habits</strong> — track daily habits with visual progress rings and history</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="w-8 h-8 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Mic size={16} className="text-amber-500" />
                </span>
                <span><strong className={textPrimary}>AI Features</strong> — voice input, morning briefings, and smart task parsing (BYO API key)</span>
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
              <li><strong className={textPrimary}>Quick toggles</strong> for common settings</li>
              <li><strong className={textPrimary}>Sync</strong> your calendars</li>
              <li>Set up <strong className={textPrimary}>cloud sync</strong> between devices</li>
              <li><strong className={textPrimary}>Backup</strong> and restore your data</li>
            </ul>
          </div>
        )}
        {mobileWelcomeStep === 6 && (
          <div className="text-center">
            <img
              src={darkMode ? './dayglance-dark.svg' : './dayglance-light.svg'}
              alt="dayGLANCE"
              className="h-20 mx-auto mb-6"
            />
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
