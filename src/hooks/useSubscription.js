import { useState, useEffect, useCallback, useRef } from 'react';
import { isNativeIOS } from '../native.js';
import { deriveReviewerCode, sha256Hex } from '../config/reviewerAccess.js';

// ── Platform detection ────────────────────────────────────────────────────────

// Android: synchronous Google Play Billing bridge
const BILLING = typeof window !== 'undefined' ? window.DayGlanceBilling : null;

// iOS: RevenueCat via WKURLSchemeHandler synchronous bridge
const IOS = typeof window !== 'undefined' && isNativeIOS();

// Electron (macOS): StoreKit via inAppPurchase + RevenueCat REST API over IPC
const ELECTRON = typeof window !== 'undefined' &&
  !!(window.electronAPI?.subscriptionStatus);

// ── Status / price readers ────────────────────────────────────────────────────

function readStatusAndroid() {
  if (!BILLING) return { active: false, productId: null };
  try { return JSON.parse(BILLING.getStatus()); }
  catch { return { active: false, productId: null }; }
}

function readStatusIOS() {
  if (!IOS) return { active: false, productId: null };
  try { return JSON.parse(window.DayGlanceNative.getSubscriptionStatus()); }
  catch { return { active: false, productId: null }; }
}

// Electron status is async — this reads the localStorage cache for the initial
// synchronous render; IPC refreshes it on mount.
function readStatusElectronCached() {
  try {
    const raw = localStorage.getItem('rc_electron_status');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { active: false, productId: null };
}

function readStatus() {
  if (BILLING) return readStatusAndroid();
  if (IOS)     return readStatusIOS();
  if (ELECTRON) return readStatusElectronCached();
  return { active: false, productId: null };
}

function readPricesAndroid() {
  if (!BILLING) return { yearly: null, lifetime: null };
  try {
    const p = JSON.parse(BILLING.getProductPrices());
    // Android bridge returns { annual, lifetime } — remap annual→yearly for a unified shape.
    return { yearly: p.annual || null, lifetime: p.lifetime || null };
  } catch { return { yearly: null, lifetime: null }; }
}

function readPricesIOS() {
  if (!IOS) return { yearly: null, lifetime: null };
  try {
    const p = JSON.parse(window.DayGlanceNative.getProductPrices());
    return { yearly: p.yearly || null, lifetime: p.lifetime || null };
  } catch { return { yearly: null, lifetime: null }; }
}

function readPrices() {
  if (BILLING)  return readPricesAndroid();
  if (IOS)      return readPricesIOS();
  if (ELECTRON) return { yearly: null, lifetime: null }; // pushed async via subscription:prices-ready
  return {};
}

function readTrialEligibility() {
  if (BILLING) {
    try {
      const data = JSON.parse(BILLING.getTrialEligibility());
      return data?.['dayglance_pro_annual'] !== false;
    } catch { return true; }
  }
  if (!IOS) return true;
  try {
    const data = JSON.parse(window.DayGlanceNative.getTrialEligibility());
    // Only treat as ineligible when the bridge explicitly returns false.
    return data?.['com.dayglance.pro.yearly'] !== false;
  } catch { return true; }
}

// ── Error code → user message ─────────────────────────────────────────────────

/**
 * Maps a billing error code to a user-facing string.
 * Returns a generic message for unknown codes.
 * Code 2 = SKErrorPaymentCancelled (macOS) / user cancelled — should not
 * surface as an error message (handled as 'cancelled' status upstream).
 */
function billingErrorMessage(code) {
  switch (code) {
    case 1:  return 'Product not found. Please try again later.';
    case 3:  return 'Billing is not available on this device.';
    case 4:  return "This subscription isn't available right now. Please try again later.";
    case 6:  return 'Network error. Please check your connection and try again.';
    case 7:  return 'You already own this item.';
    default: return 'Something went wrong with the purchase. Please try again.';
  }
}

// ── Reviewer unlock ───────────────────────────────────────────────────────────

const REVIEWER_UNLOCK_KEY = 'day-planner-reviewer-unlock';

// ── Entitlement downgrade grace ───────────────────────────────────────────────
// A paying user must NEVER see the paywall, even for a second. Entitlement reads
// can transiently report inactive on an entitled install (RevenueCat's transfer
// behavior moves the shared entitlement to whichever device validated last; store
// caches lag), and the native layers self-heal within a few seconds. So status
// transitions are asymmetric: inactive→active applies INSTANTLY, while
// active→inactive is held for a grace window and only applied if no recovery
// (an active read or a purchase/restore event) lands first. A genuinely lapsed
// subscription still locks — just GRACE ms later.
const DOWNGRADE_GRACE_MS = 12_000;

// Persisted "this install has been entitled" hint, so a stale native cache at
// cold launch can't flash the wall at first paint either — the install starts
// provisionally unlocked and the same grace window confirms or clears it.
const LAST_ACTIVE_KEY = 'day-planner-entitlement-last-active';

function readLastActiveHint() {
  try { return JSON.parse(localStorage.getItem(LAST_ACTIVE_KEY) || 'null'); }
  catch { return null; }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Exposes subscription state to the React app.
 *
 * Android  — Google Play Billing (window.DayGlanceBilling). Synchronous reads.
 * iOS      — RevenueCat/StoreKit 2 (WKURLSchemeHandler bridge). Synchronous reads.
 * macOS    — StoreKit inAppPurchase + RevenueCat REST (Electron IPC). Async reads
 *            with localStorage cache for the initial synchronous render.
 * Web/PWA  — isPro always true; isAndroidApp, isIOSApp, isElectronApp all false;
 *            no wall shown.
 *
 * All three native platforms deliver purchase outcomes via window.__billingEvent.
 * `prices` shape: Android → { annual, lifetime } | iOS/macOS → { monthly, yearly }
 */
export function useSubscription() {
  const [status, setStatus]               = useState(() => {
    const s = readStatus();
    if (s.active) return s;
    // Native cache says inactive, but this install has been entitled before —
    // start provisionally unlocked; the grace effect below confirms or clears it.
    const hint = readLastActiveHint();
    return hint ? { active: true, productId: hint.productId ?? null, provisional: true } : s;
  });
  const [prices, setPrices]               = useState(() => readPrices());
  const [trialEligible, setTrialEligible] = useState(() => readTrialEligibility());
  const [isLoading, setIsLoading]         = useState(false);
  const [billingEvent, setBillingEvent]   = useState(null);
  const [isReviewerUnlocked, setIsReviewerUnlockedState] = useState(false);
  const timeoutRef = useRef(null);

  // Async init: validate stored hash against this month's derived code.
  useEffect(() => {
    const stored = localStorage.getItem(REVIEWER_UNLOCK_KEY);
    if (!stored) return;
    deriveReviewerCode()
      .then(code => sha256Hex(code))
      .then(hash => { if (stored === hash) setIsReviewerUnlockedState(true); })
      .catch(() => {});
  }, []);

  // Validates input against this month's code; stores hash on success.
  const setReviewerUnlocked = useCallback(async (input) => {
    try {
      const expected = await deriveReviewerCode();
      if (input !== expected) return false;
      const hash = await sha256Hex(input);
      try { localStorage.setItem(REVIEWER_UNLOCK_KEY, hash); } catch {}
      setIsReviewerUnlockedState(true);
      return true;
    } catch {
      return false;
    }
  }, []);

  const isOnNativePlatform = !!(BILLING || IOS || ELECTRON);

  // Mirror of `status` for non-render decisions (grace scheduling).
  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);
  const downgradeRef = useRef(null);

  // The single gate through which every entitlement reading is applied.
  // Asymmetric on purpose (see DOWNGRADE_GRACE_MS): active applies instantly and
  // cancels any pending downgrade; inactive on a currently-unlocked install is
  // HELD for the grace window so native self-heal (Mac receipt re-post, iOS
  // syncPurchases, purchase/restore events) can win without the wall ever
  // mounting. Indeterminate readings are ignored outright.
  const applyStatus = useCallback((next) => {
    if (!next || next.indeterminate) return;
    if (next.active) {
      if (downgradeRef.current) { clearTimeout(downgradeRef.current); downgradeRef.current = null; }
      setStatus(next);
      try { localStorage.setItem(LAST_ACTIVE_KEY, JSON.stringify({ productId: next.productId ?? null })); } catch {}
      if (ELECTRON) { try { localStorage.setItem('rc_electron_status', JSON.stringify(next)); } catch {} }
      return;
    }
    if (!statusRef.current.active) { setStatus(next); return; } // already locked — apply freely
    if (downgradeRef.current) return; // a downgrade is already pending confirmation
    downgradeRef.current = setTimeout(() => {
      downgradeRef.current = null;
      setStatus(next);
      try { localStorage.removeItem(LAST_ACTIVE_KEY); } catch {}
      if (ELECTRON) { try { localStorage.setItem('rc_electron_status', JSON.stringify(next)); } catch {} }
    }, DOWNGRADE_GRACE_MS);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Confirm or clear a provisional cold-launch unlock: re-read the native source
  // after the grace window; applyStatus locks it only if still inactive then.
  useEffect(() => {
    if (!statusRef.current.provisional) return;
    const t = setTimeout(() => { applyStatus(readStatus()); }, DOWNGRADE_GRACE_MS);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-read entitlement from the authoritative native source after a CONFIRMED
  // purchase or restore, purely to fill in the accurate productId. The native
  // cache can briefly lag (StoreKit sandbox especially), so re-read on a few
  // short delays and apply ONLY active results — a lagging cache right after
  // someone paid must not even start a downgrade countdown.
  const reconcileStatus = useCallback(() => {
    const applyIfActive = (s) => { if (s && s.active) applyStatus(s); };
    [0, 1200, 3000].forEach((delay) => setTimeout(() => {
      if (ELECTRON) {
        window.electronAPI.subscriptionStatus().then(applyIfActive).catch(() => {});
      } else if (BILLING) {
        applyIfActive(readStatusAndroid());
      } else if (IOS) {
        applyIfActive(readStatusIOS());
      }
    }, delay));
  }, [applyStatus]);

  // ── Billing event handler (shared by all platforms) ──────────────────────
  const handleBillingEvent = useCallback((ev) => {
    try {
      const parsed = typeof ev === 'string' ? JSON.parse(ev) : ev;
      // A 'success' purchase event and an active restore ('restore_complete_active')
      // are both only emitted AFTER the platform validates the entitlement, so
      // unlock immediately rather than waiting on a possibly-stale cache read —
      // that lag previously left the paywall up after a completed purchase.
      const purchased = parsed.status === 'success';
      const restoredActive = parsed.message === 'restore_complete_active';
      if (purchased || restoredActive) {
        // Optimistic unlock through the gate: applies instantly, cancels any
        // pending downgrade, and persists the unlock (LAST_ACTIVE hint + the
        // Electron rc_electron_status cache) so it survives relaunch.
        applyStatus({ active: true, productId: parsed.productId || statusRef.current.productId || null });
        if (BILLING) setPrices(readPricesAndroid());
        if (IOS)     setPrices(readPricesIOS());
        reconcileStatus(); // fill accurate productId; never re-locks
      }
      setBillingEvent({ ...parsed, ts: Date.now() });
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    } catch {}
  }, [reconcileStatus, applyStatus]);

  // Register window.__billingEvent — fired by Android and iOS bridges.
  useEffect(() => {
    if (!isOnNativePlatform) return;
    window.__billingEvent = handleBillingEvent;
    return () => { delete window.__billingEvent; };
  }, [handleBillingEvent, isOnNativePlatform]);

  // Electron: subscribe to subscription:event IPC push.
  useEffect(() => {
    if (!ELECTRON) return;
    const unsub = window.electronAPI.onSubscriptionEvent(handleBillingEvent);
    return unsub;
  }, [handleBillingEvent]);

  // Electron: listen for prices pushed from the main process at startup.
  useEffect(() => {
    if (!ELECTRON) return;
    const unsub = window.electronAPI.onSubscriptionPricesReady((p) => {
      setPrices({ yearly: p.yearly ?? null, lifetime: p.lifetime ?? null });
    });
    return unsub;
  }, []);

  // Electron: also PULL cached prices on mount. The startup push can fire before
  // this component registers its listener (Electron drops the message), which left
  // the price stuck on "Loading…". The pull recovers prices already fetched; if the
  // fetch hasn't finished yet, the push above still delivers them.
  useEffect(() => {
    if (!ELECTRON) return;
    window.electronAPI.subscriptionPrices?.().then((p) => {
      if (p && (p.yearly || p.lifetime)) {
        setPrices({ yearly: p.yearly ?? null, lifetime: p.lifetime ?? null });
      }
    }).catch(() => {});
  }, []);

  // On mount: background refresh for each platform.
  useEffect(() => {
    if (BILLING) {
      BILLING.refresh?.();
      // Re-read trial eligibility after a delay to match iOS behavior — BillingManager
      // queries Play async, so the initial read may predate the authoritative result.
      setTimeout(() => { setTrialEligible(readTrialEligibility()); }, 3000);
    }

    if (IOS) {
      // RevenueCat caches status; re-read after a short delay so it has
      // had time to refresh from its background network call.
      setTimeout(() => {
        applyStatus(readStatusIOS());
        setPrices(readPricesIOS());
        setTrialEligible(readTrialEligibility());
      }, 3000);
    }

    if (ELECTRON) {
      // applyStatus ignores indeterminate results (main process couldn't verify),
      // applies active instantly, and holds a determinate inactive for the grace
      // window before locking — so an entitled install never flashes the wall.
      window.electronAPI.subscriptionStatus().then(applyStatus).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-read when the user returns from a purchase sheet or the app regains
  // visibility (all platforms). Routed through applyStatus: active applies
  // instantly, inactive on an unlocked install waits out the grace window, and
  // indeterminate is ignored — so backgrounding the app can never flash the wall.
  const refresh = useCallback(() => {
    if (BILLING) {
      BILLING.refresh?.();
      setTimeout(() => { applyStatus(readStatusAndroid()); setPrices(readPricesAndroid()); }, 2000);
    }
    if (IOS) {
      setTimeout(() => { applyStatus(readStatusIOS()); setPrices(readPricesIOS()); }, 2000);
    }
    if (ELECTRON) {
      window.electronAPI.subscriptionStatus().then(applyStatus).catch(() => {});
    }
  }, [applyStatus]);

  useEffect(() => {
    if (!isOnNativePlatform) return;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh, isOnNativePlatform]);

  // ── subscribe ──────────────────────────────────────────────────────────────
  /**
   * Opens the platform purchase sheet.
   *   Android productId: 'dayglance_pro_annual' | 'dayglance_pro_lifetime'
   *   iOS/macOS productId: 'com.dayglance.pro.yearly' | 'com.dayglance.pro.lifetime'
   */
  const subscribe = useCallback((productId) => {
    if (!isOnNativePlatform) return;
    setBillingEvent(null);

    if (BILLING) BILLING.purchase?.(productId);
    if (IOS)     window.DayGlanceNative.purchase?.(productId);
    if (ELECTRON) window.electronAPI.subscriptionPurchase(productId).catch(() => {});

    // Safety timeout — clears the spinner if the bridge never fires (60s).
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setBillingEvent(prev => prev ?? {
        status: 'cancelled', code: -1, message: 'timeout', productId, ts: Date.now(),
      });
    }, 60_000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── restore ────────────────────────────────────────────────────────────────
  const restore = useCallback(() => {
    if (!isOnNativePlatform) return;
    setBillingEvent(null);

    if (BILLING) {
      BILLING.refresh?.();
      setIsLoading(true);
      setTimeout(() => {
        applyStatus(readStatusAndroid());
        setPrices(readPricesAndroid());
        setIsLoading(false);
        setBillingEvent({ status: 'cancelled', code: 0, message: 'restore_complete', productId: '', ts: Date.now() });
      }, 4000);
    }

    // iOS and Electron: result fires via __billingEvent / subscription:event.
    if (IOS)     window.DayGlanceNative.restorePurchases?.();
    if (ELECTRON) window.electronAPI.subscriptionRestore().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearBillingEvent = useCallback(() => setBillingEvent(null), []);

  const consumeTestPurchase = useCallback(() => {
    if (!BILLING?.consumeTestPurchase) return;
    setBillingEvent(null);
    BILLING.consumeTestPurchase();
  }, []);

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (downgradeRef.current) clearTimeout(downgradeRef.current);
  }, []);

  return {
    isPro: status.active,
    productId: status.productId,
    prices,
    trialEligible,
    isAndroidApp:  !!BILLING,
    isIOSApp:      IOS,
    isElectronApp: ELECTRON,
    canConsumeTestPurchase: typeof BILLING?.consumeTestPurchase === 'function',
    isLoading,
    subscribe,
    restore,
    refresh,
    consumeTestPurchase,
    billingEvent,
    clearBillingEvent,
    billingErrorMessage,
    isReviewerUnlocked,
    setReviewerUnlocked,
  };
}
