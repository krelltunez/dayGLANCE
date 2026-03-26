import React from 'react';
import { Calendar, Eye, Inbox, LayoutGrid, Settings, Sparkles } from 'lucide-react';
import { isNativeAndroid } from '../native.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const MobileTabBar = () => {
  const {
    tabBarRef, currentTime,
    mobileActiveTab, setMobileActiveTab,
    setMobileSettingsView,
    todayRoutines, setDashboardSelectedChips,
    setRoutineAddingToBucket, setRoutineNewChipName,
    routinesEnabled,
    cardBg, borderClass, textSecondary,
    filteredUnscheduledTasks, todayAgenda,
    goToToday, handleRoutinesDone,
  } = useDayPlannerCtx();

  const tabCount = 5 + (routinesEnabled ? 1 : 0);
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
            if (mobileActiveTab === 'routines') handleRoutinesDone();
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
            if (mobileActiveTab === 'routines') handleRoutinesDone();
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
        {routinesEnabled && (
        <button
          onClick={() => {
            setMobileActiveTab('routines');
            setMobileSettingsView('main');
            setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
            setRoutineAddingToBucket(null);
            setRoutineNewChipName('');
          }}
          className={`flex flex-col items-center justify-center ${showLabels ? 'gap-0.5' : ''} flex-1 h-full ${mobileActiveTab === 'routines' ? 'text-blue-500' : textSecondary}`}
        >
          <Sparkles size={iconSize} />
          {showLabels && <span className="text-[10px] font-medium">Routines</span>}
        </button>
        )}
        <button
          onClick={() => {
            if (mobileActiveTab === 'routines') handleRoutinesDone();
            setMobileActiveTab('frames');
            setMobileSettingsView('main');
          }}
          className={`flex flex-col items-center justify-center ${showLabels ? 'gap-0.5' : ''} flex-1 h-full ${mobileActiveTab === 'frames' ? 'text-blue-500' : textSecondary}`}
        >
          <LayoutGrid size={iconSize} />
          {showLabels && <span className="text-[10px] font-medium">Frames</span>}
        </button>
        <button
          onClick={() => {
            if (mobileActiveTab === 'routines') handleRoutinesDone();
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
