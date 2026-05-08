import { useState, useEffect, useCallback, useRef } from 'react';

const BILLING = typeof window !== 'undefined' ? window.DayGlanceBilling : null;

function readStatus() {
  if (!BILLING) return { active: false, productId: null };
  try { return JSON.parse(BILLING.getStatus()); }
  catch { return { active: false, productId: null }; }
}

function readPrices() {
  if (!BILLING) return { annual: null, lifetime: null };
  try {
    const p = JSON.parse(BILLING.getProductPrices());
    return {
      annual:   p.annual   || null,
      lifetime: p.lifetime || null,
    };
  } catch { return { annual: null, lifetime: null }; }
}

/**
 * Exposes Google Play subscription state to the React app.
 *
 * Only meaningful inside the Android WebView — `isAndroidApp` is false on
 * web and Electron, where `isPro` is always true (no wall shown).
 *
 * `isLoading` is true for up to 5 s on first open while the billing client
 * connects to Play and refreshes the local cache, preventing a false-wall
 * flash on cold start for users who are already subscribed.
 *
 * `prices` contains the localized Play prices, e.g. { monthly: "£2.99", annual: "£19.99" }.
 * These are null until the billing client has connected at least once.
 */
export function useSubscription() {
  const cached = readStatus();
  const [status, setStatus] = useState(cached);
  const [prices, setPrices] = useState(readPrices);
  // No initial loading state — the Android splash screen holds until queryPurchases()
  // completes, so the SharedPreferences cache is correct before the WebView is visible.
  const [isLoading, setIsLoading] = useState(false);
  const pollRef = useRef(null);

  // On mount: trigger a background refresh to catch any changes since last open.
  useEffect(() => {
    if (!BILLING) return;
    BILLING.refresh?.();
  }, []);

  const refresh = useCallback(() => {
    if (!BILLING) return;
    BILLING.refresh?.();
    setTimeout(() => {
      setStatus(readStatus());
      setPrices(readPrices());
    }, 2000);
  }, []);

  // Re-read when the user returns from the Play purchase sheet.
  useEffect(() => {
    if (!BILLING) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  /**
   * Opens the Google Play purchase sheet.
   * productId: 'dayglance_pro_annual' | 'dayglance_pro_lifetime'
   */
  const subscribe = useCallback((productId = 'dayglance_pro_annual') => {
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
      setPrices(readPrices());
      setIsLoading(false);
    }, 4000);
  }, []);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return {
    isPro: status.active,
    productId: status.productId,
    prices,
    isAndroidApp: !!BILLING,
    isLoading,
    subscribe,
    restore,
    refresh,
  };
}
