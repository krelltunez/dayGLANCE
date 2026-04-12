import React, { useEffect, useRef, useState } from 'react';
import * as Icons from 'lucide-react';
import { Check, CheckCircle, ChevronDown, ChevronUp, Pause, Play, Plus, SkipForward, Trophy, X, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { extractWikilinks, stripWikilinks } from '../utils/taskUtils.js';

const HyperGlanceModeModal = () => {
  const {
    currentTime, darkMode, isPhone,
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    aiSubtasksLoadingForTask,
    generateAISubtasks,
  } = useDayPlannerCtx();

  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();

  const {
    projects, updateProject,
    hyperGlanceProjectId,
    hyperGlanceSessionDate,
    hgTimerSeconds, setHgTimerSeconds,
    hgTimerRunning, setHgTimerRunning,
    hgTimerPhase, setHgTimerPhase,
    hgWorkMinutes, setHgWorkMinutes,
    hgBreakMinutes, setHgBreakMinutes,
    hgCycleCount, setHgCycleCount,
    hgExitConfirm, setHgExitConfirm,
    hgShowSettings, setHgShowSettings,
    exitHyperGlanceMode,
    completeHyperGlanceSession,
    aiConfig,
  } = useFeaturesCtx();

  const timerRef = useRef(null);
  const sessionStartRef = useRef(null);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [expandedTaskId, setExpandedTaskId] = useState(null);
  const [hgCompleted, setHgCompleted] = useState(false); // session auto-completed

  const project = projects.find(p => p.id === hyperGlanceProjectId);
  const hg = project?.hyperglance;
  const barColor = hg?.color || '#4f46e5';
  const IconComp = Icons[hg?.icon] || Icons.Sparkles;

  // All project tasks (unscheduled + scheduled), not archived, sorted: incomplete first
  const projectTasks = [...tasks, ...unscheduledTasks]
    .filter(t => t.projectId === hyperGlanceProjectId && !t.archived)
    .sort((a, b) => {
      if (a.completed && !b.completed) return 1;
      if (!a.completed && b.completed) return -1;
      return 0;
    });

  const allDone = projectTasks.length > 0 && projectTasks.every(t => t.completed);

  // Auto-complete when all tasks are checked
  useEffect(() => {
    if (allDone && !hgCompleted && !hgShowSettings) {
      setHgCompleted(true);
      completeHyperGlanceSession();
    }
  }, [allDone, hgCompleted, hgShowSettings]);

  // Timer countdown
  useEffect(() => {
    if (hgTimerRunning) {
      timerRef.current = setInterval(() => {
        setHgTimerSeconds(prev => {
          if (prev <= 1) {
            if (hgTimerPhase === 'work') {
              setHgTimerPhase('break');
              setHgCycleCount(c => c + 1);
              return hgBreakMinutes * 60;
            } else {
              setHgTimerPhase('work');
              return hgWorkMinutes * 60;
            }
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [hgTimerRunning, hgTimerPhase, hgWorkMinutes, hgBreakMinutes]);

  // Session elapsed clock
  useEffect(() => {
    if (hgTimerRunning && !sessionStartRef.current) {
      sessionStartRef.current = Date.now();
    }
    const interval = setInterval(() => {
      if (sessionStartRef.current) {
        setSessionElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [hgTimerRunning]);

  const handleStart = () => {
    setHgShowSettings(false);
    setHgTimerSeconds(hgWorkMinutes * 60);
    setHgTimerRunning(true);
    setHgTimerPhase('work');
    setHgCycleCount(0);
    sessionStartRef.current = Date.now();
  };

  const handleToggleTask = (taskId) => {
    const inScheduled = tasks.find(t => t.id === taskId);
    if (inScheduled) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: !t.completed, updatedAt: new Date().toISOString() } : t));
    } else {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: !t.completed, updatedAt: new Date().toISOString() } : t));
    }
  };

  const formatTimer = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const formatElapsed = (seconds) => {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m`;
  };

  if (!project) return null;

  // ── Settings / pre-session view ────────────────────────────────────────────
  if (hgShowSettings) {
    return (
      <div className="fixed inset-0 z-[200] bg-gray-950 flex flex-col items-center justify-center">
        <div className="w-full max-w-md px-6 py-8 flex flex-col gap-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${barColor}30` }}>
                <IconComp size={20} style={{ color: barColor }} />
              </div>
              <div>
                <div className="text-white font-bold text-lg leading-tight">{project.title}</div>
                <div className="text-gray-400 text-sm">{hyperGlanceSessionDate}</div>
              </div>
            </div>
            <button onClick={() => exitHyperGlanceMode()} className="text-gray-500 hover:text-gray-300 p-1">
              <X size={20} />
            </button>
          </div>

          {/* Timer settings */}
          <div className="space-y-3">
            <div className="text-gray-400 text-xs font-semibold uppercase tracking-wide">Timer (Pomodoro)</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-gray-400 text-xs">Work (min)</span>
                <input
                  type="number"
                  min={1} max={120}
                  value={hgWorkMinutes}
                  onChange={e => setHgWorkMinutes(Math.max(1, parseInt(e.target.value) || 25))}
                  className="bg-transparent text-white text-xl font-bold w-full focus:outline-none"
                />
              </div>
              <div className="bg-gray-800 rounded-xl p-3 flex flex-col gap-1">
                <span className="text-gray-400 text-xs">Break (min)</span>
                <input
                  type="number"
                  min={1} max={60}
                  value={hgBreakMinutes}
                  onChange={e => setHgBreakMinutes(Math.max(1, parseInt(e.target.value) || 5))}
                  className="bg-transparent text-white text-xl font-bold w-full focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Task preview */}
          {projectTasks.length > 0 && (
            <div className="space-y-2">
              <div className="text-gray-400 text-xs font-semibold uppercase tracking-wide">
                Tasks ({projectTasks.filter(t => !t.completed).length} remaining)
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {projectTasks.map(t => (
                  <div key={t.id} className={`flex items-center gap-2 text-sm py-1 ${t.completed ? 'opacity-40 line-through text-gray-500' : 'text-gray-200'}`}>
                    {t.completed ? <CheckCircle size={14} className="text-green-500 flex-shrink-0" /> : <div className="w-3.5 h-3.5 rounded border border-gray-500 flex-shrink-0" />}
                    {stripWikilinks(t.title)}
                  </div>
                ))}
              </div>
            </div>
          )}

          {projectTasks.length === 0 && (
            <p className="text-gray-500 text-sm text-center py-2">
              No tasks yet — add project tasks in the Goals dashboard.
            </p>
          )}

          {/* Start button */}
          <button
            onClick={handleStart}
            className="w-full py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
            style={{ backgroundColor: barColor }}
          >
            <Zap size={20} />
            Start hyperGLANCE
          </button>
        </div>
      </div>
    );
  }

  // ── Post-completion view ───────────────────────────────────────────────────
  if (hgCompleted) {
    const elapsed = sessionElapsed;
    return (
      <div className="fixed inset-0 z-[200] bg-gray-950 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm px-6 py-8 flex flex-col items-center gap-6">
          <Trophy size={48} className="text-yellow-400" />
          <h1 className="text-2xl font-bold text-white">Session Complete!</h1>
          <div className="text-gray-400 text-center text-sm">{project.title}</div>

          <div className="w-full space-y-3">
            <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
              <span className="text-gray-400">Tasks completed</span>
              <span className="text-white font-semibold">{projectTasks.filter(t => t.completed).length} / {projectTasks.length}</span>
            </div>
            {elapsed > 0 && (
              <div className="flex justify-between bg-gray-800 rounded-lg px-4 py-3">
                <span className="text-gray-400">Session time</span>
                <span className="text-white font-semibold">{formatElapsed(elapsed)}</span>
              </div>
            )}
          </div>

          <button
            onClick={() => exitHyperGlanceMode()}
            className="w-full py-3 rounded-xl text-white font-semibold text-base"
            style={{ backgroundColor: barColor }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  // ── Exit confirmation dialog ───────────────────────────────────────────────
  if (hgExitConfirm) {
    return (
      <div className="fixed inset-0 z-[200] bg-gray-950 flex flex-col items-center justify-center">
        <div className="w-full max-w-sm px-6 py-8 flex flex-col items-center gap-5">
          <X size={40} className="text-gray-400" />
          <h2 className="text-xl font-bold text-white text-center">Leave hyperGLANCE?</h2>
          <p className="text-gray-400 text-sm text-center">
            Your progress is saved. Choose to pause and return later, or end the session.
          </p>
          <div className="w-full flex flex-col gap-3">
            <button
              onClick={() => { setHgTimerRunning(false); setHgExitConfirm(false); exitHyperGlanceMode(); }}
              className="w-full py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-semibold transition-colors"
            >
              Pause — I'll come back
            </button>
            <button
              onClick={() => { setHgExitConfirm(false); completeHyperGlanceSession(); }}
              className="w-full py-3 rounded-xl text-white font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: barColor }}
            >
              End Session
            </button>
            <button
              onClick={() => setHgExitConfirm(false)}
              className="text-gray-500 hover:text-gray-300 text-sm text-center py-1"
            >
              Cancel — keep going
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main session view ──────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[200] bg-gray-950 flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${barColor}30` }}>
            <IconComp size={14} style={{ color: barColor }} />
          </div>
          <span className="text-white font-semibold text-sm truncate max-w-[160px]">{project.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            hgTimerPhase === 'work' ? 'bg-blue-900 text-blue-300' : 'bg-green-900 text-green-300'
          }`}>
            {hgTimerPhase === 'work' ? 'Work' : 'Break'} · Cycle {hgCycleCount + 1}
          </span>
          <button onClick={() => setHgExitConfirm(true)} className="text-gray-500 hover:text-gray-300 p-1">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className={`${isPhone ? 'px-4 py-5' : 'px-6 py-6'} max-w-lg mx-auto flex flex-col gap-6`}>
          {/* Timer */}
          <div className="flex flex-col items-center gap-4">
            <div className="text-7xl font-mono text-white font-bold tracking-wider tabular-nums">
              {formatTimer(hgTimerSeconds)}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setHgTimerRunning(prev => !prev)}
                className="w-12 h-12 rounded-full flex items-center justify-center text-white transition-colors"
                style={{ backgroundColor: barColor }}
              >
                {hgTimerRunning ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button
                onClick={() => {
                  setHgTimerPhase(p => p === 'work' ? 'break' : 'work');
                  setHgTimerSeconds(hgTimerPhase === 'work' ? hgBreakMinutes * 60 : hgWorkMinutes * 60);
                }}
                className="w-9 h-9 rounded-full bg-gray-800 hover:bg-gray-700 flex items-center justify-center text-gray-400 transition-colors"
                title="Skip phase"
              >
                <SkipForward size={16} />
              </button>
            </div>
            {/* Cycle dots */}
            <div className="flex gap-2">
              {[0, 1, 2, 3].map(i => (
                <div
                  key={i}
                  className={`w-3 h-3 rounded-full transition-all ${
                    i < (hgCycleCount % 4) ? 'bg-blue-500' :
                    i === (hgCycleCount % 4) && hgTimerPhase === 'work' ? 'bg-blue-500 animate-pulse' :
                    'bg-gray-700'
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Tasks */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-xs font-semibold uppercase tracking-wide">
                Tasks · {projectTasks.filter(t => !t.completed).length} remaining
              </span>
              {sessionElapsed > 0 && (
                <span className="text-gray-600 text-xs">{formatElapsed(sessionElapsed)} elapsed</span>
              )}
            </div>

            {projectTasks.length === 0 && (
              <p className="text-gray-600 text-sm text-center py-4">
                No tasks — add them in the Goals dashboard.
              </p>
            )}

            {projectTasks.map(task => {
              const isDone = task.completed;
              const isExpanded = expandedTaskId === task.id;
              const hasExtra = (task.notes && task.notes.trim()) || (task.subtasks && task.subtasks.length > 0);

              return (
                <div
                  key={task.id}
                  className={`rounded-xl p-3 transition-opacity ${isDone ? 'opacity-40 bg-gray-900' : 'bg-gray-800'}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => handleToggleTask(task.id)}
                      className={`w-5 h-5 rounded flex-shrink-0 mt-0.5 border-2 flex items-center justify-center transition-colors ${
                        isDone ? 'border-green-500 bg-green-500' : 'border-gray-500 bg-transparent hover:border-gray-300'
                      }`}
                    >
                      {isDone && <Check size={11} className="text-white" />}
                    </button>
                    <span className={`flex-1 text-sm leading-snug min-w-0 ${isDone ? 'text-gray-500 line-through' : 'text-gray-100'}`}>
                      {stripWikilinks(task.title)}
                    </span>
                    {!isDone && (
                      <button
                        onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                        className="text-gray-500 hover:text-gray-300 p-0.5 flex-shrink-0"
                      >
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    )}
                  </div>

                  {/* Notes & subtasks panel */}
                  {isExpanded && !isDone && (
                    <div className="mt-2 pl-8">
                      <NotesSubtasksPanel
                        task={task}
                        isInbox={false}
                        darkMode={true}
                        updateTaskNotes={updateTaskNotes}
                        addSubtask={addSubtask}
                        toggleSubtask={toggleSubtask}
                        deleteSubtask={deleteSubtask}
                        updateSubtaskTitle={updateSubtaskTitle}
                        compact={false}
                        noAutoFocus
                        aiConfig={aiConfig}
                        aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                        onGenerateSubtasks={generateAISubtasks}
                        wikilinks={!isPhone && extractWikilinks(task.title).length > 0 ? extractWikilinks(task.title) : undefined}
                        onLoadWikiNote={!isPhone && extractWikilinks(task.title).length > 0 ? loadWikiNote : undefined}
                        onSaveWikiNote={!isPhone && extractWikilinks(task.title).length > 0 ? saveWikiNote : undefined}
                        onOpenInObsidian={!isPhone && extractWikilinks(task.title).length > 0 ? openInObsidian : undefined}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 flex gap-3 px-4 py-4 border-t border-gray-800">
        <button
          onClick={() => { setHgTimerRunning(false); exitHyperGlanceMode(); }}
          className="flex-1 py-3 rounded-xl bg-gray-700 hover:bg-gray-600 text-white font-semibold text-sm transition-colors"
        >
          Pause
        </button>
        <button
          onClick={() => setHgExitConfirm(true)}
          className="flex-1 py-3 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: barColor }}
        >
          End Session
        </button>
      </div>
    </div>
  );
};

export default HyperGlanceModeModal;
