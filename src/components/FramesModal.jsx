import React from 'react';
import { X, Plus, LayoutGrid } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { DAY_LABELS } from '../constants/frames.js';
import FrameEditor from './FrameEditor.jsx';
import SmartSchedulePanel from './SmartSchedulePanel.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const FramesModal = () => {
  const { t } = useTranslation();
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
    gtdFrames, aiConfig,
    smartScheduleResults, smartScheduleLoading, smartScheduleError,
    smartScheduleAccepted, setSmartScheduleAccepted,
    runSmartSchedule, applySmartSchedule, setSmartScheduleResults, setSmartScheduleError,
    saveFrame, deleteFrame,
  } = useFeaturesCtx();

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
          {aiConfig?.enabled && aiConfig.features?.smartScheduling && (
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
                />
              ) : (
                <>
                  {(() => {
                    const todayStr = getTodayStr();
                    const visibleFrames = gtdFrames.filter(f => !f.singleDate || f.singleDate >= todayStr);
                    return visibleFrames.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 gap-3">
                      <LayoutGrid size={48} className={textSecondary} />
                      <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('frames.noFramesTitle')}</h3>
                      <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
                        {t('frames.noFramesDesc')}
                      </p>
                      <button
                        onClick={() => setEditingFrame('new')}
                        className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                      >
                        <Plus size={16} />
                        {t('frames.createFrame')}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {visibleFrames.map(frame => (
                        <div
                          key={frame.id}
                          onClick={() => setEditingFrame(frame)}
                          className={`p-3 rounded-lg border ${borderClass} cursor-pointer ${hoverBg} transition-colors`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-3 h-3 rounded-full ${frame.color}`} />
                            <span className={`font-medium text-sm ${textPrimary}`}>{frame.label}</span>
                            {frame.singleDate && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>{t('frames.oneTime')}</span>}
                            {!frame.enabled && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textSecondary}`}>{t('frames.frameOff')}</span>}
                          </div>
                          <div className={`text-xs ${textSecondary} mt-1`}>
                            {formatTime(frame.start)} – {formatTime(frame.end)} · {frame.singleDate
                              ? new Date(frame.singleDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              : frame.days.map(d => DAY_LABELS[d]).join(', ')}
                            {frame.energyLevel !== 'medium' && ` · ${frame.energyLevel} energy`}
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => setEditingFrame('new')}
                        className={`w-full p-3 rounded-lg border border-dashed ${borderClass} text-sm ${textSecondary} flex items-center justify-center gap-2 ${hoverBg} transition-colors`}
                      >
                        <Plus size={16} />
                        {t('frames.addFrame')}
                      </button>
                    </div>
                  );
                  })()}
                </>
              )}
            </>
          )}

          {aiConfig?.enabled && aiConfig.features?.smartScheduling && framesModalTab === 'schedule' && (
            <SmartSchedulePanel
              aiConfig={aiConfig}
              inboxTasks={unscheduledTasks.filter(t => !t.completed && !t.isExample)}
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
              gtdFrames={gtdFrames}
              formatTime={formatTime}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default FramesModal;
