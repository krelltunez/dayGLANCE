// Thin wrapper around the Screen Wake Lock API, for the Day Dial's ambient
// mode. Pattern carried over from lifeGLANCE's watch mode: browsers release
// a wake lock automatically when the page is hidden, so we track intent
// (`want`) and re-acquire on the next visibility regain. No-ops gracefully
// where the API is unsupported (e.g. older Safari).

let sentinel = null;
let want = false;

export async function acquireWakeLock() {
  want = true;
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch { /* can reject (low battery, not visible) — ambient works without it */ }
}

export function releaseWakeLock() {
  want = false;
  const s = sentinel;
  sentinel = null;
  if (s) s.release().catch(() => {});
}

// Re-acquire when the tab becomes visible again, if we still want the lock.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (want && document.visibilityState === 'visible' && !sentinel) acquireWakeLock();
  });
}
