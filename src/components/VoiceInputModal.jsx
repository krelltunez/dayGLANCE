import React from 'react';
import { BrainCircuit, Check, Loader, Mic, MicOff, Pencil, Plus, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import ClockTimePicker from './ClockTimePicker.jsx';
import { supportsTranscription } from '../ai.js';

const VoiceInputModal = () => {
  const {
    voiceTextareaRef,
    darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    isTablet, use24HourClock,
  } = useDayPlannerCtx();
  const {
    showVoiceInput, setShowVoiceInput,
    voiceIsRecording, voiceIsTranscribing, voiceIsParsing,
    voiceTranscript, setVoiceTranscript,
    voiceParsedTasks, setVoiceParsedTasks,
    voiceTaskTimePickerIdx, setVoiceTaskTimePickerIdx,
    voiceParsedEdits, setVoiceParsedEdits,
    voiceParseError, setVoiceParseError,
    voiceEditingParsed, setVoiceEditingParsed,
    voiceManualMode, setVoiceManualMode,
    voiceMicError, voiceCanRecord, voiceHasTranscription,
    voiceStartRecording, voiceStopRecording,
    voiceParseWithAI, voiceApplyAllChanges,
    aiConfig,
  } = useFeaturesCtx();

  return (
    <>
      {showVoiceInput && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { voiceStopRecording(); setShowVoiceInput(false); }}>
          <div
            className={`${cardBg} rounded-xl shadow-2xl ${borderClass} border w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className={`text-lg font-semibold ${textPrimary} flex items-center gap-2`}>
                  <Mic size={20} className="text-purple-400" />
                  Voice Input
                </h3>
                <button onClick={() => { voiceStopRecording(); setShowVoiceInput(false); }} className={`p-1 rounded-lg ${hoverBg}`}>
                  <X size={18} className={textSecondary} />
                </button>
              </div>

              {!voiceParsedTasks && !voiceParsedEdits ? (
                <>
                  {/* Recording UI — uses MediaRecorder + AI transcription (works in all browsers) */}
                  {!voiceManualMode && voiceCanRecord && voiceHasTranscription ? (
                    <div className="text-center space-y-4">
                      {/* Processing spinner (transcribe + parse) */}
                      {voiceIsTranscribing ? (
                        <div className="flex flex-col items-center gap-3 py-4">
                          <Loader size={32} className="animate-spin text-purple-400" />
                          <p className={`text-sm ${textSecondary}`}>{voiceIsParsing ? 'Parsing tasks...' : 'Transcribing...'}</p>
                        </div>
                      ) : (
                        <>
                          {/* Mic button */}
                          <button
                            onClick={voiceIsRecording ? voiceStopRecording : voiceStartRecording}
                            className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto transition-all ${
                              voiceIsRecording
                                ? 'bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-500/30'
                                : 'bg-purple-600 hover:bg-purple-700'
                            }`}
                          >
                            {voiceIsRecording ? <MicOff size={32} className="text-white" /> : <Mic size={32} className="text-white" />}
                          </button>
                          <p className={`text-sm ${textSecondary}`}>
                            {voiceIsRecording ? 'Recording... release Space or tap to stop' : 'Hold Space or tap to record'}
                          </p>
                        </>
                      )}

                      {/* Mic/transcription error */}
                      {voiceMicError === 'error' && voiceParseError && (
                        <div className={`text-left p-3 rounded-lg ${darkMode ? 'bg-red-900/30 border border-red-800/50' : 'bg-red-50 border border-red-200'} text-xs`}>
                          <p className="text-red-400">{voiceParseError}</p>
                        </div>
                      )}

                      {!voiceIsTranscribing && !voiceIsRecording && (
                        <button
                          onClick={() => setVoiceManualMode(true)}
                          className={`text-xs ${textSecondary} hover:underline`}
                        >
                          Or type instead <kbd className="ml-1 px-1 py-0.5 rounded bg-black/20 text-[10px] font-mono">T</kbd>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Text input — shown when voice not available or user chose to type */}
                      {!voiceCanRecord || !voiceHasTranscription ? (
                        <p className={`text-xs ${textSecondary}`}>
                          {!aiConfig.enabled
                            ? 'Configure an AI provider in settings to enable voice recording. Type your tasks below.'
                            : !supportsTranscription(aiConfig)
                            ? `${PROVIDER_LABELS[aiConfig.provider] || aiConfig.provider} doesn't support voice transcription. Use OpenAI or Gemini for voice, or type below.`
                            : 'Voice recording is not available. Type your tasks below.'}
                        </p>
                      ) : null}
                      <textarea
                        ref={voiceTextareaRef}
                        value={voiceTranscript}
                        onChange={(e) => setVoiceTranscript(e.target.value)}
                        placeholder="Add or edit tasks... e.g. &quot;call mom tomorrow at 3pm&quot; or &quot;move standup to Friday&quot; or &quot;mark report as done&quot;"
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'} text-sm resize-y min-h-[80px]`}
                        rows={3}
                        autoFocus
                      />
                      {voiceCanRecord && voiceHasTranscription && (
                        <button
                          onClick={() => { setVoiceManualMode(false); setVoiceTranscript(''); }}
                          className={`text-xs ${textSecondary} hover:underline`}
                        >
                          Use voice instead
                        </button>
                      )}
                    </div>
                  )}

                  {/* Parse button */}
                  {voiceTranscript.trim() && !voiceIsRecording && !voiceIsTranscribing && (
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        onClick={voiceParseWithAI}
                        disabled={voiceIsParsing}
                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm disabled:opacity-50"
                      >
                        {voiceIsParsing ? (
                          <Loader size={14} className="animate-spin" />
                        ) : aiConfig.enabled ? (
                          <BrainCircuit size={14} />
                        ) : (
                          <Plus size={14} />
                        )}
                        {voiceIsParsing ? 'Parsing...' : aiConfig.enabled ? 'Parse with AI' : 'Add as Task'}
                        {!voiceIsParsing && <kbd className="ml-1 px-1 py-0.5 rounded bg-white/20 text-[10px] font-mono">↵</kbd>}
                      </button>
                    </div>
                  )}

                  {voiceParseError && voiceMicError !== 'error' && (
                    <p className="text-xs text-amber-500 mt-2">
                      {voiceManualMode
                        ? voiceParseError
                        : `AI parsing error: ${voiceParseError}. Added as plain task.`}
                    </p>
                  )}
                </>
              ) : (
                <>
                  {/* Parsed new tasks preview */}
                  {voiceParsedTasks && voiceParsedTasks.length > 0 && (
                  <div className="space-y-3">
                    <p className={`text-sm ${textSecondary}`}>
                      {voiceParsedTasks.length === 1 ? '1 new task' : `${voiceParsedTasks.length} new tasks`}
                      {voiceParseError && <span className="text-amber-500"> (fallback — AI error)</span>}
                    </p>

                    {voiceParsedTasks.map((task, idx) => {
                      const priorityLabels = ['None', 'Low', 'Medium', 'High'];
                      const priorityColors = ['text-gray-400', 'text-blue-400', 'text-yellow-400', 'text-red-400'];
                      return (
                        <div key={idx} className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'} space-y-2`}>
                          {voiceEditingParsed === idx ? (
                            <div className="space-y-2">
                              <input
                                type="text"
                                value={task.title}
                                onChange={(e) => setVoiceParsedTasks(prev => prev.map((t, i) => i === idx ? { ...t, title: e.target.value } : t))}
                                className={`w-full px-2 py-1 border ${borderClass} rounded text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                                autoFocus
                              />
                              <div className="flex gap-2 flex-wrap">
                                <input
                                  type="date"
                                  value={task.date || ''}
                                  onChange={(e) => setVoiceParsedTasks(prev => prev.map((t, i) => i === idx ? { ...t, date: e.target.value || null } : t))}
                                  className={`px-2 py-1 border ${borderClass} rounded text-xs ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                                />
                                <button type="button" onClick={() => setVoiceTaskTimePickerIdx(idx)}
                                  className={`px-2 py-1 border ${borderClass} rounded text-xs ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}>
                                  {task.time || '––:––'}
                                </button>
                                <select
                                  value={task.duration}
                                  onChange={(e) => setVoiceParsedTasks(prev => prev.map((t, i) => i === idx ? { ...t, duration: Number(e.target.value) } : t))}
                                  className={`px-2 py-1 border ${borderClass} rounded text-xs ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                                >
                                  {[15, 30, 45, 60, 90, 120].map(d => (
                                    <option key={d} value={d}>{d}min</option>
                                  ))}
                                </select>
                                <select
                                  value={task.priority}
                                  onChange={(e) => setVoiceParsedTasks(prev => prev.map((t, i) => i === idx ? { ...t, priority: Number(e.target.value) } : t))}
                                  className={`px-2 py-1 border ${borderClass} rounded text-xs ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                                >
                                  {priorityLabels.map((l, i) => (
                                    <option key={i} value={i}>{l}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="flex justify-end">
                                <button
                                  onClick={() => setVoiceEditingParsed(null)}
                                  className="px-2 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700"
                                >
                                  Done
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className={`text-sm font-medium ${textPrimary}`}>{task.title}</p>
                                <div className={`flex items-center gap-2 flex-wrap mt-1 text-xs ${textSecondary}`}>
                                  {task.tags?.length > 0 && task.tags.map(tag => (
                                    <span key={tag} className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">#{tag}</span>
                                  ))}
                                  {task.date && <span>{task.date}</span>}
                                  {task.time && <span>{task.time}</span>}
                                  <span>{task.duration}min</span>
                                  {task.priority > 0 && (
                                    <span className={priorityColors[task.priority]}>
                                      {'!'.repeat(task.priority)} {priorityLabels[task.priority]}
                                    </span>
                                  )}
                                  {!task.date && <span className="italic">→ Inbox</span>}
                                </div>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setVoiceEditingParsed(idx)}
                                  className={`p-1 rounded ${hoverBg}`}
                                  title="Edit"
                                >
                                  <Pencil size={14} className={textSecondary} />
                                </button>
                                <button
                                  onClick={() => setVoiceParsedTasks(prev => prev.filter((_, i) => i !== idx))}
                                  className={`p-1 rounded ${hoverBg}`}
                                  title="Remove"
                                >
                                  <X size={14} className={textSecondary} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  )}

                  {/* Parsed edit commands preview */}
                  {voiceParsedEdits && voiceParsedEdits.length > 0 && (
                  <div className={`space-y-3 ${voiceParsedTasks && voiceParsedTasks.length > 0 ? 'mt-4' : ''}`}>
                    <p className={`text-sm ${textSecondary}`}>
                      {voiceParsedEdits.length === 1 ? '1 edit' : `${voiceParsedEdits.length} edits`}
                    </p>

                    {voiceParsedEdits.map((edit, idx) => {
                      const actionLabels = { move: 'Move', changeDuration: 'Duration', rename: 'Rename', delete: 'Delete', complete: 'Complete', uncomplete: 'Uncomplete', changePriority: 'Priority', addTag: 'Add Tag', removeTag: 'Remove Tag' };
                      const actionColors = { move: 'bg-blue-500/20 text-blue-300', changeDuration: 'bg-orange-500/20 text-orange-300', rename: 'bg-purple-500/20 text-purple-300', delete: 'bg-red-500/20 text-red-300', complete: 'bg-green-500/20 text-green-300', uncomplete: 'bg-yellow-500/20 text-yellow-300', changePriority: 'bg-amber-500/20 text-amber-300', addTag: 'bg-teal-500/20 text-teal-300', removeTag: 'bg-pink-500/20 text-pink-300' };
                      const priorityLabels = ['None', 'Low', 'Medium', 'High'];
                      // Describe what the edit will do
                      let changeDesc = '';
                      if (edit.action === 'move') changeDesc = `→ ${edit.date || ''}${edit.time ? ` at ${edit.time}` : ''}`;
                      else if (edit.action === 'changeDuration') changeDesc = `→ ${edit.duration}min`;
                      else if (edit.action === 'rename') changeDesc = `→ "${edit.newTitle}"`;
                      else if (edit.action === 'changePriority') changeDesc = `→ ${priorityLabels[edit.priority] || 'None'}`;
                      else if (edit.action === 'addTag') changeDesc = `→ #${edit.tag}`;
                      else if (edit.action === 'removeTag') changeDesc = `→ remove #${edit.tag}`;

                      return (
                        <div key={idx} className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${actionColors[edit.action] || 'bg-gray-500/20 text-gray-300'}`}>
                                  {actionLabels[edit.action] || edit.action}
                                </span>
                                {edit.resolvedTask ? (
                                  <span className={`text-sm font-medium ${textPrimary}`}>{edit.resolvedTask.title}</span>
                                ) : (
                                  <span className="text-sm text-red-400 italic">"{edit.taskMatch}" — not found</span>
                                )}
                              </div>
                              {changeDesc && (
                                <p className={`text-xs ${textSecondary} mt-1`}>{changeDesc}</p>
                              )}
                            </div>
                            <button
                              onClick={() => setVoiceParsedEdits(prev => prev.filter((_, i) => i !== idx))}
                              className={`p-1 rounded flex-shrink-0 ${hoverBg}`}
                              title="Remove"
                            >
                              <X size={14} className={textSecondary} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  )}

                  {/* No results message */}
                  {(!voiceParsedTasks || voiceParsedTasks.length === 0) && (!voiceParsedEdits || voiceParsedEdits.length === 0) && (
                    <p className={`text-sm ${textSecondary}`}>No tasks or edits were parsed from your input.</p>
                  )}

                  {/* Action buttons */}
                  <div className="mt-4 flex justify-between">
                    <button
                      onClick={() => { setVoiceParsedTasks(null); setVoiceParsedEdits(null); setVoiceParseError(''); }}
                      className={`px-3 py-2 text-sm ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}
                    >
                      Back
                    </button>
                    <button
                      onClick={voiceApplyAllChanges}
                      disabled={((!voiceParsedTasks || voiceParsedTasks.length === 0) && (!voiceParsedEdits || voiceParsedEdits.filter(e => e.resolvedTask).length === 0))}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm disabled:opacity-50"
                    >
                      <Check size={14} />
                      {(() => {
                        const newCount = voiceParsedTasks ? voiceParsedTasks.length : 0;
                        const editCount = voiceParsedEdits ? voiceParsedEdits.filter(e => e.resolvedTask).length : 0;
                        const total = newCount + editCount;
                        if (newCount > 0 && editCount > 0) return `Apply All (${total})`;
                        if (editCount > 0) return editCount === 1 ? 'Apply Edit' : `Apply Edits (${editCount})`;
                        return newCount === 1 ? 'Add Task' : `Add All (${newCount})`;
                      })()}
                      <kbd className="ml-1 px-1 py-0.5 rounded bg-white/20 text-[10px] font-mono">↵</kbd>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {voiceTaskTimePickerIdx !== null && voiceParsedTasks && voiceParsedTasks[voiceTaskTimePickerIdx] && (
        <ClockTimePicker
          value={voiceParsedTasks[voiceTaskTimePickerIdx].time || '09:00'}
          onChange={(t) => { setVoiceParsedTasks(prev => prev.map((v, i) => i === voiceTaskTimePickerIdx ? { ...v, time: t } : v)); setVoiceTaskTimePickerIdx(null); }}
          onClose={() => setVoiceTaskTimePickerIdx(null)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}

    </>
  );
};

export default VoiceInputModal;
