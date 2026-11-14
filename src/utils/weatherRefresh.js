// When the weather hook (hooks/useWeather.js) fetches: at start, hourly, sooner
// after a failure, and when the user comes back to the app.
//
// It used to be a bare hourly setInterval. A desktop app left running meets
// two things that never happen to a page someone just opened: the machine
// sleeps, and its timer comes due the moment it wakes, before the network
// does; and the window sits in the tray for hours, then is looked at. The
// first made one failed attempt stand for an hour. The second showed whatever
// the last attempt left.

export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const RETRY_BASE_MS = 15 * 1000;
// Coming back to the app refreshes a forecast older than this.
export const RETURN_STALE_MS = 15 * 60 * 1000;
// While failing, coming back retries at most this often.
export const RETURN_RETRY_MIN_MS = 10 * 1000;

/** 15s, 30s, 1m, 2m, ... capped at the normal hourly cadence. */
export const retryDelay = (failures) =>
  Math.min(REFRESH_INTERVAL_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));

/**
 * Run `fetchWeather` now and keep it current. `fetchWeather` resolves to
 * 'failed' when a request did not get through; anything else counts as done.
 * Returns the function that stops it.
 */
export function startWeatherRefresh({
  fetchWeather,
  target = typeof window !== 'undefined' ? window : null,
  doc = typeof document !== 'undefined' ? document : null,
  now = Date.now,
}) {
  let timer = null;
  let stopped = false;
  let running = false;
  let failures = 0;
  let lastAttemptAt = 0;
  let lastDoneAt = 0;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    clearTimeout(timer);
    lastAttemptAt = now();
    let outcome;
    try {
      outcome = await fetchWeather();
    } catch {
      outcome = 'failed';
    }
    running = false;
    if (stopped) return;
    if (outcome === 'failed') {
      failures += 1;
    } else {
      failures = 0;
      lastDoneAt = now();
    }
    timer = setTimeout(run, failures ? retryDelay(failures) : REFRESH_INTERVAL_MS);
  };

  // The window was focused or shown again. A timer that was due while the
  // machine slept may not have fired yet, so the age is checked here too.
  const onReturn = () => {
    if (doc?.visibilityState === 'hidden') return;
    const due = failures
      ? now() - lastAttemptAt >= RETURN_RETRY_MIN_MS
      : now() - lastDoneAt >= RETURN_STALE_MS;
    if (due) run();
  };

  // The network came back: the wait a failure started has nothing left to wait for.
  const onOnline = () => { if (failures) run(); };

  target?.addEventListener?.('focus', onReturn);
  target?.addEventListener?.('online', onOnline);
  doc?.addEventListener?.('visibilitychange', onReturn);

  run();

  return () => {
    stopped = true;
    clearTimeout(timer);
    target?.removeEventListener?.('focus', onReturn);
    target?.removeEventListener?.('online', onOnline);
    doc?.removeEventListener?.('visibilitychange', onReturn);
  };
}
