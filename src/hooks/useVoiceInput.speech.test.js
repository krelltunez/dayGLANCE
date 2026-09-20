import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_SPEECH_BLOCKED_KEY } from '../utils/webSpeech.js';

// Follow the existing hook capture harness (useTodoistSync.test.js): state
// survives explicit re-renders, effects are not mounted.
let states = [];
let stateCursor = 0;
let refs = [];
let refCursor = 0;
vi.mock('react', () => ({
  useCallback: fn => fn,
  useEffect: () => {},
  useRef: value => {
    const index = refCursor++;
    if (!refs[index]) refs[index] = { current: value };
    return refs[index];
  },
  useState: initial => {
    const index = stateCursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], next => {
      states[index] = typeof next === 'function' ? next(states[index]) : next;
    }];
  },
}));
vi.mock('i18next', () => ({ default: { t: (key, opts) => opts?.defaultValue ?? key } }));
// No AI provider and no native STT: the Web Speech API is the only path left,
// which is the configuration the bug report came from.
vi.mock('../native.js', () => ({
  nativeStartRecording: () => null,
  nativeStopRecording: () => null,
  triggerHaptic: () => {},
  nativeSupportsSpeech: () => false,
  nativeStartSpeech: () => 'ok',
  nativeStopSpeech: () => {},
  nativeCancelSpeech: () => {},
}));

const { default: useVoiceInput } = await import('./useVoiceInput.js');

// The recognition object the browser hands back: it constructs and start()s
// happily even where the vendor's service cannot be reached — the failure only
// ever arrives later, through onerror.
let recognition;
class FakeSpeechRecognition {
  constructor() { recognition = this; this.started = false; }
  start() { this.started = true; }
  stop() {}
  abort() {}
}

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
  };
};

// Every state setter the hook is handed, recorded so a test can assert what the
// user would actually see.
const SETTERS = [
  'setTasks', 'setUnscheduledTasks', 'setRecurringTasks', 'setShowVoiceInput',
  'setVoiceTranscript', 'setVoiceIsRecording', 'setVoiceIsTranscribing',
  'setVoiceParsedTasks', 'setVoiceParsedEdits', 'setVoiceIsParsing',
  'setVoiceParseError', 'setVoiceEditingParsed', 'setVoiceManualMode',
  'setVoiceMicError',
];

let seen;
// Named use* to satisfy rules-of-hooks, matching useTodoistSync.test.js:
// one call is one render of the hook.
const useTestVoice = () => {
  stateCursor = 0;
  refCursor = 0;
  seen = {};
  const deps = {
    aiConfig: { enabled: false, provider: 'openai', apiKey: '' },
    allTags: [], colors: [{ class: 'bg-blue-500' }],
    tasks: [], unscheduledTasks: [],
    isVisibleForUser: () => true,
    pushUndo: () => {}, moveToRecycleBin: () => {},
    showVoiceInput: true,
    voiceCanRecord: false,
    voiceTranscript: '', voiceIsRecording: false, voiceIsTranscribing: false,
    voiceParsedTasks: null, voiceParsedEdits: null,
    voiceEditingParsed: null, voiceManualMode: false,
    voiceRecorderRef: refs[0] || (refs[0] = { current: null }),
    voiceAudioChunksRef: refs[1] || (refs[1] = { current: [] }),
    voiceAutoStartRef: refs[2] || (refs[2] = { current: false }),
    voiceAllTagsRef: refs[3] || (refs[3] = { current: [] }),
    voiceBuildTaskContextRef: refs[4] || (refs[4] = { current: () => '' }),
    voiceResolveTaskMatchRef: refs[5] || (refs[5] = { current: () => null }),
  };
  for (const name of SETTERS) deps[name] = v => { seen[name] = v; };
  // The hook's own useState/useRef slots start after the ones seeded above.
  refCursor = 6;
  return useVoiceInput(deps);
};

const failWith = (error) => recognition.onerror({ error });

beforeEach(() => {
  states = [];
  refs = [];
  recognition = undefined;
  globalThis.localStorage = memoryStorage();
  globalThis.window = {
    SpeechRecognition: FakeSpeechRecognition,
    navigator: { onLine: true, language: 'en-US' },
  };
  // Node exposes navigator as a getter-only global, so redefine rather than assign.
  Object.defineProperty(globalThis, 'navigator', {
    value: globalThis.window.navigator, configurable: true, writable: true,
  });
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.localStorage;
  delete globalThis.navigator;
});

describe('an unreachable speech recognition service', () => {
  it('offers the microphone before anything has failed', () => {
    expect(useTestVoice().voiceHasTranscription).toBe(true);
  });

  // The bug: the browser reports 'network', and the user is left facing a
  // microphone that will fail identically every time they press it.
  it('drops the user into typing with the reason, instead of a dead microphone', () => {
    const hook = useTestVoice();
    hook.voiceStartRecording();
    expect(recognition.started).toBe(true);

    failWith('network');

    expect(seen.setVoiceManualMode).toBe(true);
    expect(seen.setVoiceMicError).toBe('error');
    expect(seen.setVoiceParseError).toMatch(/speech recognition service/i);
    expect(seen.setVoiceIsRecording).toBe(false);
  });

  it('stops offering the microphone on this device once it has failed', () => {
    const first = useTestVoice();
    first.voiceStartRecording();
    failWith('network');

    // Re-render: the verdict has to survive, or the next open shows the same
    // dead microphone again.
    const next = useTestVoice();
    expect(next.voiceSpeechBlocked).toBe(true);
    expect(next.voiceHasTranscription).toBe(false);
  });

  it('persists the verdict, so a reload does not forget it', () => {
    useTestVoice().voiceStartRecording();
    failWith('network');
    expect(localStorage.getItem(WEB_SPEECH_BLOCKED_KEY)).toBe('1');

    // A fresh mount reads it back — this is what a page reload looks like.
    states = [];
    expect(useTestVoice().voiceHasTranscription).toBe(false);
  });

  // A device with no connection explains the error by itself. Recording a
  // block here would take the microphone away from a browser that works.
  it('does not blame the service when the device is simply offline', () => {
    globalThis.window.navigator.onLine = false;
    const hook = useTestVoice();
    hook.voiceStartRecording();
    failWith('network');

    expect(seen.setVoiceManualMode).toBe(true); // still not a dead end
    expect(localStorage.getItem(WEB_SPEECH_BLOCKED_KEY)).toBe(null);
    expect(useTestVoice().voiceHasTranscription).toBe(true);
  });

  it('lets the user overrule the verdict and try voice again', () => {
    useTestVoice().voiceStartRecording();
    failWith('network');
    expect(useTestVoice().voiceHasTranscription).toBe(false);

    useTestVoice().voiceRetrySpeech();

    expect(seen.setVoiceManualMode).toBe(false); // back to the microphone UI
    expect(localStorage.getItem(WEB_SPEECH_BLOCKED_KEY)).toBe(null);
    expect(useTestVoice().voiceHasTranscription).toBe(true);
  });

  it('leaves other recognition failures as retryable', () => {
    const hook = useTestVoice();
    hook.voiceStartRecording();
    failWith('not-allowed');

    expect(seen.setVoiceParseError).toMatch(/microphone access denied/i);
    expect(localStorage.getItem(WEB_SPEECH_BLOCKED_KEY)).toBe(null);
    expect(useTestVoice().voiceHasTranscription).toBe(true);
  });

  it('ignores the routine aborted/no-speech endings entirely', () => {
    const hook = useTestVoice();
    hook.voiceStartRecording();
    for (const error of ['aborted', 'no-speech']) {
      seen = {};
      failWith(error);
      expect(seen.setVoiceParseError).toBeUndefined();
      expect(seen.setVoiceMicError).toBeUndefined();
    }
    expect(useTestVoice().voiceHasTranscription).toBe(true);
  });
});
