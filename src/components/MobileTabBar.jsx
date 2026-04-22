import React from 'react';
import { Calendar, Eye, Flag, Inbox, Settings } from 'lucide-react';
import { isNativeAndroid } from '../native.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const MobileTabBar = () => {
  const {
    tabBarRef, currentTime,
    mobileActiveTab, setMobileActiveTab,
    setMobileSettingsView,
    cardBg, borderClass, textSecondary,
    filteredUnscheduledTasks, todayAgenda,
    goToToday,
  } = useDayPlannerCtx();
  const {
    goalsProjectsEnabled, goals, handleRoutinesDone,
  } = useFeaturesCtx();

  const activeGoals = goalsProjectsEnabled ? (goals || []).filter(g => g.status !== 'archived') : [];
  const goalsCount = activeGoals.length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const hasOverdueGoal = activeGoals.some(g => g.targetDate && new Date(g.targetDate + 'T00:00:00') < today && g.status !== 'completed');

  const tabCount = 4 + (goalsProjectsEnabled ? 1 : 0);
  const showLabels = tabCount <= 5;
  const iconSize = showLabels ? 20 : 22;

  return (
    <div
      ref={tabBarRef}
      className={`fixed bottom-0 left-0 right-0 z-40 ${cardBg} border-t ${borderClass}`}
      style={{ paddingBottom: isNativeAndroid() ? 0 : 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-center justify-around h-14">
        <button
          onClick={() => {
            setMobileActiveTab('dayglance');
            setMobileSettingsView('main');
          }}
          className={`flex flex-col items-center justify-center ${showLabels ? 'gap-0.5' : ''} flex-1 h-full ${mobileActiveTab === 'dayglance' ? 'text-blue-500' : textSecondary}`}
        >
          <Eye size={iconSize} />
          {showLabels && <span className="text-[10px] font-medium">GLANCE</span>}
        </button>
        <button
          onClick={() => {
            if (mobileActiveTab !== 'timeline') goToToday();
            setMobileActiveTab('timeline');
            setMobileSettingsView('main');
          }}
          className={`flex flex-col items-center justify-center ${showLabels ? 'gap-0.5' : ''} flex-1 h-full ${mobileActiveTab === 'timeline' ? (todayAgenda.some(t => {
            if (t.completed || t._agendaType !== 'scheduled') return false;
            const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
            const [h, m] = (t.startTime || '0:0').split(':').map(Number);
            return (h * 60 + m + (t.duration || 0)) <= nowMin;
          }) ? 'text-red-500' : 'text-blue-500') : textSecondary}`}
        >
          <div className="relative">
            <Calendar size={iconSize} />
            {(() => {
              const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
              const overdueCount = todayAgenda.filter(t => {
                if (t.completed || t._agendaType !== 'scheduled') return false;
                const [h, m] = (t.startTime || '0:0').split(':').map(Number);
                return (h * 60 + m + (t.duration || 0)) <= nowMin;
              }).length;
              return overdueCount > 0 ? (
                <span className="absolute -top-1.5 -right-2.5 bg-red-600 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                  {overdueCount > 9 ? '9+' : overdueCount}
                </span>
              ) : null;
            })()}
          </div>
          {showLabels && <span className="text-[10px] font-medium">Timeline</span>}
        </button>
        <button
          onClick={() => {
            if (mobileActiveTab === 'routines') handleRoutinesDone();
            setMobileActiveTab('inbox');
            setMobileSettingsView('main');
          }}
          className={`flex flex-col items-center justify-center ${showLabels ? 'gap-0.5' : ''} flex-1 h-full relative ${mobileActiveTab === 'inbox' ? 'text-blue-500' : textSecondary}`}
        >
          <div className="relative">
            <Inbox size={iconSize} />
            {filteredUnscheduledTasks.filter(t => !t.isExample).length > 0 && (
              <span className="absolute -top-1.5 -right-2.5 bg-blue-600 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                {filteredUnscheduledTasks.filter(t => !t.isExample).length}
              </span>
            )}
          </div>
          {showLabels && <span className="text-[10px] font-medium">Inbox</span>}
        </button>
        {goalsProjectsEnabled && (
        <button
          onClick={() => {
            setMobileActiveTab('goals');
            setMobileSettingsView('main');
          }}
          className={`flex flex-col items-center justify-center ${showLabels ? 'gap-0.5' : ''} flex-1 h-full ${mobileActiveTab === 'goals' ? 'text-blue-500' : textSecondary}`}
        >
          <div className="relative">
            <Flag size={iconSize} />
            {goalsCount > 0 && (
              <span className={`absolute -top-1.5 -right-2.5 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1 ${hasOverdueGoal ? 'bg-red-600' : 'bg-blue-600'}`}>
                {goalsCount > 9 ? '9+' : goalsCount}
              </span>
            )}
          </div>
          {showLabels && <span className="text-[10px] font-medium">Goals</span>}
        </button>
        )}
        <button
          onClick={() => {
            setMobileActiveTab('settings');
          }}
          className={`flex flex-col items-center justify-center ${showLabels ? 'gap-0.5' : ''} flex-1 h-full ${mobileActiveTab === 'settings' ? 'text-blue-500' : textSecondary}`}
        >
          <Settings size={iconSize} />
          {showLabels && <span className="text-[10px] font-medium">Settings</span>}
        </button>
      </div>
    </div>
  );
};

export default MobileTabBar;
