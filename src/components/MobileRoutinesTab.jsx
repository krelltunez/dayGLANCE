import React from 'react';
import { Clock, Plus, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import UserOwnerSwitcher from './UserOwnerSwitcher.jsx';

const MobileRoutinesTab = () => {
  const { isPhone, isMobile, isTablet, darkMode, textSecondary, hoverBg, colors, formatTime, getDayName, cardBg, borderClass, textPrimary } = useDayPlannerCtx();
  const {
    routineDefinitions,
    dashboardSelectedChips, setDashboardSelectedChips,
    routineAddingToBucket, setRoutineAddingToBucket,
    routineNewChipName, setRoutineNewChipName,
    setRoutineTimePickerChipId,
    routineDeleteConfirm, setRoutineDeleteConfirm,
    routineFocusedChipId, setRoutineFocusedChipId,
    addRoutineChip, deleteRoutineChip, toggleRoutineChipSelection,
    multiUserEnabled, users, hrViewUserSyncId, setHrViewUserSyncId,
    managedBy, selectTodayChipsForOwner,
    meUserSyncId, hasUnownedRoutines, claimUnownedRoutines,
  } = useFeaturesCtx();

  const today = new Date();
  const todayDayName = getDayName(today);
  const weekDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const todayIdx = weekDays.indexOf(todayDayName);
  const rotatedDays = todayIdx >= 0 ? [...weekDays.slice(todayIdx), ...weekDays.slice(0, todayIdx)] : weekDays;
  const allBuckets = ['everyday', ...rotatedDays];
  const bucketLabel = (b) => b === 'everyday' ? 'Every Day' : b.charAt(0).toUpperCase() + b.slice(1);
  const isHighlighted = (b) => b === todayDayName || b === 'everyday';

  const hasAnyChips = Object.values(routineDefinitions).some(arr => arr.some(c => !String(c.id).startsWith('example-') && managedBy(c, hrViewUserSyncId)));

  return (
    <>
    <div className={`px-4 py-4 mobile-tab-fade-in`}>
      <div className="space-y-3">
        {multiUserEnabled && users.filter(u => !u.deleted).length > 0 && (
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
        )}
        {multiUserEnabled && hasUnownedRoutines && meUserSyncId && hrViewUserSyncId === meUserSyncId && (
          <div className={`px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-500/10' : 'bg-amber-50'} flex items-center justify-between gap-3`}>
            <p className={`text-xs ${textSecondary}`}>
              Some routines aren't assigned to anyone yet, so they show for every member. Claim them as yours.
            </p>
            <button
              type="button"
              onClick={() => claimUnownedRoutines()}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600"
            >
              Claim
            </button>
          </div>
        )}
        {/* Today's selected routine */}
        <div className={`rounded-lg border-2 border-dashed ${darkMode ? 'border-gray-600' : 'border-stone-300'} p-4`}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-3 ${textSecondary} text-center`}>Today's Routine</div>
          {dashboardSelectedChips.filter(c => !String(c.id).startsWith('example-')).length > 0 ? (
            <div className="flex flex-wrap gap-1.5 justify-center">
              {dashboardSelectedChips.filter(c => !String(c.id).startsWith('example-')).map(chip => {
                const isFocused = routineFocusedChipId === chip.id;
                return (
                <div
                  key={chip.id}
                  className={`group relative rounded-full px-3 py-1.5 text-xs font-medium cursor-pointer ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}
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
                >
                  <span className="flex items-center gap-1">
                    {chip.name}
                    {chip.startTime && (
                      <>
                        <Clock size={10} className="ml-0.5" />
                        <span className="opacity-90">{formatTime(chip.startTime)}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDashboardSelectedChips(prev => prev.map(c => c.id === chip.id ? { ...c, startTime: null } : c));
                          }}
                          className="hover:opacity-100 opacity-60 transition-opacity"
                          title="Clear time"
                        >
                          <X size={10} />
                        </button>
                      </>
                    )}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDashboardSelectedChips(prev => prev.filter(c => c.id !== chip.id)); setRoutineFocusedChipId(null); }}
                    className={`absolute -top-1.5 -right-1.5 transition-opacity ${darkMode ? 'bg-gray-500 text-white' : 'bg-stone-400 text-white'} rounded-full w-4 h-4 flex items-center justify-center ${
                      (isMobile || isTablet) ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Undo2 size={10} />
                  </button>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-4">
              <Sparkles size={28} className={`${textSecondary} mx-auto mb-2 opacity-40`} />
              <p className={`text-sm ${textSecondary}`}>
                {hasAnyChips ? 'Tap chips below to add to today' : 'Add routines with the + button below'}
              </p>
            </div>
          )}
        </div>

        {/* Day buckets */}
        {allBuckets.map(bucket => {
          const chips = (routineDefinitions[bucket] || []).filter(c => !String(c.id).startsWith('example-') && managedBy(c, hrViewUserSyncId));
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
              <div className="flex flex-wrap gap-1">
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
                      className={`group relative rounded-full px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${
                        isSelected
                          ? (darkMode ? 'bg-gray-600 text-gray-400' : 'bg-stone-200 text-stone-400')
                          : (darkMode ? 'bg-teal-700/80 text-teal-100 hover:bg-teal-600/80' : 'bg-teal-600/80 text-white hover:bg-teal-500/80')
                      }`}
                    >
                      {chip.name}
                      <button
                        onClick={(e) => { e.stopPropagation(); setRoutineDeleteConfirm({ bucket, chipId: chip.id, chipName: chip.name }); setRoutineFocusedChipId(null); }}
                        className={`absolute -top-1.5 -right-1.5 transition-opacity bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center ${
                          (isMobile || isTablet) ? (isFocused ? 'opacity-100' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-100'
                        }`}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  );
                })}
                {chips.length === 0 && routineAddingToBucket !== bucket && (
                  <span className={`text-xs ${textSecondary} italic`}>No routines</span>
                )}
              </div>
            </div>
          );
        })}

      </div>
    </div>

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

export default MobileRoutinesTab;
