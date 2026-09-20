/**
 * Web Speech API availability.
 *
 * The browser does not recognise speech on the device: it streams the audio to
 * its vendor's recognition service. When that service cannot be reached the
 * SpeechRecognition object still exists and `start()` still resolves — the
 * failure only surfaces as an `onerror` with `error === 'network'` once audio
 * goes out. So feature-detecting the interface says nothing about whether
 * speech input actually works here.
 *
 * For whole runtimes that reachability is a fixed property rather than a
 * hiccup: Chromium builds that carry no key for Google's speech service
 * (Electron among them), Brave with the endpoint stripped, and Edge outside
 * Windows all fail this way every single time. Re-offering the microphone
 * there is a dead end — the user presses it, waits, and gets the same error.
 *
 * Hence `rememberBlocked`: a 'network' failure is recorded, and the voice
 * modal stops offering a microphone that cannot work on this device. A device
 * that was simply offline is NOT recorded (the service is fine, the network
 * was not), and `clearBlocked` lets the user try again if the verdict was
 * wrong — a permanent block off one bad reading would be the worse bug.
 */

export const WEB_SPEECH_BLOCKED_KEY = 'day-planner-web-speech-blocked';

const win = () => (typeof window === 'undefined' ? null : window);
const store = () => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; }
  catch { return null; } // storage disabled (private mode, blocked cookies)
};

/** Does this browser expose the SpeechRecognition interface at all? */
export function hasWebSpeechAPI(w = win()) {
  return !!(w && (w.SpeechRecognition || w.webkitSpeechRecognition));
}

/** Has recognition already proved unreachable on this device? */
export function isSpeechBlocked(storage = store()) {
  try { return storage?.getItem(WEB_SPEECH_BLOCKED_KEY) === '1'; }
  catch { return false; }
}

export function rememberBlocked(storage = store()) {
  try { storage?.setItem(WEB_SPEECH_BLOCKED_KEY, '1'); } catch { /* nothing to remember with */ }
}

export function clearBlocked(storage = store()) {
  try { storage?.removeItem(WEB_SPEECH_BLOCKED_KEY); } catch { /* nothing to clear */ }
}

/**
 * Should a 'network' recognition error be treated as "this device cannot do
 * speech" rather than "try again later"? Only when the device itself was
 * online: an offline device explains the error without indicting the service.
 * `navigator.onLine` is unreliable in the positive direction (true does not
 * prove connectivity) but a hard false is worth respecting.
 */
export function shouldRememberBlock(w = win()) {
  return w?.navigator?.onLine !== false;
}

/** The one question callers actually have: offer the microphone or not? */
export function webSpeechUsable(w = win(), storage = store()) {
  return hasWebSpeechAPI(w) && !isSpeechBlocked(storage);
}
