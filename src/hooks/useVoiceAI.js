import { useState, useRef, useEffect } from 'react';
import { loadAIConfig, saveAIConfig } from '../ai.js';
import { localDateStr } from '../utils/taskUtils.js';
import { useNotifyTrayOnChange } from '../utils/trayNotify.js';

const useVoiceAI = () => {
  // AI configuration state
  const [aiConfig, setAiConfig] = useState(() => loadAIConfig());
  const [aiConnectionStatus, setAiConnectionStatus] = useState(null); // null | 'testing' | 'success' | 'error'
  const [aiConnectionMessage, setAiConnectionMessage] = useState('');
  const [aiOllamaHelp, setAiOllamaHelp] = useState(null);

  // Voice input state
  const [showVoiceInput, setShowVoiceInput] = useState(false);
  const [voiceIsRecording, setVoiceIsRecording] = useState(false);
  const [voiceIsTranscribing, setVoiceIsTranscribing] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceParsedTasks, setVoiceParsedTasks] = useState(null);
  const [voiceTaskTimePickerIdx, setVoiceTaskTimePickerIdx] = useState(null);
  const [voiceParsedEdits, setVoiceParsedEdits] = useState(null); // resolved edit commands from AI
  const [voiceIsParsing, setVoiceIsParsing] = useState(false);
  const [voiceParseError, setVoiceParseError] = useState('');
  const [voiceEditingParsed, setVoiceEditingParsed] = useState(null);
  const [voiceManualMode, setVoiceManualMode] = useState(false);
  const [voiceMicError, setVoiceMicError] = useState(null);
  const voiceRecorderRef = useRef(null); // { recorder: MediaRecorder, stream: MediaStream }
  const voiceAudioChunksRef = useRef([]);
  const voiceAutoStartRef = useRef(false); // set by voice-input shortcut to auto-start recording
  const voiceTextareaRef = useRef(null);
  const voiceAllTagsRef = useRef([]);
  const voiceBuildTaskContextRef = useRef(() => 'No tasks currently.');
  const voiceResolveTaskMatchRef = useRef(() => null);
  const voiceCanRecord = typeof MediaRecorder !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.mediaDevices;

  // Weekly Review modal state
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker] = useState(false);
  const [showWeeklyReviewReminder, setShowWeeklyReviewReminder] = useState(false);
  const lastWeeklyReviewFiredRef = useRef(
    localStorage.getItem('day-planner-weekly-review-fired') || ''
  );
  const weeklyReviewDismissedRef = useRef(
    localStorage.getItem('day-planner-weekly-review-dismissed') || ''
  );

  // Morning dayGLANCE (AI morning summary)
  const [morningGlanceText, setMorningGlanceText] = useState(() => {
    try {
      const cached = localStorage.getItem('day-planner-morning-glance');
      if (cached) {
        const { date, text } = JSON.parse(cached);
        if (date === localDateStr()) return text;
      }
    } catch {}
    return null;
  });
  const [morningGlanceLoading, setMorningGlanceLoading] = useState(false);
  const [morningGlanceDismissed, setMorningGlanceDismissed] = useState(() => {
    try {
      // Key was renamed from 'day-planner-morning-glance-dismissed' to drop
      // stale values that were stored using UTC instead of local time.
      localStorage.removeItem('day-planner-morning-glance-dismissed');
      const d = localStorage.getItem('day-planner-mg-dismissed');
      return d === localDateStr();
    } catch { return false; }
  });
  const [morningGlanceError, setMorningGlanceError] = useState('');

  // Evening reflection state
  const [eveningGlanceText, setEveningGlanceText] = useState(() => {
    try {
      const cached = localStorage.getItem('day-planner-evening-glance');
      if (cached) {
        const { date, text } = JSON.parse(cached);
        if (date === localDateStr()) return text;
      }
    } catch {}
    return null;
  });
  const [eveningGlanceLoading, setEveningGlanceLoading] = useState(false);
  const [eveningGlanceDismissed, setEveningGlanceDismissed] = useState(() => {
    try { return localStorage.getItem('day-planner-eg-dismissed') === localDateStr(); }
    catch { return false; }
  });
  const [eveningGlanceError, setEveningGlanceError] = useState('');

  // Weekly AI summary (enhanced weekly review)
  const [weeklyAISummary, setWeeklyAISummary] = useState(null);
  const [weeklyAILoading, setWeeklyAILoading] = useState(false);
  const [weeklyAIError, setWeeklyAIError] = useState('');

  // Persist AI config to localStorage
  useEffect(() => {
    saveAIConfig(aiConfig);
  }, [aiConfig]);

  // The tray popup gates its voice button on aiConfig.enabled /
  // features.voiceTaskInput (TrayHeader) and its morning-glance card on
  // features.smartScheduling (GlanceSidebar), reading both from
  // day-planner-ai-config on mount — so toggling AI in Settings has to
  // invalidate the popup's snapshot.
  useNotifyTrayOnChange(aiConfig);

  return {
    aiConfig, setAiConfig,
    aiConnectionStatus, setAiConnectionStatus,
    aiConnectionMessage, setAiConnectionMessage,
    aiOllamaHelp, setAiOllamaHelp,
    showVoiceInput, setShowVoiceInput,
    voiceIsRecording, setVoiceIsRecording,
    voiceIsTranscribing, setVoiceIsTranscribing,
    voiceTranscript, setVoiceTranscript,
    voiceParsedTasks, setVoiceParsedTasks,
    voiceTaskTimePickerIdx, setVoiceTaskTimePickerIdx,
    voiceParsedEdits, setVoiceParsedEdits,
    voiceIsParsing, setVoiceIsParsing,
    voiceParseError, setVoiceParseError,
    voiceEditingParsed, setVoiceEditingParsed,
    voiceManualMode, setVoiceManualMode,
    voiceMicError, setVoiceMicError,
    voiceRecorderRef,
    voiceAudioChunksRef,
    voiceAutoStartRef,
    voiceTextareaRef,
    voiceAllTagsRef,
    voiceBuildTaskContextRef,
    voiceResolveTaskMatchRef,
    voiceCanRecord,
    showWeeklyReview, setShowWeeklyReview,
    showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker,
    showWeeklyReviewReminder, setShowWeeklyReviewReminder,
    lastWeeklyReviewFiredRef,
    weeklyReviewDismissedRef,
    morningGlanceText, setMorningGlanceText,
    morningGlanceLoading, setMorningGlanceLoading,
    morningGlanceDismissed, setMorningGlanceDismissed,
    morningGlanceError, setMorningGlanceError,
    eveningGlanceText, setEveningGlanceText,
    eveningGlanceLoading, setEveningGlanceLoading,
    eveningGlanceDismissed, setEveningGlanceDismissed,
    eveningGlanceError, setEveningGlanceError,
    weeklyAISummary, setWeeklyAISummary,
    weeklyAILoading, setWeeklyAILoading,
    weeklyAIError, setWeeklyAIError,
  };
};

export default useVoiceAI;
