import React from 'react';
import Wordmark from './Wordmark';
import {
  BarChart3, Calendar, CalendarDays, ChevronLeft, ChevronRight,
  Cloud, Eye, FileText, Filter, Flag, Gauge, GripVertical, Inbox, LayoutGrid, Mic, Moon,
  NotebookPen, Plus, RefreshCw, Search, Settings, Sun,
  Target, Zap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const DesktopWelcomeModal = () => {
  const { t } = useTranslation();
  const {
    setShowWelcome,
    desktopWelcomeStep, setDesktopWelcomeStep,
    setShowSettings,
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
  } = useDayPlannerCtx();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div
        className={`${cardBg} rounded-xl shadow-xl ${borderClass} border max-w-lg w-full mx-4 flex flex-col`}
        style={{ height: 'min(540px, 85vh)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pt-5 pb-3">
          {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
            <button
              key={i}
              onClick={() => setDesktopWelcomeStep(i)}
              className={`w-2 h-2 rounded-full transition-colors ${i === desktopWelcomeStep ? 'bg-blue-500' : (darkMode ? 'bg-gray-600' : 'bg-stone-300')}`}
            />
          ))}
        </div>

        {/* Carousel content */}
        <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-hidden">
          {desktopWelcomeStep === 0 && (
            <div className="text-center">
              <div className="mb-6"><Wordmark className="text-6xl" darkMode={darkMode} /></div>
              <p className={`text-lg ${textPrimary}`}>{t('onboarding.welcomeTitle')}</p>
              <p className={`${textSecondary} text-xs mt-3`}>{t('onboarding.welcomeLocal')}</p>
              <p className={`${textSecondary} text-sm mt-4`}>{t('onboarding.welcomeTour')}</p>
              <div className={`mt-5 flex items-center justify-center gap-2 text-xs ${textSecondary}`}>
                <a href="https://docs.dayglance.app/en/privacy-policy" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-500 transition-colors">{t('onboarding.privacyPolicy')}</a>
                <span className="opacity-50">·</span>
                <a href="https://www.glance-apps.com/eula" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-500 transition-colors">{t('onboarding.termsOfUse')}</a>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 1 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Plus size={32} className="text-blue-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.layoutTitle')}</h2>
              <div className={`text-sm ${textSecondary} space-y-3 text-left`}>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Eye size={16} className="text-blue-500" />
                  </span>
                  <span><strong className={textPrimary}>GLANCE</strong>: your smart agenda: overdue tasks, today&apos;s schedule, <span className="italic">GLANCE</span>ahead, optional habit rings and goal bars, and quick access to your daily note and progress stats</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Inbox size={16} className="text-blue-500" />
                  </span>
                  <span><strong className={textPrimary}>Inbox</strong>: capture tasks to organize later, drag them to the timeline when ready to schedule</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Calendar size={16} className="text-blue-500" />
                  </span>
                  <span><strong className={textPrimary}>Timeline</strong>: switch between multi-day, 24-hour, and week views (grid or list view on tablet); click on the timeline or press <Plus size={12} className="inline mx-0.5" /> to add tasks</span>
                </div>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 2 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <GripVertical size={32} className="text-blue-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.interactingTitle')}</h2>
              <ul className={`text-sm ${textSecondary} space-y-2 text-left list-none`}>
                <li>Click on the <strong className={textPrimary}>timeline</strong> to add a task at that time</li>
                <li>Click on the <strong className={textPrimary}>date header</strong> to add an all-day task</li>
                <li>Drag tasks from Inbox to timeline to <strong className={textPrimary}>schedule</strong> them</li>
                <li>Drag the bottom edge of a task to <strong className={textPrimary}>resize</strong> its duration</li>
                <li>Set tasks to <strong className={textPrimary}>repeat</strong> daily, weekly, monthly, or yearly</li>
                <li>Double-click a task title to <strong className={textPrimary}>edit</strong> it or add <strong className={textPrimary}>tags</strong></li>
                <li>Expand a task to add <strong className={textPrimary}>notes</strong> <FileText size={14} className="inline mx-0.5" /> and <strong className={textPrimary}>subtasks</strong></li>
                <li>Click <NotebookPen size={14} className="inline mx-0.5" /> on a date header to write <strong className={textPrimary}>daily notes</strong></li>
                <li>Designate productivity blocks with <strong className={textPrimary}>GTD Frames</strong> <LayoutGrid size={14} className="inline mx-0.5" /></li>
                <li>Use <strong className={textPrimary}>Focus Mode</strong> <Target size={14} className="inline mx-0.5" /> for distraction-free deep work</li>
              </ul>
            </div>
          )}
          {desktopWelcomeStep === 3 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Search size={32} className="text-blue-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.spotlightTitle')}</h2>
              <div className={`text-sm ${textSecondary} space-y-3 text-left`}>
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Search size={16} className={textPrimary} />
                  </span>
                  <span>Press <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded text-xs font-mono`}>Ctrl+K</kbd> to instantly search all your tasks, jump to any date, or find tasks by tag.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Filter size={16} className={textPrimary} />
                  </span>
                  <span>Filter your day by <strong className={textPrimary}>#tags</strong> to focus on just what matters.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Gauge size={16} className={textPrimary} />
                  </span>
                  <span>Check the <strong className={textPrimary}>Daily Summary</strong> for today&apos;s completion and time stats.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <BarChart3 size={16} className={textPrimary} />
                  </span>
                  <span>Click the <BarChart3 size={14} className="inline mx-0.5" /> button to review your week: see completion stats, reflect on wins, and plan ahead.</span>
                </div>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 4 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Zap size={32} className="text-amber-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.shortcutsTitle')}</h2>
              <div className={`text-sm ${textSecondary} space-y-2`}>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>{t('onboarding.shortcutNewScheduled')}</span>
                  <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>N</kbd>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>{t('onboarding.shortcutNewInbox')}</span>
                  <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>I</kbd>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>{t('onboarding.shortcutToday')}</span>
                  <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>T</kbd>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>{t('onboarding.shortcutPrevNextDay')}</span>
                  <span className="flex gap-1">
                    <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>&larr;</kbd>
                    <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>&rarr;</kbd>
                  </span>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>{t('onboarding.shortcutUndoRedo')}</span>
                  <span className="flex gap-1">
                    <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>Ctrl+Z</kbd>
                    <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>Ctrl+Shift+Z</kbd>
                  </span>
                </div>
                <p className={`text-xs ${textSecondary} mt-3`}>Press <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono`}>?</kbd> at any time to see all available shortcuts.</p>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 5 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-stone-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Settings size={32} className={textSecondary} />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.settingsSyncTitle')}</h2>
              <div className={`text-sm ${textSecondary} space-y-2 text-left`}>
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <CalendarDays size={16} className={textPrimary} />
                  </span>
                  <span><strong className={textPrimary}>Calendar sync</strong>: import CalDAV, iCal (.ics), and native device calendars</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <Cloud size={16} className={textPrimary} />
                  </span>
                  <span><strong className={textPrimary}>Cloud Sync</strong>: sync your data across devices via GLANCEvault or WebDAV</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    {darkMode ? <Sun size={16} className={textPrimary} /> : <Moon size={16} className={textPrimary} />}
                  </span>
                  <span><strong className={textPrimary}>Dark / Light mode</strong>, reminders, backup &amp; restore</span>
                </div>
                <p className="text-xs opacity-75 mt-2">Your data is stored locally on your device. Use backup or cloud sync to transfer between devices.</p>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 6 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Zap size={32} className="text-purple-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.makeItYoursTitle')}</h2>
              <p className={`${textSecondary} text-sm mb-4`}>{t('onboarding.makeItYoursDesc')}</p>
              <div className={`text-sm ${textSecondary} space-y-3 text-left`}>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-teal-100 dark:bg-teal-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <RefreshCw size={16} className="text-teal-500" />
                  </span>
                  <span><strong className={textPrimary}>Routines</strong>: things you need to do regularly, like eat, sleep and exercise</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-rose-100 dark:bg-rose-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Target size={16} className="text-rose-500" />
                  </span>
                  <span><strong className={textPrimary}>Habits</strong>: track regular habits with visual progress rings and saved history</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Flag size={16} className="text-blue-500" />
                  </span>
                  <span><strong className={textPrimary}>Goals &amp; Projects</strong>: track your long-term goals and progress toward completion</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-amber-100 dark:bg-amber-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Mic size={16} className="text-amber-500" />
                  </span>
                  <span><strong className={textPrimary}>AI Features</strong>: voice input, morning briefings, and smart task parsing (BYO API key)</span>
                </div>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 7 && (
            <div className="text-center">
              <div className="mb-6"><Wordmark className="text-5xl" darkMode={darkMode} /></div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>{t('onboarding.allSetTitle')}</h2>
              <div className="space-y-3 w-full max-w-xs mx-auto">
                <button
                  onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); }}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium transition-colors"
                >
                  {t('onboarding.justGetStarted')}
                </button>
                <button
                  onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); setShowSettings(true); }}
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
        <div className="flex items-center justify-between px-6 py-4">
          <button
            onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); }}
            className={`text-sm ${textSecondary} px-3 py-2 hover:${textPrimary} transition-colors`}
          >
            {t('common.skip')}
          </button>
          <div className="flex gap-3">
            {desktopWelcomeStep > 0 && (
              <button
                onClick={() => setDesktopWelcomeStep(s => s - 1)}
                className={`p-2 rounded-full ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} transition-colors`}
              >
                <ChevronLeft size={20} className={textSecondary} />
              </button>
            )}
            {desktopWelcomeStep < 7 && (
              <button
                onClick={() => setDesktopWelcomeStep(s => s + 1)}
                className="p-2 rounded-full bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <ChevronRight size={20} className="text-white" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DesktopWelcomeModal;
