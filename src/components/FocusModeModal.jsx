import React from 'react';
import { X, Target, Pause, Play, Check, Trophy } from 'lucide-react';
import { isNativeAndroid, nativeIsDndPermissionGranted, nativeRequestDndPermission } from '../native.js';
import { stripWikilinks, extractWikilinks } from '../utils/taskUtils.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const FocusModeModal = () => {
  const {
    exitFocusMode, startFocusTimer, dismissFocusStats,
    focusShowSettings, focusShowStats,
    focusWorkMinutes, setFocusWorkMinutes,
    focusBreakMinutes, setFocusBreakMinutes,
    focusLongBreakMinutes, setFocusLongBreakMinutes,
    focusBlockTasks,
    focusPhase, focusCycleCount,
    focusTimerSeconds,
    focusTimerRunning, setFocusTimerRunning,
    focusCompletedTasks, focusCompleteTask,
    focusSessionStart,
    focusUpdateTaskNotes, focusAddSubtask, focusToggleSubtask,
    focusDeleteSubtask, focusUpdateSubtaskTitle,
    currentTime,
    isPhone, isTablet,
    aiConfig, aiSubtasksLoadingForTask, generateAISubtasks,
    loadWikiNote, saveWikiNote,
    formatTime, minutesToTime, timeToMinutes,
  } = useDayPlannerCtx();

  return (
    <div className="fixed inset-0 bg-gray-950 z-[70] flex flex-col items-center overflow-y-auto">
      {/* Exit button */}
      <button
        onClick={() => exitFocusMode(true)}
        className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors z-10"
      >
        <X size={28} />
      </button>

      {/* Settings view */}
      {focusShowSettings && !focusShowStats && (
        <div className="w-full max-w-md px-6 py-8 my-auto flex flex-col items-center gap-6">
          <Target size={48} className="text-blue-400" />
          <h1 className="text-2xl font-bold text-white">Focus Mode</h1>

          {/* Interval controls */}
          <div className="w-full space-y-3">
            {[
              { label: 'Work', value: focusWorkMinutes, set: setFocusWorkMinutes },
              { label: 'Break', value: focusBreakMinutes, set: setFocusBreakMinutes },
              { label: 'Long Break', value: focusLongBreakMinutes, set: setFocusLongBreakMinutes },
            ].map(({ label, value, set }) => (
              <div key={label} className="flex items-center justify-between bg-gray-800 rounded-lg px-4 py-3">
                <span className="text-gray-300 text-sm">{label}</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => set(Math.max(1, value - 5))} className="w-8 h-8 rounded-full bg-gray-700 text-white hover:bg-gray-600 flex items-center justify-center text-lg font-bold">-</button>
                  <span className="text-white font-mono w-12 text-center">{value}m</span>
                  <button onClick={() => set(value + 5)} className="w-8 h-8 rounded-full bg-gray-700 text-white hover:bg-gray-600 flex items-center justify-center text-lg font-bold">+</button>
                </div>
              </div>
            ))}
          </div>

          {/* Task preview */}
          <div className="w-full space-y-2">
            <h3 className="text-sm text-gray-400 font-medium">Tasks in this block</h3>
            {focusBlockTasks.map(task => (
              <div key={task.id} className="flex items-center gap-3 bg-gray-800/50 rounded-lg px-3 py-2">
                <div className={`w-3 h-3 rounded-full ${task.color} flex-shrink-0`} />
                <span className="text-gray-200 text-sm truncate flex-1">{stripWikilinks(task.title)}</span>
                <span className="text-gray-500 text-xs">{task.duration}m</span>
              </div>
            ))}
          </div>

          {/* Android DND permission prompt */}
          {isNativeAndroid() && !nativeIsDndPermissionGranted() && (
            <div className="w-full flex items-center justify-between bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3 text-sm">
              <span className="text-gray-300">Enable Do Not Disturb during focus?</span>
              <button
                onClick={nativeRequestDndPermission}
                className="ml-3 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors flex-shrink-0"
              >
                Grant access
              </button>
            </div>
          )}

          <button
            onClick={startFocusTimer}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-lg"
          >
            Start Focus Session
          </button>
        </div>
      )}

      {/* Main focus view */}
      {!focusShowSettings && !focusShowStats && (
        <div className="w-full max-w-lg px-6 py-8 my-auto flex flex-col items-center gap-6">
          {/* Phase indicator */}
          <div className="flex items-center gap-3">
            <span className={`px-4 py-1.5 rounded-full text-sm font-medium ${
              focusPhase === 'work' ? 'bg-blue-600 text-white' :
              focusPhase === 'shortBreak' ? 'bg-green-600 text-white' :
              'bg-purple-600 text-white'
            }`}>
              {focusPhase === 'work' ? 'Work' : focusPhase === 'shortBreak' ? 'Short Break' : 'Long Break'}
            </span>
            <span className="text-gray-500 text-sm">Cycle {(focusPhase === 'work' ? focusCycleCount % 4 : (focusCycleCount - 1 + 4) % 4) + 1} of 4</span>
          </div>

          {/* Countdown */}
          <div className="text-8xl font-mono text-white font-bold tracking-wider">
            {String(Math.floor(focusTimerSeconds / 60)).padStart(2, '0')}:{String(focusTimerSeconds % 60).padStart(2, '0')}
          </div>

          {/* Pause/Resume */}
          <button
            onClick={() => setFocusTimerRunning(prev => !prev)}
            className="w-14 h-14 rounded-full bg-gray-800 hover:bg-gray-700 text-white flex items-center justify-center transition-colors"
          >
            {focusTimerRunning ? <Pause size={24} /> : <Play size={24} />}
          </button>

          {/* Pomodoro cycle dots */}
          <div className="flex gap-3">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full transition-all ${
                  i < (focusCycleCount % 4) ? 'bg-blue-500' :
                  i === (focusCycleCount % 4) && focusPhase === 'work' ? 'bg-blue-500 animate-pulse' :
                  'bg-gray-700'
                }`}
              />
            ))}
          </div>

          {/* Task cards */}
          <div className="w-full space-y-2 mt-4">
            {focusBlockTasks.map(task => {
              const isDone = task.completed || focusCompletedTasks.has(task.id);
              return (
                <div key={task.id} className={`bg-gray-800 rounded-lg p-3 flex flex-col gap-2 transition-opacity ${isDone ? 'opacity-40' : ''}`}>
                  {/* Header row: dot + title/time + complete button */}
                  <div className="flex items-start gap-3">
                    <div className={`w-3 h-3 rounded-full ${task.color} flex-shrink-0 mt-1`} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${isDone ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{stripWikilinks(task.title)}</div>
                      <div className="text-xs text-gray-500">{formatTime(task.startTime)} - {formatTime(minutesToTime(timeToMinutes(task.startTime) + task.duration))}</div>
                    </div>
                    {!isDone && (
                      <button
                        onClick={() => focusCompleteTask(task.id)}
                        className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg transition-colors flex-shrink-0"
                      >
                        Complete
                      </button>
                    )}
                    {isDone && (
                      <Check size={18} className="text-green-500 flex-shrink-0 mt-0.5" />
                    )}
                  </div>
                  {/* Notes/subtasks panel — full card width */}
                  {!isDone && ((task.notes && task.notes.trim()) || (task.subtasks && task.subtasks.length > 0) || (!isPhone && !isTablet && task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0)) && (
                    <NotesSubtasksPanel
                      task={task}
                      isInbox={false}
                      darkMode={true}
                      updateTaskNotes={focusUpdateTaskNotes}
                      addSubtask={focusAddSubtask}
                      toggleSubtask={focusToggleSubtask}
                      deleteSubtask={focusDeleteSubtask}
                      updateSubtaskTitle={focusUpdateSubtaskTitle}
                      compact={false}
                      noAutoFocus
                      aiConfig={aiConfig}
                      aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                      onGenerateSubtasks={generateAISubtasks}
                      wikilinks={!isPhone && !isTablet && task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
                      onLoadWikiNote={!isPhone && !isTablet && task.importSource === 'obsidian' ? loadWikiNote : undefined}
                      onSaveWikiNote={!isPhone && !isTablet && task.importSource === 'obsidian' ? saveWikiNote : undefined}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Session elapsed time */}
          {focusSessionStart && (
            <div className="text-gray-500 text-sm mt-4">
              Session: {Math.floor((currentTime - focusSessionStart) / 60000)}m elapsed
            </div>
          )}
        </div>
      )}

      {/* Stats view */}
      {focusShowStats && (
        <div className="w-full max-w-sm px-6 py-8 my-auto flex flex-col items-center gap-6">
          <Trophy size={48} className="text-yellow-400" />
          <h1 className="text-2xl font-bold text-white">Session Complete!</h1>

          <div className="w-full space-y-3">
            <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
              <span className="text-gray-400">Total time</span>
              <span className="text-white font-medium">{focusSessionStart ? `${Math.floor((currentTime - focusSessionStart) / 60000)}m` : '0m'}</span>
            </div>
            <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
              <span className="text-gray-400">Tasks completed</span>
              <span className="text-white font-medium">{focusCompletedTasks.size}</span>
            </div>
            <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
              <span className="text-gray-400">Pomodoro cycles</span>
              <span className="text-white font-medium">{focusCycleCount}</span>
            </div>
          </div>

          <button
            onClick={dismissFocusStats}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors text-lg"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
};

export default FocusModeModal;
