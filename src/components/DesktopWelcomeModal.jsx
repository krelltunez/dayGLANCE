import React from 'react';
import {
  BarChart3, Calendar, CalendarDays, ChevronLeft, ChevronRight,
  Cloud, Eye, FileText, GripVertical, Inbox, Mic, Moon,
  NotebookPen, Plus, RefreshCw, Search, Settings, Sun,
  Target, Zap,
} from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const DesktopWelcomeModal = () => {
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
              <img
                src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                alt="dayGLANCE"
                className="h-24 mx-auto mb-6"
              />
              <h1 className={`text-2xl font-bold ${textPrimary} mb-2`}>Welcome to dayGLANCE</h1>
              <p className={`${textSecondary}`}>Your minimalist day planner</p>
              <p className={`${textSecondary} text-xs mt-3`}>100% local — no accounts, no servers, no tracking.</p>
              <p className={`${textSecondary} text-sm mt-4`}>Let&apos;s take a quick tour of the key features.</p>
            </div>
          )}
          {desktopWelcomeStep === 1 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Plus size={32} className="text-blue-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Your Layout</h2>
              <div className={`text-sm ${textSecondary} space-y-3 text-left`}>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Eye size={16} className="text-blue-500" />
                  </span>
                  <span><strong className={textPrimary}>GLANCE</strong> — your smart agenda with overdue tasks and today&apos;s schedule</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Inbox size={16} className="text-blue-500" />
                  </span>
                  <span><strong className={textPrimary}>Inbox</strong> — capture tasks to organize later, drag them to the timeline when ready</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="w-8 h-8 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Calendar size={16} className="text-blue-500" />
                  </span>
                  <span><strong className={textPrimary}>Timeline</strong> — your day&apos;s schedule, click or use the <Plus size={12} className="inline mx-0.5" /> button to add tasks</span>
                </div>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 2 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <GripVertical size={32} className="text-blue-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Interacting with Tasks</h2>
              <ul className={`text-sm ${textSecondary} space-y-2 text-left list-none`}>
                <li>Click on the <strong className={textPrimary}>timeline</strong> to add a task at that time</li>
                <li>Click on the <strong className={textPrimary}>date header</strong> to add an all-day task</li>
                <li>Drag tasks from Inbox to timeline to <strong className={textPrimary}>schedule</strong> them</li>
                <li>Drag the bottom edge of a task to <strong className={textPrimary}>resize</strong> its duration</li>
                <li>Set tasks to <strong className={textPrimary}>repeat</strong> daily, weekly, monthly, or yearly</li>
                <li>Double-click a task title to <strong className={textPrimary}>edit</strong> it or add <strong className={textPrimary}>tags</strong></li>
                <li>Expand a task to add <strong className={textPrimary}>notes</strong> <FileText size={14} className="inline mx-0.5" /> and <strong className={textPrimary}>subtasks</strong> for extra detail</li>
                <li>Click <NotebookPen size={14} className="inline mx-0.5" /> on a date header to write <strong className={textPrimary}>daily notes</strong></li>
                <li>Use <strong className={textPrimary}>Focus Mode</strong> <Target size={14} className="inline mx-0.5" /> for distraction-free deep work with a Pomodoro timer</li>
              </ul>
            </div>
          )}
          {desktopWelcomeStep === 3 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Search size={32} className="text-blue-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Spotlight Search &amp; Weekly Review</h2>
              <div className={`text-sm ${textSecondary} space-y-4 text-left`}>
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Search size={16} className={textPrimary} />
                  </span>
                  <span>Press <kbd className={`px-1.5 py-0.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded text-xs font-mono`}>Ctrl+K</kbd> to instantly search all your tasks, jump to any date, or find tasks by tag.</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <BarChart3 size={16} className={textPrimary} />
                  </span>
                  <span>Click the <BarChart3 size={14} className="inline mx-0.5" /> button on the side panel to review your week — see completion stats, reflect on wins, and plan ahead.</span>
                </div>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 4 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Zap size={32} className="text-amber-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Keyboard Shortcuts</h2>
              <div className={`text-sm ${textSecondary} space-y-2`}>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>New scheduled task</span>
                  <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>N</kbd>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>New inbox task</span>
                  <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>I</kbd>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>Jump to today</span>
                  <kbd className={`px-2 py-1 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded text-xs font-mono ${textPrimary}`}>T</kbd>
                </div>
                <div className={`flex items-center justify-between px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-100'}`}>
                  <span>Undo / Redo</span>
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
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Settings &amp; Sync</h2>
              <div className={`text-sm ${textSecondary} space-y-2 text-left`}>
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <CalendarDays size={16} className={textPrimary} />
                  </span>
                  <span><strong className={textPrimary}>Calendar sync</strong> — import CalDAV and iCal (.ics) events</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    <Cloud size={16} className={textPrimary} />
                  </span>
                  <span><strong className={textPrimary}>Cloud Sync</strong> — sync your data across devices via WebDAV</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`w-8 h-8 ${darkMode ? 'bg-gray-600' : 'bg-stone-200'} rounded-lg flex items-center justify-center flex-shrink-0`}>
                    {darkMode ? <Sun size={16} className={textPrimary} /> : <Moon size={16} className={textPrimary} />}
                  </span>
                  <span><strong className={textPrimary}>Dark / Light mode</strong>, reminders, backup &amp; restore</span>
                </div>
                <p className="text-xs opacity-75 mt-2">Your data is stored locally in your browser. Use backup or cloud sync to transfer between devices.</p>
              </div>
            </div>
          )}
          {desktopWelcomeStep === 6 && (
            <div className="text-center w-full max-w-sm">
              <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <Zap size={32} className="text-purple-500" />
              </div>
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>Make It Yours</h2>
              <p className={`${textSecondary} text-sm mb-4`}>Optional features you can enable anytime in Settings:</p>
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
                  <span><strong className={textPrimary}>Habits</strong> — track daily habits with streaks and visual progress rings</span>
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
          {desktopWelcomeStep === 7 && (
            <div className="text-center">
              <img
                src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                alt="dayGLANCE"
                className="h-20 mx-auto mb-6"
              />
              <h2 className={`text-xl font-bold ${textPrimary} mb-4`}>You&apos;re All Set!</h2>
              <div className="space-y-3 w-full max-w-xs mx-auto">
                <button
                  onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); }}
                  className="w-full px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium transition-colors"
                >
                  Just Get Started
                </button>
                <button
                  onClick={() => { setShowWelcome(false); setDesktopWelcomeStep(0); setShowSettings(true); }}
                  className={`w-full px-6 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-xl font-medium flex items-center justify-center gap-2 transition-colors`}
                >
                  <Cloud size={18} /> Set Up Cloud Sync
                </button>
              </div>
              <a
                href="https://docs.dayglance.app"
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-block mt-4 text-sm ${textSecondary} hover:text-blue-500 transition-colors`}
              >
                Explore the docs at docs.dayglance.app
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
            Skip
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
