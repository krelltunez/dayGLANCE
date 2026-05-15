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
 * Maps a BillingResponseCode integer to a user-facing message.
 * Returns null for codes that should be handled silently (cancel).
 */
function billingErrorMessage(code) {
  switch (code) {
    case 4:  return "This subscription isn't available right now. Please try again later.";
    case 7:  return "You already own this item.";
    case 3:  return "Billing is not available on this device.";
    case 6:  return "Network error. Please check your connection and try again.";
    default: return "Something went wrong with the purchase. Please try again.";
  }
}

/**
 * Exposes Google Play subscription state to the React app.
 *
 * Only meaningful inside the Android WebView — `isAndroidApp` is false on
 * web and Electron, where `isPro` is always true (no wall shown).
 *
 * Purchase outcomes are delivered via `window.__billingEvent` callbacks fired
 * by the Android bridge. `billingEvent` reflects the last terminal result so
 * SubscriptionWall can clear its spinner and show error messages immediately.
 *
 * `prices` contains the localized Play prices, e.g. { annual: "£19.99", lifetime: "£49.99" }.
 * These are null until the billing client has connected at least once.
 */
export function useSubscription() {
  const cached = readStatus();
  const [status, setStatus] = useState(cached);
  const [prices, setPrices] = useState(readPrices);
  const [isLoading, setIsLoading] = useState(false);
  // Last terminal billing event: { status, code, message, productId, ts }
  const [billingEvent, setBillingEvent] = useState(null);
  const timeoutRef = useRef(null);

  // Register window.__billingEvent for the lifetime of the hook.
  // Android fires this for every terminal purchase outcome so the spinner
  // clears immediately rather than waiting for a polling timeout.
  useEffect(() => {
    if (!BILLING) return;
    window.__billingEvent = (ev) => {
      try {
        const parsed = typeof ev === 'string' ? JSON.parse(ev) : ev;
        if (parsed.status === 'success') {
          // Re-read entitlement from cache — handlePurchase has just written it
          setStatus(readStatus());
          setPrices(readPrices());
        }
        setBillingEvent({ ...parsed, ts: Date.now() });
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      } catch {}
    };
    return () => { delete window.__billingEvent; };
  }, []);

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
    setBillingEvent(null);
    BILLING.purchase?.(productId);

    // 60s safety timeout: synthesise a cancelled event if the Android bridge
    // never fires (e.g. app was killed mid-flow). The event-driven path should
    // fire in all real cases before this triggers.
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setBillingEvent(prev => prev ?? { status: 'cancelled', code: -1, message: 'timeout', productId, ts: Date.now() });
    }, 60_000);
  }, []);

  const restore = useCallback(() => {
    if (!BILLING) return;
    BILLING.refresh?.();
    setIsLoading(true);
    setTimeout(() => {
      setStatus(readStatus());
      setPrices(readPrices());
      setIsLoading(false);
      // Synthesise a terminal event so SubscriptionWall clears the restore spinner
      setBillingEvent({ status: 'cancelled', code: 0, message: 'restore_complete', productId: '', ts: Date.now() });
    }, 4000);
  }, []);

  const clearBillingEvent = useCallback(() => setBillingEvent(null), []);

  const consumeTestPurchase = useCallback(() => {
    if (!BILLING?.consumeTestPurchase) return;
    setBillingEvent(null);
    BILLING.consumeTestPurchase();
  }, []);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  return {
    isPro: status.active,
    productId: status.productId,
    prices,
    isAndroidApp: !!BILLING,
    canConsumeTestPurchase: typeof BILLING?.consumeTestPurchase === 'function',
    isLoading,
    subscribe,
    restore,
    refresh,
    consumeTestPurchase,
    billingEvent,
    clearBillingEvent,
    billingErrorMessage,
  };
}
