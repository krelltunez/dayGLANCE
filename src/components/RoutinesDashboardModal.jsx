import React from 'react';
import { X, Plus, Clock, Undo2, Sparkles, Trash2 } from 'lucide-react';
import ClockTimePicker from './ClockTimePicker.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import UserOwnerSwitcher from './UserOwnerSwitcher.jsx';

const RoutinesDashboardModal = () => {
  const {
    getDayName, formatTime,
    isTablet, isMobile, darkMode, use24HourClock,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();
  const {
    setShowRoutinesDashboard, handleRoutinesDone,
    routineAddingToBucket, setRoutineAddingToBucket,
    routineNewChipName, setRoutineNewChipName,
    routineTimePickerChipId, setRoutineTimePickerChipId,
    routineDeleteConfirm, setRoutineDeleteConfirm,
    routineFocusedChipId, setRoutineFocusedChipId,
    routineDefinitions,
    dashboardSelectedChips, setDashboardSelectedChips,
    addRoutineChip, deleteRoutineChip, toggleRoutineChipSelection,
    multiUserEnabled, users, hrViewUserSyncId, setHrViewUserSyncId,
    ownedBy, selectTodayChipsForOwner,
  } = useFeaturesCtx();

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
        onClick={() => handleRoutinesDone()}
        onKeyDown={(e) => { if ((e.key === 'Escape' || e.key === 'Enter') && !routineAddingToBucket) { e.preventDefault(); handleRoutinesDone(); } }}
        tabIndex={-1}
        ref={(el) => { if (el && !routineAddingToBucket) el.focus(); }}
      >
        <div className={`${cardBg} rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col`} onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className={`p-6 border-b ${borderClass}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <img
                  src={darkMode ? './dayglance-dark.svg' : './dayglance-light.svg'}
                  alt="dayGLANCE"
                  className="h-[4.5rem]"
                />
                <div>
                  <div className={`text-lg font-bold ${textPrimary}`}>
                    {new Date().toLocaleDateString('en-US', { weekday: 'long' })}, {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                  </div>
                  <div className={`text-sm ${textSecondary}`}>What's in today's routine?</div>
                </div>
              </div>
              <button onClick={() => setShowRoutinesDashboard(false)} className={`p-2 rounded-lg ${hoverBg}`}>
                <X size={20} className={textSecondary} />
              </button>
            </div>
            {multiUserEnabled && users.filter(u => !u.deleted).length > 0 && (
              <div className="mt-4">
                <UserOwnerSwitcher
                  enabled={multiUserEnabled}
                  users={users}
                  value={hrViewUserSyncId}
                  onChange={(id) => { setHrViewUserSyncId(id); selectTodayChipsForOwner(id); }}
                  darkMode={darkMode}
                  borderClass={borderClass}
                  textSecondary={textSecondary}
                  label="Routines for"
                />
              </div>
            )}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6">
            {(() => {
              const today = new Date();
              const todayDayName = getDayName(today);
              const leftBuckets = ['everyday', 'monday', 'tuesday', 'wednesday'];
              const rightBuckets = ['thursday', 'friday', 'saturday', 'sunday'];
              const bucketLabel = (b) => b === 'everyday' ? 'Every Day' : b.charAt(0).toUpperCase() + b.slice(1);
              const isHighlighted = (b) => b === todayDayName || b === 'everyday';

              const renderBucket = (bucket) => {
                const chips = (routineDefinitions[bucket] || []).filter(c => ownedBy(c, hrViewUserSyncId));
                return (
                  <div
                    key={bucket}
                    className={`${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'} rounded-lg p-3 ${isHighlighted(bucket) ? (darkMode ? 'ring-2 ring-teal-400 bg-teal-900/20' : 'ring-2 ring-teal-500 bg-teal-50') : ''}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-xs font-semibold uppercase tracking-wide ${isHighlighted(bucket) ? 'text-teal-500' : textSecondary}`}>
                        {bucketLabel(bucket)}
                      </span>
                      <button
                        onClick={() => {
                          setRoutineAddingToBucket(routineAddingToBucket === bucket ? null : bucket);
                          setRoutineNewChipName('');
                        }}
                        className={`p-0.5 rounded ${hoverBg}`}
                        title="Add routine"
                      >
                        <Plus size={14} className={textSecondary} />
                      </button>
                    </div>
                    {routineAddingToBucket === bucket && (
                      <div className="flex gap-1 mb-2">
                        <input
                          autoFocus
                          value={routineNewChipName}
                          onChange={(e) => setRoutineNewChipName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') addRoutineChip(bucket);
                            if (e.key === 'Escape') { setRoutineAddingToBucket(null); setRoutineNewChipName(''); }
                          }}
                          placeholder="Name..."
                          className={`flex-1 min-w-0 px-2 py-1 text-xs rounded ${darkMode ? 'bg-gray-600 text-white placeholder-gray-400' : 'bg-white text-stone-900 placeholder-stone-400 border border-stone-300'} focus:outline-none focus:ring-1 focus:ring-teal-500`}
                        />
                        <button onClick={() => addRoutineChip(bucket)} className="px-2 py-1 text-xs bg-teal-600 text-white rounded hover:bg-teal-700">Add</button>
                      </div>
                    )}
                    <div className={`flex flex-wrap ${isTablet ? 'gap-1.5' : 'gap-1'}`}>
                      {chips.map(chip => {
                        const isSelected = dashboardSelectedChips.some(c => c.id === chip.id);
                        const isFocused = routineFocusedChipId === chip.id;
                        return (
                          <div
                            key={chip.id}
                            onClick={() => {
                              if (isMobile || isTablet) {
                                if (isFocused) {
                                  toggleRoutineChipSelection(chip, bucket);
                                  setRoutineFocusedChipId(null);
                                } else {
                                  setRoutineFocusedChipId(chip.id);
                                }
                              } else {
                                toggleRoutineChipSelection(chip, bucket);
                              }
                            }}
                            className={`group relative rounded-full ${isTablet ? 'px-3.5 py-1.5 text-sm' : 'px-2.5 py-1 text-xs'} font-medium cursor-pointer transition-colors ${
                              isSelected
                                ? (darkMode ? 'bg-gray-600 text-gray-400' : 'bg-stone-200 text-stone-400')
                                : (darkMode ? 'bg-teal-700/80 text-teal-100 hover:bg-teal-600/80' : 'bg-teal-600/80 text-white hover:bg-teal-500/80')
                            }`}
                          >
                            {chip.name}
                            <button
                              onClick={(e) => { e.stopPropagation(); setRoutineDeleteConfirm({ bucket, chipId: chip.id, chipName: chip.name }); setRoutineFocusedChipId(null); }}
                              className={`absolute ${isTablet ? '-top-2 -right-2' : '-top-1.5 -right-1.5'} transition-opacity bg-red-500 text-white rounded-full ${isTablet ? 'w-5 h-5' : 'w-4 h-4'} flex items-center justify-center ${
                                (isMobile || isTablet) ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                              }`}
                              title="Delete"
                            >
                              <X size={isTablet ? 12 : 10} />
                            </button>
                          </div>
                        );
                      })}
                      {chips.length === 0 && !routineAddingToBucket && (
                        <span className={`text-xs ${textSecondary} italic`}>No routines</span>
                      )}
                    </div>
                  </div>
                );
              };

              const hasAnyChips = Object.values(routineDefinitions).some(arr => arr.some(c => ownedBy(c, hrViewUserSyncId)));

              return (
                <div className="grid grid-cols-3 gap-4">
                  {/* Left column: Mon/Tue/Wed/Everyday */}
                  <div className="space-y-3">
                    {leftBuckets.map(renderBucket)}
                  </div>

                  {/* Center: selected chips */}
                  <div className={`rounded-lg border-2 border-dashed ${darkMode ? 'border-gray-600' : 'border-stone-300'} p-4 flex flex-col items-center justify-start min-h-[300px]`}>
                    <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${textSecondary}`}>Today's Routine</div>
                    {dashboardSelectedChips.length > 0 ? (
                      <div className={`flex flex-wrap ${isTablet ? 'gap-2' : 'gap-1.5'} justify-center`}>
                        {dashboardSelectedChips.map(chip => {
                          const isFocused = routineFocusedChipId === chip.id;
                          return (
                          <div
                            key={chip.id}
                            className={`group relative rounded-full ${isTablet ? 'px-4 py-2 text-sm' : 'px-3 py-1.5 text-xs'} font-medium cursor-pointer ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}
                            onClick={() => {
                              if (isMobile || isTablet) {
                                if (isFocused) {
                                  setRoutineTimePickerChipId(chip.id);
                                  setRoutineFocusedChipId(null);
                                } else {
                                  setRoutineFocusedChipId(chip.id);
                                }
                              } else {
                                setRoutineTimePickerChipId(chip.id);
                              }
                            }}
                            title={(isMobile || isTablet) ? 'Tap to show options' : 'Click to set time'}
                          >
                            <span className="flex items-center gap-1">
                              {chip.name}
                              {chip.startTime && (
                                <>
                                  <Clock size={isTablet ? 12 : 10} className="ml-0.5" />
                                  <span className="opacity-90">{formatTime(chip.startTime)}</span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setDashboardSelectedChips(prev => prev.map(c => c.id === chip.id ? { ...c, startTime: null } : c));
                                    }}
                                    className="hover:opacity-100 opacity-60 transition-opacity"
                                    title="Clear time"
                                  >
                                    <X size={isTablet ? 12 : 10} />
                                  </button>
                                </>
                              )}
                            </span>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDashboardSelectedChips(prev => prev.filter(c => c.id !== chip.id)); setRoutineFocusedChipId(null); }}
                              className={`absolute ${isTablet ? '-top-2 -right-2' : '-top-1.5 -right-1.5'} transition-opacity rounded-full ${isTablet ? 'w-5 h-5' : 'w-4 h-4'} flex items-center justify-center ${darkMode ? 'bg-gray-500 text-white' : 'bg-stone-400 text-white'} ${
                                (isMobile || isTablet) ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                              }`}
                              title="Remove from today"
                            >
                              <Undo2 size={isTablet ? 12 : 10} />
                            </button>
                          </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex-1 flex flex-col items-center justify-center text-center">
                        <Sparkles size={32} className={`${textSecondary} mb-3 opacity-40`} />
                        <p className={`text-sm ${textSecondary}`}>
                          {hasAnyChips
                            ? 'Click chips from the day buckets to add them to today\'s routine'
                            : 'Add routine chips to the day buckets using the + button, then click them to select for today'
                          }
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right column: Thu/Fri/Sat/Sun */}
                  <div className="space-y-3">
                    {rightBuckets.map(renderBucket)}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Footer */}
          <div className={`p-4 border-t ${borderClass} flex justify-end`}>
            <button
              onClick={handleRoutinesDone}
              className="px-6 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
      {routineTimePickerChipId !== null && (
        <ClockTimePicker
          value={dashboardSelectedChips.find(c => c.id === routineTimePickerChipId)?.startTime || '09:00'}
          onChange={(time) => {
            setDashboardSelectedChips(prev => prev.map(c => c.id === routineTimePickerChipId ? { ...c, startTime: time } : c));
            setRoutineTimePickerChipId(null);
          }}
          onClose={() => setRoutineTimePickerChipId(null)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}

      {/* Routine Delete Confirmation */}
      {routineDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setRoutineDeleteConfirm(null)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <Trash2 size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Delete Routine</h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              Are you sure you want to delete <strong className={textPrimary}>"{routineDeleteConfirm.chipName}"</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setRoutineDeleteConfirm(null)}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg}`}
              >
                Cancel
              </button>
              <button
                onClick={() => { deleteRoutineChip(routineDeleteConfirm.bucket, routineDeleteConfirm.chipId); setRoutineDeleteConfirm(null); }}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default RoutinesDashboardModal;
