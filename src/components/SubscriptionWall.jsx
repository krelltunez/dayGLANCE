import React, { useState, useEffect } from 'react';
import { Loader } from 'lucide-react';

/**
 * Full-screen paywall shown on Android when the user has no active subscription.
 *
 * The 14-day free trial and pricing are configured in Google Play Console.
 * `prices` contains the localized amounts fetched live from Play — they update
 * automatically if you change the price in Play Console, with no code change needed.
 *
 * The "Founder pricing" badge is intentional during launch. Remove it (or change
 * the copy) when you raise prices.
 */
export default function SubscriptionWall({ onSubscribeAnnual, onSubscribeLifetime, onRestore, isLoading, prices, billingEvent, clearBillingEvent, billingErrorMessage }) {
  const dark = (() => {
    try { return JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'); }
    catch { return false; }
  })();

  const [pending, setPending] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Clear spinner and show error on every terminal billing event.
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

  const handleSubscribe = (productId, label) => {
    setErrorMsg(null);
    setPending(label);
    if (label === 'annual')   onSubscribeAnnual?.();
    if (label === 'lifetime') onSubscribeLifetime?.();
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

        <button
          onClick={() => handleSubscribe('dayglance_pro_annual', 'annual')}
          disabled={!!pending}
          className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${card} ${pending === 'annual' ? 'opacity-60' : ''}`}
        >
          <div className="flex items-baseline justify-between">
            <span className={`font-semibold text-sm ${text}`}>Annual</span>
            {prices?.annual
              ? <span className={`text-sm font-medium ${text}`}>{prices.annual}<span className={`text-xs ${sub}`}>/yr</span></span>
              : <span className={`text-xs ${sub}`}>See price in Play</span>
            }
          </div>
          <div className={`text-xs mt-0.5 ${sub}`}>Billed yearly · cancel any time</div>
          {pending === 'annual' && <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />}
        </button>

        <button
          onClick={() => handleSubscribe('dayglance_pro_lifetime', 'lifetime')}
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
              : <span className={`text-xs ${sub}`}>See price in Play</span>
            }
          </div>
          <div className={`text-xs mt-0.5 ${sub}`}>One-time purchase · yours forever</div>
          {pending === 'lifetime' && <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />}
        </button>

      </div>

      <p className={`text-xs text-center mb-6 max-w-xs ${sub}`}>
        Annual plan includes a 14-day free trial. Payment via Google Play.
      </p>

      <button
        onClick={handleRestore}
        disabled={!!pending}
        className={`text-xs underline ${sub} disabled:opacity-50`}
      >
        {pending === 'restore' ? 'Checking…' : 'Restore purchase'}
      </button>

    </div>
  );
}
