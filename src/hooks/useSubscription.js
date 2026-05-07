import { useState, useEffect, useCallback, useRef } from 'react';

const BILLING = typeof window !== 'undefined' ? window.DayGlanceBilling : null;

function readStatus() {
  if (!BILLING) return { active: false, productId: null };
  try {
    return JSON.parse(BILLING.getStatus());
  } catch {
    return { active: false, productId: null };
  }
}

/**
 * Exposes Google Play subscription state to the React app.
 *
 * Only meaningful inside the Android WebView — `isAndroidApp` is false on
 * web and Electron, and `isPro` will always be true there (no wall shown).
 *
 * isLoading is true for up to 5 s on first render while the billing client
 * connects to Play and refreshes the local cache. This prevents a false wall
 * flash on cold start for users who are already subscribed.
 *
 * Usage:
 *   const { isPro, isLoading, isAndroidApp, subscribe, refresh } = useSubscription();
 */
export function useSubscription() {
  const cached = readStatus();
  // If the cache already says active, no need to show a loading state.
  const [status, setStatus] = useState(cached);
  const [isLoading, setIsLoading] = useState(!cached.active && !!BILLING);
  const pollRef = useRef(null);

  // On mount: ask the billing client to re-query Play, then settle after 5 s.
  useEffect(() => {
    if (!BILLING) return;
    BILLING.refresh?.();
    const timer = setTimeout(() => {
      setStatus(readStatus());
      setIsLoading(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const refresh = useCallback(() => {
    if (!BILLING) return;
    BILLING.refresh?.();
    setTimeout(() => setStatus(readStatus()), 2000);
  }, []);

  // Re-read when the user comes back from the Play purchase sheet.
  useEffect(() => {
    if (!BILLING) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  /**
   * Opens the Google Play subscription / free-trial sheet.
   * productId: 'dayglance_pro_monthly' | 'dayglance_pro_annual'
   *
   * The visibilitychange handler above picks up the result when the user
   * returns. Polling here is a belt-and-suspenders fallback.
   */
  const subscribe = useCallback((productId = 'dayglance_pro_monthly') => {
    if (!BILLING) return;
    BILLING.purchase?.(productId);

    if (pollRef.current) clearInterval(pollRef.current);
    const deadline = Date.now() + 5 * 60 * 1000;
    pollRef.current = setInterval(() => {
      const s = readStatus();
      if (s.active) {
        setStatus(s);
        setIsLoading(false);
        clearInterval(pollRef.current);
        pollRef.current = null;
      } else if (Date.now() > deadline) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }, 3000);
  }, []);

  const restore = useCallback(() => {
    if (!BILLING) return;
    BILLING.refresh?.();
    setIsLoading(true);
    setTimeout(() => {
      setStatus(readStatus());
      setIsLoading(false);
    }, 4000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return {
    isPro: status.active,
    productId: status.productId,
    isAndroidApp: !!BILLING,
    isLoading,
    subscribe,
    restore,
    refresh,
  };
}
