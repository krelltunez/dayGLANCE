import React, { useState } from 'react';
import { X, Plus, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import FrameEditor from './FrameEditor.jsx';
import FrameSetsList from './FrameSetsList.jsx';
import SmartSchedulePanel from './SmartSchedulePanel.jsx';
import UserOwnerSwitcher from './UserOwnerSwitcher.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { notBucketed } from '../utils/bucketList.js';
import { localizedWeekdays } from '../utils/localeFormatting.js';
import { aiFeatureOn } from '../ai.js';

const FramesModal = () => {
  const { t } = useTranslation();
  const dayLabels = localizedWeekdays('short');
  const {
    allTags, unscheduledTasks,
    getTodayStr, formatTime,
    darkMode, isTablet, use24HourClock,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
  } = useDayPlannerCtx();
  const {
    setShowFramesModal,
    editingFrame, setEditingFrame,
    framesModalTab, setFramesModalTab,
    gtdFrames, myFrames, aiConfig,
    smartScheduleResults, smartScheduleLoading, smartScheduleError,
    smartScheduleAccepted, setSmartScheduleAccepted,
    runSmartSchedule, applySmartSchedule, setSmartScheduleResults, setSmartScheduleError,
    saveFrame, deleteFrame,
    multiUserEnabled, users, hrViewUserSyncId, setHrViewUserSyncId,
    managedBy, meUserSyncId, hasUnownedFrames, claimUnownedFrames,
    frameSets, frameSetsLoaded, createFrameSet, renameFrameSet, switchFrameSet, setFrameSetPeriods, deleteFrameSet,
  } = useFeaturesCtx();
  // The set a new frame starts in, when it was added from a set's section.
  const [newFrameSetId, setNewFrameSetId] = useState(null);
  // The sets this view manages, scoped like its frames (#2305).
  const visibleSets = (frameSets ?? []).filter(s => managedBy(s, hrViewUserSyncId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setShowFramesModal(false); setEditingFrame(null); }}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className={`relative ${cardBg} rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`sticky top-0 ${cardBg} z-10 px-6 pt-5 pb-3 border-b ${borderClass}`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className={`text-lg font-semibold ${textPrimary}`}>{t('frames.title')}</h2>
            <button onClick={() => { setShowFramesModal(false); setEditingFrame(null); }} className={`p-1.5 rounded-lg ${hoverBg} transition-colors`}>
              <X size={18} className={textSecondary} />
            </button>
          </div>
          {/* Tab switcher — only show when AI scheduling is enabled */}
          {aiFeatureOn(aiConfig, 'smartScheduling') && (
          <div className={`flex rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-stone-200'} p-0.5`}>
            <button
              onClick={() => setFramesModalTab('frames')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${framesModalTab === 'frames' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900 shadow-sm') : textSecondary}`}
            >
              {t('frames.tabMyFrames')}
            </button>
            <button
              onClick={() => setFramesModalTab('schedule')}
              className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${framesModalTab === 'schedule' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900 shadow-sm') : textSecondary}`}
            >
              {t('frames.tabSmartSchedule')}
            </button>
          </div>
          )}
        </div>

        <div className="px-6 py-4">
          {framesModalTab === 'frames' && (
            <>
              {editingFrame ? (
                <FrameEditor
                  frame={editingFrame === 'new' ? null : editingFrame}
                  onSave={saveFrame}
                  onDelete={deleteFrame}
                  onCancel={() => setEditingFrame(null)}
                  allTags={allTags}
                  darkMode={darkMode}
                  textPrimary={textPrimary}
                  textSecondary={textSecondary}
                  borderClass={borderClass}
                  cardBg={cardBg}
                  hoverBg={hoverBg}
                  existingFrames={gtdFrames}
                  use24HourClock={use24HourClock}
                  isTablet={isTablet}
                  frameSets={visibleSets}
                  defaultSetId={editingFrame === 'new' ? newFrameSetId : null}
                />
              ) : (
                <>
                  {multiUserEnabled && users.filter(u => !u.deleted).length > 0 && (
                    <div className="mb-3">
                      <UserOwnerSwitcher
                        enabled={multiUserEnabled}
                        users={users}
                        value={hrViewUserSyncId}
                        onChange={setHrViewUserSyncId}
                        darkMode={darkMode}
                        borderClass={borderClass}
                        textSecondary={textSecondary}
                        label="Frames for"
                      />
                      {hasUnownedFrames && meUserSyncId && hrViewUserSyncId === meUserSyncId && (
                        <div className={`mt-3 px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-amber-500/10' : 'bg-amber-50'} flex items-center justify-between gap-3`}>
                          <p className={`text-xs ${textSecondary}`}>
                            Some frames aren't assigned to anyone yet. Claim them as yours so they stay tied to you across devices.
                          </p>
                          <button
                            type="button"
                            onClick={() => claimUnownedFrames()}
                            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600"
                          >
                            Claim
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  {(() => {
                    const todayStr = getTodayStr();
                    const visibleFrames = gtdFrames.filter(f => (!f.singleDate || f.singleDate >= todayStr) && managedBy(f, hrViewUserSyncId));
                    return visibleFrames.length === 0 && visibleSets.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <LayoutGrid size={48} className={textSecondary} />
                      <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('frames.noFramesTitle')}</h3>
                      <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
                        {t('frames.noFramesDesc')}
                      </p>
                      <button
                        onClick={() => { setNewFrameSetId(null); setEditingFrame('new'); }}
                        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                      >
                        <Plus size={16} />
                        {t('frames.createFrame')}
                      </button>
                    </div>
                  ) : (
                    <FrameSetsList
                      frames={visibleFrames}
                      frameSets={visibleSets}
                      frameSetsLoaded={frameSetsLoaded}
                      todayStr={todayStr}
                      onEditFrame={setEditingFrame}
                      onAddFrame={(setId) => { setNewFrameSetId(setId); setEditingFrame('new'); }}
                      onSwitchSet={switchFrameSet}
                      onRenameSet={renameFrameSet}
                      onSetPeriods={setFrameSetPeriods}
                      onDeleteSet={deleteFrameSet}
                      onCreateSet={createFrameSet}
                      darkMode={darkMode}
                      textPrimary={textPrimary}
                      textSecondary={textSecondary}
                      borderClass={borderClass}
                      hoverBg={hoverBg}
                      formatTime={formatTime}
                      dayLabels={dayLabels}
                      offLabel={t('frames.frameOff')}
                    />
                  );
                  })()}
                </>
              )}
            </>
          )}

          {aiFeatureOn(aiConfig, 'smartScheduling') && framesModalTab === 'schedule' && (
            <SmartSchedulePanel
              aiConfig={aiConfig}
              inboxTasks={unscheduledTasks.filter(t => notBucketed(t) && !t.completed && !t.isExample)}
              smartScheduleResults={smartScheduleResults}
              smartScheduleLoading={smartScheduleLoading}
              smartScheduleError={smartScheduleError}
              smartScheduleAccepted={smartScheduleAccepted}
              setSmartScheduleAccepted={setSmartScheduleAccepted}
              onRun={runSmartSchedule}
              onApply={applySmartSchedule}
              onCancel={() => { setSmartScheduleResults(null); setSmartScheduleError(''); }}
              darkMode={darkMode}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              borderClass={borderClass}
              cardBg={cardBg}
              hoverBg={hoverBg}
              gtdFrames={myFrames}
              formatTime={formatTime}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default FramesModal;
