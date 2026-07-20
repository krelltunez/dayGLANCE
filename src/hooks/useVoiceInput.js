import { useEffect, useCallback } from 'react';
import { aiTranscribe, aiJSON, supportsTranscription } from '../ai.js';
import { voiceParseSystemPrompt, voiceParseUserPrompt } from '../ai-prompts.js';
import { nativeStartRecording, nativeStopRecording, triggerHaptic } from '../native.js';
import { dateToString } from '../utils/taskUtils.js';

/**
 * Voice input pipeline — extracted from App.jsx (see "App.jsx — Ongoing
 * Decomposition" in CLAUDE.md), logic moved verbatim.
 *
 * Owns the record → transcribe → AI-parse → apply flow: the modal
 * open/close reset effect, MediaRecorder + native-Android recording,
 * the auto-start-on-shortcut effect, AI parsing of the transcript into
 * new tasks and edit commands, applying all changes (task creation and
 * the edit-command switch), and the voice-modal keyboard shortcuts.
 *
 * Voice state and refs stay owned by useVoiceAI and are passed in. The
 * voice*Ref indirections (voiceAllTagsRef/voiceBuildTaskContextRef/
 * voiceResolveTaskMatchRef) are kept: voiceStopRecording parses inline
 * and reads them at call time.
 */
export default function useVoiceInput({
  aiConfig, allTags, colors,
  tasks, setTasks,
  unscheduledTasks, setUnscheduledTasks,
  isVisibleForUser,
  pushUndo, moveToRecycleBin,
  showVoiceInput, setShowVoiceInput,
  voiceCanRecord,
  voiceTranscript, setVoiceTranscript,
  voiceIsRecording, setVoiceIsRecording,
  voiceIsTranscribing, setVoiceIsTranscribing,
  voiceParsedTasks, setVoiceParsedTasks,
  voiceParsedEdits, setVoiceParsedEdits,
  setVoiceIsParsing, setVoiceParseError,
  voiceEditingParsed, setVoiceEditingParsed,
  voiceManualMode, setVoiceManualMode,
  setVoiceMicError,
  voiceRecorderRef, voiceAudioChunksRef, voiceAutoStartRef,
  voiceAllTagsRef, voiceBuildTaskContextRef, voiceResolveTaskMatchRef,
}) {
  // Always-fresh tag list for the inline parse in voiceStopRecording.
  voiceAllTagsRef.current = allTags;

  // Voice input — reset state when modal opens, cleanup on close
  useEffect(() => {
    if (showVoiceInput) {
      setVoiceIsRecording(false);
      setVoiceIsTranscribing(false);
      setVoiceTranscript('');
      setVoiceParsedTasks(null);
      setVoiceParsedEdits(null);
      setVoiceIsParsing(false);
      setVoiceParseError('');
      setVoiceEditingParsed(null);
      setVoiceManualMode(false);
      setVoiceMicError(null);
    } else {
      // Cleanup MediaRecorder on modal close
      const ref = voiceRecorderRef.current;
      if (ref) {
        if (ref.recorder.state !== 'inactive') ref.recorder.stop();
        ref.stream.getTracks().forEach(t => t.stop());
        voiceRecorderRef.current = null;
      }
      voiceAudioChunksRef.current = [];
    }
    // Keyed on showVoiceInput (open/close). The omitted names are all stable
    // state setters and *Ref values used to reset the recorder.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVoiceInput]);

  const voiceStartRecording = useCallback(async () => {
    if (!voiceCanRecord) return;
    setVoiceMicError(null);
    setVoiceParseError('');
    setVoiceTranscript('');
    setVoiceParsedTasks(null);
    setVoiceParsedEdits(null);

    // On Android, use the native MediaRecorder bridge instead of WebView getUserMedia,
    // which is unreliable and produces NotReadableError on many devices/WebView versions.
    const nativeResult = nativeStartRecording();
    if (nativeResult !== null) {
      if (nativeResult === 'ok') {
        voiceRecorderRef.current = { native: true };
        setVoiceIsRecording(true);
      } else {
        setVoiceParseError(`Microphone error: ${nativeResult.error ?? nativeResult}`);
        setVoiceMicError('error');
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      voiceAudioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceAudioChunksRef.current.push(e.data);
      };

      voiceRecorderRef.current = { recorder, stream };
      recorder.start();
      setVoiceIsRecording(true);
    } catch (err) {
      console.error('Microphone error:', err);
      const msg = err.name === 'NotAllowedError'
        ? typeof navigator.brave !== 'undefined'
          ? 'Microphone access denied. Brave Shields may be blocking access — try disabling Shields for this site, or allow microphone permissions in your browser settings.'
          : 'Microphone access denied. Please allow microphone permissions in your browser settings.'
        : err.name === 'NotFoundError'
        ? 'No microphone found. Please connect a microphone and try again.'
        : `Microphone error: ${err.message}`;
      setVoiceParseError(msg);
      setVoiceMicError('error');
    }
    // Omitted names are all stable state setters and *Ref values; keyed on
    // voiceCanRecord.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceCanRecord]);

  // When the voice modal is opened via the Android launcher shortcut, auto-start recording.
  useEffect(() => {
    if (showVoiceInput && voiceAutoStartRef.current) {
      voiceAutoStartRef.current = false;
      voiceStartRecording();
    }
  }, [showVoiceInput, voiceStartRecording, voiceAutoStartRef]);

  const voiceStopRecording = useCallback(async () => {
    const ref = voiceRecorderRef.current;
    if (!ref) return;

    let blob;

    if (ref.native) {
      // Native Android recording path
      voiceRecorderRef.current = null;
      setVoiceIsRecording(false);
      const result = nativeStopRecording();
      if (!result || result.error) {
        setVoiceParseError(`Microphone error: ${result?.error ?? 'unknown'}`);
        setVoiceMicError('error');
        return;
      }
      blob = result;
    } else {
      const { recorder, stream } = ref;

      // Collect recorded audio
      blob = await new Promise((resolve) => {
        recorder.onstop = () => {
          const audioBlob = new Blob(voiceAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          voiceAudioChunksRef.current = [];
          resolve(audioBlob);
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve(new Blob([], { type: 'audio/webm' }));
      });

      stream.getTracks().forEach(t => t.stop());
      voiceRecorderRef.current = null;
      setVoiceIsRecording(false);
    }

    // Transcribe + parse in one shot
    if (blob.size > 0) {
      setVoiceIsTranscribing(true);
      try {
        const text = (await aiTranscribe(blob, aiConfig)).trim();
        setVoiceTranscript(text);
        // Immediately parse into tasks
        if (text && aiConfig.enabled && (aiConfig.apiKey || aiConfig.provider === 'ollama')) {
          setVoiceIsParsing(true);
          try {
            const context = { todayDate: dateToString(new Date()), existingTags: voiceAllTagsRef.current, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, existingTasks: voiceBuildTaskContextRef.current() };
            const result = await aiJSON(voiceParseSystemPrompt(context), voiceParseUserPrompt(text), aiConfig);
            const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
            let newTasks = [];
            let edits = [];
            if (Array.isArray(result)) {
              newTasks = result;
            } else if (result && typeof result === 'object') {
              newTasks = Array.isArray(result.newTasks) ? result.newTasks : [];
              edits = Array.isArray(result.edits) ? result.edits : [];
            }
            setVoiceParsedTasks(newTasks.map(t => ({ ...t, title: cap(t.title) })));
            const resolved = edits.map(edit => {
              const match = voiceResolveTaskMatchRef.current(edit.taskMatch);
              return { ...edit, resolvedTask: match?.task || null, source: match?.source || null };
            });
            setVoiceParsedEdits(resolved);
          } catch (parseErr) {
            setVoiceParseError(parseErr.message);
            setVoiceParsedTasks([{ title: text.charAt(0).toUpperCase() + text.slice(1), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
            setVoiceParsedEdits([]);
          }
          setVoiceIsParsing(false);
        } else {
          setVoiceParsedTasks([{ title: text.charAt(0).toUpperCase() + text.slice(1), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
        }
      } catch (err) {
        console.error('Transcription error:', err);
        setVoiceParseError(`Transcription failed: ${err.message}`);
        setVoiceManualMode(true); // fall back to text input
      }
      setVoiceIsTranscribing(false);
    }
    // Omitted names are all stable state setters and *Ref values; keyed on aiConfig.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConfig]);

  // Voice input — parse and add callbacks (must be after allTags is defined)
  // Build a text summary of existing tasks for AI context
  const buildTaskContextForAI = useCallback(() => {
    const today = new Date();
    const todayStr = dateToString(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = dateToString(yesterday);
    const lines = [];
    // Scheduled tasks (yesterday + today + future — user may reschedule past tasks)
    const relevant = tasks.filter(t => !t.imported && !t.isExample && t.date >= yesterdayStr).slice(0, 40);
    relevant.forEach(t => {
      let d = `"${t.title}" — ${t.date}`;
      if (t.startTime) d += ` at ${t.startTime}`;
      d += `, ${t.duration || 30}min`;
      if (t.completed) d += ' [COMPLETED]';
      lines.push(d);
    });
    // Inbox tasks (uncompleted)
    unscheduledTasks.filter(t => !t.completed && !t.isExample).slice(0, 20).forEach(t => {
      let d = `"${t.title}" — inbox, ${t.duration || 30}min`;
      if (t.priority > 0) d += `, priority: ${['none', 'low', 'medium', 'high'][t.priority]}`;
      if (t.deadline) d += `, deadline: ${t.deadline}`;
      lines.push(d);
    });
    return lines.length > 0 ? lines.join('\n') : 'No tasks currently.';
  }, [tasks, unscheduledTasks]);
  voiceBuildTaskContextRef.current = buildTaskContextForAI;

  // Resolve an AI-provided taskMatch string to an actual task
  const resolveTaskMatch = useCallback((taskMatch) => {
    const lower = (taskMatch || '').toLowerCase();
    if (!lower) return null;
    // Search scheduled tasks (best match = shortest title containing the match)
    const scheduledMatches = tasks.filter(t => !t.imported && !t.isExample && isVisibleForUser(t) && t.title.toLowerCase().includes(lower));
    if (scheduledMatches.length > 0) {
      const best = scheduledMatches.sort((a, b) => a.title.length - b.title.length)[0];
      return { task: best, source: 'scheduled' };
    }
    // Search inbox tasks
    const inboxMatches = unscheduledTasks.filter(t => !t.isExample && isVisibleForUser(t) && t.title.toLowerCase().includes(lower));
    if (inboxMatches.length > 0) {
      const best = inboxMatches.sort((a, b) => a.title.length - b.title.length)[0];
      return { task: best, source: 'inbox' };
    }
    return null;
  }, [tasks, unscheduledTasks, isVisibleForUser]);
  voiceResolveTaskMatchRef.current = resolveTaskMatch;

  const voiceParseWithAI = useCallback(async () => {
    const text = voiceTranscript.trim();
    if (!text) return;
    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    if (!aiConfig.enabled || (!aiConfig.apiKey && aiConfig.provider !== 'ollama')) {
      setVoiceParsedTasks([{ title: cap(text), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
      setVoiceParsedEdits([]);
      return;
    }
    setVoiceIsParsing(true);
    setVoiceParseError('');
    try {
      const context = {
        todayDate: dateToString(new Date()),
        existingTags: allTags,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        existingTasks: buildTaskContextForAI(),
      };
      const result = await aiJSON(voiceParseSystemPrompt(context), voiceParseUserPrompt(text), aiConfig);

      // Handle both old format (array) and new format ({ newTasks, edits })
      let newTasks = [];
      let edits = [];
      if (Array.isArray(result)) {
        newTasks = result;
      } else if (result && typeof result === 'object') {
        newTasks = Array.isArray(result.newTasks) ? result.newTasks : [];
        edits = Array.isArray(result.edits) ? result.edits : [];
      }

      setVoiceParsedTasks(newTasks.map(t => ({ ...t, title: cap(t.title) })));

      // Resolve each edit command to an actual task
      const resolved = edits.map(edit => {
        const match = resolveTaskMatch(edit.taskMatch);
        return { ...edit, resolvedTask: match?.task || null, source: match?.source || null };
      });
      setVoiceParsedEdits(resolved);
    } catch (err) {
      setVoiceParseError(err.message);
      setVoiceParsedTasks([{ title: cap(text), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
      setVoiceParsedEdits([]);
    }
    setVoiceIsParsing(false);
  }, [voiceTranscript, aiConfig, allTags, buildTaskContextForAI, resolveTaskMatch, setVoiceIsParsing, setVoiceParseError, setVoiceParsedEdits, setVoiceParsedTasks]);

  // Apply all parsed changes (new tasks + edit commands)
  const voiceApplyAllChanges = useCallback(() => {
    const hasNewTasks = voiceParsedTasks && voiceParsedTasks.length > 0;
    const hasEdits = voiceParsedEdits && voiceParsedEdits.length > 0;
    if (!hasNewTasks && !hasEdits) return;
    pushUndo();

    // Add new tasks
    if (hasNewTasks) {
      for (const parsed of voiceParsedTasks) {
        const taskId = crypto.randomUUID();
        const tagStr = (parsed.tags || []).map(t => ` #${t}`).join('');
        const rawTitle = parsed.title + tagStr;
        const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
        if (parsed.date && parsed.time) {
          setTasks(prev => [...prev, { id: taskId, title, startTime: parsed.time, duration: parsed.duration || 30, date: parsed.date, color: colors[0].class, completed: false, isAllDay: false, notes: parsed.notes || '', subtasks: [] }]);
        } else {
          const inboxTask = { id: taskId, title, duration: parsed.duration || 30, color: colors[0].class, completed: false, isAllDay: false, notes: parsed.notes || '', subtasks: [], priority: parsed.priority || 0 };
          if (parsed.deadline) inboxTask.deadline = parsed.deadline;
          if (parsed.date && !parsed.time) {
            setTasks(prev => [...prev, { ...inboxTask, startTime: '09:00', date: parsed.date }]);
          } else {
            setUnscheduledTasks(prev => [...prev, inboxTask]);
          }
        }
      }
    }

    // Apply edit commands
    if (hasEdits) {
      for (const edit of voiceParsedEdits) {
        if (!edit.resolvedTask) continue; // skip unresolved
        const id = edit.resolvedTask.id;
        const isInbox = edit.source === 'inbox';

        switch (edit.action) {
          case 'move': {
            if (isInbox && edit.date) {
              // Move from inbox to scheduled
              setUnscheduledTasks(prev => prev.filter(t => t.id !== id));
              const movedTask = { ...edit.resolvedTask, date: edit.date, startTime: edit.time || '09:00' };
              delete movedTask.priority; delete movedTask.deadline;
              setTasks(prev => [...prev, movedTask]);
            } else if (!isInbox) {
              setTasks(prev => prev.map(t => t.id === id ? {
                ...t,
                ...(edit.date != null ? { date: edit.date } : {}),
                ...(edit.time != null ? { startTime: edit.time } : {}),
              } : t));
            }
            break;
          }
          case 'changeDuration': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, duration: edit.duration } : t));
            break;
          }
          case 'rename': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, title: edit.newTitle, transitionId: crypto.randomUUID() } : t));
            break;
          }
          case 'delete': {
            moveToRecycleBin(id, isInbox);
            break;
          }
          case 'complete': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, completed: true, lastModified: new Date().toISOString(), transitionId: crypto.randomUUID() } : t));
            triggerHaptic('success');
            break;
          }
          case 'uncomplete': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, completed: false, lastModified: new Date().toISOString(), transitionId: crypto.randomUUID() } : t));
            break;
          }
          case 'changePriority': {
            if (isInbox) {
              setUnscheduledTasks(prev => prev.map(t => t.id === id ? { ...t, priority: edit.priority, transitionId: crypto.randomUUID() } : t));
            }
            break;
          }
          case 'addTag': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => {
              if (t.id !== id) return t;
              const existing = (t.title.match(/#(\p{L}[\p{L}\p{N}_]*)/gu) || []).map(s => s.slice(1).toLowerCase());
              if (existing.includes(edit.tag.toLowerCase())) return t;
              return { ...t, title: t.title + ` #${edit.tag}`, transitionId: crypto.randomUUID() };
            }));
            break;
          }
          case 'removeTag': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => {
              if (t.id !== id) return t;
              return { ...t, title: t.title.replace(new RegExp(`\\s*#${edit.tag}\\b`, 'gi'), ''), transitionId: crypto.randomUUID() };
            }));
            break;
          }
        }
      }
    }

    setShowVoiceInput(false);
    // Keyed on the parsed voice results; colors and the moveToRecycleBin/pushUndo
    // helpers + setShowVoiceInput are read when changes are applied.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceParsedTasks, voiceParsedEdits]);

  // Voice input keyboard shortcuts (SPACE to hold-record, T for typing, ENTER to parse/accept)
  const voiceHasTranscription = aiConfig.enabled && supportsTranscription(aiConfig);
  useEffect(() => {
    if (!showVoiceInput) return;

    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      const isTextInput = tag === 'TEXTAREA' || tag === 'INPUT' || e.target.isContentEditable;

      // ENTER in textarea → parse with AI
      if (e.key === 'Enter' && tag === 'TEXTAREA' && !e.isComposing) {
        e.preventDefault();
        voiceParseWithAI();
        return;
      }

      if (isTextInput) return;

      // SPACE hold-to-record (desktop only, not on parsed/transcribing screen)
      if (e.key === ' ' && !isTouchDevice && !voiceParsedTasks && !voiceManualMode && !voiceIsTranscribing && voiceCanRecord && voiceHasTranscription) {
        e.preventDefault();
        if (!voiceIsRecording && !e.repeat) {
          voiceStartRecording();
        }
        return;
      }

      // T to switch to typing mode (only on voice recording screen)
      if ((e.key === 't' || e.key === 'T') && !voiceParsedTasks && !voiceManualMode && !voiceIsRecording && !voiceIsTranscribing) {
        e.preventDefault();
        setVoiceManualMode(true);
        return;
      }

      // ENTER to accept parsed tasks/edits
      if (e.key === 'Enter' && (voiceParsedTasks || voiceParsedEdits) && voiceEditingParsed === null) {
        e.preventDefault();
        voiceApplyAllChanges();
        return;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === ' ' && !isTouchDevice && voiceIsRecording) {
        e.preventDefault();
        voiceStopRecording();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [showVoiceInput, voiceIsRecording, voiceIsTranscribing, voiceParsedTasks, voiceParsedEdits, voiceManualMode, voiceCanRecord, voiceHasTranscription, voiceEditingParsed, voiceStartRecording, voiceStopRecording, voiceParseWithAI, voiceApplyAllChanges, setVoiceManualMode]);

  return {
    voiceStartRecording, voiceStopRecording,
    voiceParseWithAI, voiceApplyAllChanges,
    voiceHasTranscription,
    buildTaskContextForAI, resolveTaskMatch,
  };
}
