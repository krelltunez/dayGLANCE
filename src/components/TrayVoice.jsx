import { Mic, MicOff, X, Loader, RotateCcw } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

export default function TrayVoice({ darkMode, onClose }) {
  const { textPrimary, textSecondary, borderClass, cardBg } = useDayPlannerCtx();
  const {
    aiConfig,
    voiceCanRecord, voiceMicError,
    voiceIsRecording, voiceIsTranscribing, voiceIsParsing,
    voiceTranscript, setVoiceTranscript,
    voiceParsedTasks, setVoiceParsedTasks,
    voiceParsedEdits,
    voiceParseError,
    voiceManualMode, setVoiceManualMode,
    voiceStartRecording, voiceStopRecording,
    voiceParseWithAI, voiceApplyAllChanges,
    voiceHasTranscription,
  } = useFeaturesCtx();

  const hasParsed = voiceParsedTasks !== null && (voiceParsedTasks?.length > 0 || voiceParsedEdits?.length > 0);
  const isProcessing = voiceIsTranscribing || voiceIsParsing;
  const canParse = aiConfig?.enabled && (voiceHasTranscription || voiceTranscript?.trim());

  const handleApply = () => {
    voiceApplyAllChanges();
    onClose();
  };

  const handleBack = () => {
    setVoiceParsedTasks(null);
  };

  // ── Preview phase ────────────────────────────────────────────────────────
  if (hasParsed) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden px-3 pb-3">
        <div className={`flex items-center justify-between py-2.5 border-b ${borderClass} mb-3`}>
          <span className={`text-sm font-semibold ${textPrimary}`}>
            {(voiceParsedTasks?.length ?? 0) + (voiceParsedEdits?.length ?? 0)} change{(voiceParsedTasks?.length ?? 0) + (voiceParsedEdits?.length ?? 0) !== 1 ? 's' : ''} to apply
          </span>
          <button onClick={onClose} className={`${textSecondary} hover:opacity-70`}><X size={15} /></button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-1.5 mb-3">
          {(voiceParsedTasks || []).map((t, i) => (
            <div key={i} className={`${cardBg} rounded-lg px-3 py-2`}>
              <div className={`text-sm font-medium ${textPrimary} truncate`}>{t.title}</div>
              {(t.date || t.startTime) && (
                <div className={`text-xs ${textSecondary} mt-0.5`}>
                  {t.date && <span>{t.date}</span>}
                  {t.startTime && <span> at {t.startTime}</span>}
                </div>
              )}
            </div>
          ))}
          {(voiceParsedEdits || []).map((edit, i) => (
            <div key={`edit-${i}`} className={`${cardBg} rounded-lg px-3 py-2`}>
              <div className={`text-xs font-medium text-blue-400 mb-0.5 uppercase tracking-wide`}>{edit.action}</div>
              <div className={`text-sm ${textPrimary} truncate`}>{edit.taskTitle ?? edit.id}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={handleBack}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 ${
              darkMode ? 'bg-white/10 text-gray-300' : 'bg-black/5 text-stone-600'
            }`}
          >
            Back
          </button>
          <button
            onClick={handleApply}
            className="flex-1 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white transition-opacity hover:opacity-90"
          >
            Add all
          </button>
        </div>
      </div>
    );
  }

  // ── Input phase ──────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden px-3 pb-3">
      <div className={`flex items-center justify-between py-2.5 border-b ${borderClass} mb-3`}>
        <span className={`text-sm font-semibold ${textPrimary}`}>Voice input</span>
        <button onClick={onClose} className={`${textSecondary} hover:opacity-70`}><X size={15} /></button>
      </div>

      {/* Mic button */}
      {voiceCanRecord && !voiceManualMode && (
        <div className="flex justify-center mb-3">
          <button
            onClick={voiceIsRecording ? voiceStopRecording : voiceStartRecording}
            disabled={isProcessing}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all ${
              voiceIsRecording
                ? 'bg-red-500 animate-pulse shadow-lg shadow-red-500/40'
                : isProcessing
                  ? darkMode ? 'bg-white/10 text-gray-500' : 'bg-black/5 text-stone-400'
                  : 'bg-blue-500 hover:bg-blue-600 shadow-lg shadow-blue-500/30'
            }`}
          >
            {isProcessing
              ? <Loader size={22} className="text-white animate-spin" />
              : voiceIsRecording
                ? <MicOff size={22} className="text-white" />
                : <Mic size={22} className="text-white" />
            }
          </button>
          {!voiceIsRecording && !isProcessing && (
            <button
              onClick={() => setVoiceManualMode(true)}
              className={`ml-3 self-center text-xs ${textSecondary} hover:opacity-70 underline underline-offset-2`}
            >
              type instead
            </button>
          )}
        </div>
      )}

      {/* Status */}
      {(voiceIsRecording || isProcessing) && (
        <p className={`text-xs text-center ${textSecondary} mb-2`}>
          {voiceIsRecording ? 'Recording… tap to stop' : voiceIsTranscribing ? 'Transcribing…' : 'Parsing…'}
        </p>
      )}

      {/* Transcript / manual textarea */}
      {(voiceHasTranscription || voiceManualMode || !voiceCanRecord) && !isProcessing && (
        <textarea
          className={`flex-1 text-sm px-3 py-2 rounded-lg outline-none resize-none ${
            darkMode ? 'bg-white/10 text-white placeholder-gray-500' : 'bg-black/5 text-stone-900 placeholder-stone-400'
          }`}
          placeholder="Describe tasks to add or changes to make…"
          value={voiceTranscript || ''}
          onChange={e => setVoiceTranscript(e.target.value)}
          rows={4}
        />
      )}

      {/* Error */}
      {voiceParseError && (
        <p className="text-xs text-red-400 mt-1">{voiceParseError}</p>
      )}
      {voiceMicError && (
        <p className="text-xs text-red-400 mt-1">{voiceMicError}</p>
      )}

      {/* Parse / reset */}
      {!isProcessing && canParse && (
        <button
          onClick={voiceParseWithAI}
          className="mt-3 flex-shrink-0 py-2 rounded-lg text-sm font-semibold bg-blue-500 text-white transition-opacity hover:opacity-90"
        >
          Parse with AI
        </button>
      )}

      {voiceManualMode && voiceCanRecord && (
        <button
          onClick={() => { setVoiceManualMode(false); setVoiceTranscript(''); }}
          className={`mt-2 flex-shrink-0 flex items-center justify-center gap-1 text-xs ${textSecondary} hover:opacity-70`}
        >
          <RotateCcw size={12} /> use mic instead
        </button>
      )}
    </div>
  );
}
