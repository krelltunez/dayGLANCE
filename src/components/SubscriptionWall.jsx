import React, { useState, useEffect } from 'react';
import { Loader } from 'lucide-react';

/**
 * Full-screen paywall shown on Android, iOS, and macOS when the user has no active subscription.
 *
 * All platforms show the same two options:
 *   - Annual subscription  (auto-renewable)
 *   - Lifetime purchase    (one-time, non-consumable)
 *
 * Product IDs differ per platform but are fully handled in useSubscription / the callbacks
 * passed in from App.jsx — this component only renders prices and labels.
 *
 * `isIOSApp` (true for iOS and macOS) changes only the payment attribution line at the bottom.
 *
 * Founder pricing: both products launch at the founder price. No promo codes or intro offers.
 * The badge copy can be removed when the price is raised in App Store Connect / Play Console.
 */
export default function SubscriptionWall({
  isIOSApp,
  onSubscribeYearly,
  onSubscribeLifetime,
  onRestore,
  isLoading,
  prices,
  trialEligible = true,
  billingEvent,
  clearBillingEvent,
  billingErrorMessage,
}) {
  const dark = (() => {
    try { return JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'); }
    catch { return false; }
  })();

  const [pending, setPending]   = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!billingEvent) return;
    setPending(null);
    if (billingEvent.status === 'error') {
      setErrorMsg(billingErrorMessage?.(billingEvent.code) ?? 'Something went wrong. Please try again.');
    } else {
      setErrorMsg(null);
    }
    clearBillingEvent?.();
  }, [billingEvent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubscribe = (label, cb) => {
    setErrorMsg(null);
    setPending(label);
    cb?.();
  };

  const handleRestore = () => {
    setErrorMsg(null);
    setPending('restore');
    onRestore?.();
  };

  const bg   = dark ? 'bg-gray-950' : 'bg-white';
  const text = dark ? 'text-gray-100' : 'text-gray-900';
  const sub  = dark ? 'text-gray-400' : 'text-gray-500';
  const card = dark ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200';

  if (isLoading) {
    return (
      <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${bg}`}>
        <Loader className={`w-8 h-8 animate-spin ${sub}`} />
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6 ${bg}`}>

      {/* Logo */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <img
          src="/dayglance-dark.svg"
          alt="dayGLANCE"
          className={`h-10 ${dark ? '' : 'invert'}`}
          onError={e => { e.target.style.display = 'none'; }}
        />
      </div>

      {/* Founder badge */}
      <div className="mb-5 flex items-center gap-2 rounded-full bg-amber-500/15 border border-amber-500/30 px-4 py-1.5">
        <span className="text-amber-500 text-xs font-semibold tracking-wide uppercase">Founder pricing</span>
        <span className={`text-xs ${sub}`}>· thanks for supporting the app!</span>
      </div>

      {/* Headline */}
      <h1 className={`text-xl font-semibold text-center mb-2 ${text}`}>
        Unlock dayGLANCE Pro
      </h1>
      <p className={`text-sm text-center mb-7 max-w-xs ${sub}`}>
        Choose a plan to keep using dayGLANCE. Your data is safe and waiting.
      </p>

      {/* Error message */}
      {errorMsg && (
        <div className="w-full max-w-xs mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-xs text-red-500 text-center">{errorMsg}</p>
        </div>
      )}

      {/* Plan cards */}
      <div className="w-full max-w-xs space-y-3 mb-5">

        {/* Lifetime — best value, shown first */}
        <button
          onClick={() => handleSubscribe('lifetime', onSubscribeLifetime)}
          disabled={!!pending}
          className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${card} ${pending === 'lifetime' ? 'opacity-60' : ''}`}
        >
          <div className="flex items-baseline justify-between">
            <div className="flex items-center gap-2">
              <span className={`font-semibold text-sm ${text}`}>Lifetime</span>
              <span className="text-xs bg-indigo-600 text-white rounded-full px-2 py-0.5 leading-none">Best value</span>
            </div>
            {prices?.lifetime
              ? <span className={`text-sm font-medium ${text}`}>{prices.lifetime}</span>
              : <span className={`text-xs ${sub}`}>Loading…</span>
            }
          </div>
          <div className={`text-xs mt-0.5 ${sub}`}>One-time purchase · yours forever</div>
          {pending === 'lifetime' && <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />}
        </button>

        {/* Annual subscription */}
        <button
          onClick={() => handleSubscribe('yearly', onSubscribeYearly)}
          disabled={!!pending}
          className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${card} ${pending === 'yearly' ? 'opacity-60' : ''}`}
        >
          <div className="flex items-baseline justify-between">
            <span className={`font-semibold text-sm ${text}`}>Annual</span>
            {prices?.yearly
              ? <span className={`text-sm font-medium ${text}`}>{prices.yearly}<span className={`text-xs ${sub}`}>/yr</span></span>
              : <span className={`text-xs ${sub}`}>Loading…</span>
            }
          </div>
          <div className={`text-xs mt-0.5 ${sub}`}>{trialEligible ? '14-day free trial · billed yearly · cancel any time' : 'Billed yearly · cancel any time'}</div>
          {pending === 'yearly' && <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />}
        </button>

      </div>

      <p className={`text-xs text-center mb-6 max-w-xs ${sub}`}>
        {isIOSApp ? 'Payment via App Store.' : 'Payment via Google Play.'}
      </p>

      <button
        onClick={handleRestore}
        disabled={!!pending}
        className={`text-sm underline ${sub} disabled:opacity-50`}
      >
        {pending === 'restore' ? 'Checking…' : 'Restore purchase'}
      </button>

    </div>
  );
}
