import React, { useState, useEffect, useRef } from 'react';
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
  onReviewerUnlock,
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

  const [pending, setPending]         = useState(null);
  const [errorMsg, setErrorMsg]       = useState(null);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [codeValue, setCodeValue]     = useState('');
  const [codeError, setCodeError]     = useState(false);
  const codeInputRef = useRef(null);

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

  const handleShowCodeInput = () => {
    setShowCodeInput(true);
    setCodeError(false);
    setCodeValue('');
    setTimeout(() => codeInputRef.current?.focus(), 0);
  };

  const handleCodeSubmit = async () => {
    const ok = await onReviewerUnlock?.(codeValue.trim());
    if (!ok) setCodeError(true);
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
        {trialEligible ? 'Start your 14-day free trial' : 'Unlock dayGLANCE Pro'}
      </h1>
      <p className={`text-sm text-center mb-7 max-w-xs ${sub}`}>
        {trialEligible
          ? 'Free for 14 days — nothing charged today. Cancel anytime, keep your data.'
          : 'Pick a plan to pick up where you left off. Your data is safe and waiting.'}
      </p>

      {/* Error message */}
      {errorMsg && (
        <div className="w-full max-w-xs mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3">
          <p className="text-xs text-red-500 text-center">{errorMsg}</p>
        </div>
      )}

      {/* Plan cards */}
      <div className="w-full max-w-xs space-y-3 mb-5">

        {/* Annual subscription — shown first; carries the free trial */}
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
          <div className={`text-xs mt-0.5 ${sub}`}>
            {trialEligible
              ? `14-day free trial, then ${prices?.yearly ?? '$9.99'}/yr`
              : `Billed yearly · ${prices?.yearly ?? '$9.99'}/yr`}
          </div>
          {pending === 'yearly' && <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />}
        </button>

        {/* Lifetime — best value */}
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

      </div>

      {/* Subscription disclosure — required by App Store guideline 3.1.2 and Play Subscriptions policy */}
      <p className={`text-xs text-center mb-3 max-w-xs leading-relaxed ${sub}`}>
        {trialEligible
          ? `Your 14-day free trial automatically converts to a ${prices?.yearly ?? '$9.99'}/year subscription that renews annually until canceled. Cancel anytime in your ${isIOSApp ? 'App Store' : 'Google Play'} subscription settings.`
          : `Your ${prices?.yearly ?? '$9.99'}/year subscription automatically renews annually until canceled. Cancel anytime in your ${isIOSApp ? 'App Store' : 'Google Play'} subscription settings.`}
      </p>

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

      {/* Reviewer / access code bypass */}
      {!showCodeInput ? (
        <button
          onClick={handleShowCodeInput}
          className={`mt-4 text-xs ${sub} opacity-50 hover:opacity-80 transition-opacity`}
        >
          Reviewer access
        </button>
      ) : (
        <div className="mt-4 w-full max-w-xs flex flex-col items-center gap-2">
          <div className="flex w-full gap-2">
            <input
              ref={codeInputRef}
              type="text"
              value={codeValue}
              onChange={e => { setCodeValue(e.target.value); setCodeError(false); }}
              onKeyDown={e => e.key === 'Enter' && handleCodeSubmit()}
              placeholder="Access code"
              className={`flex-1 rounded-lg border px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-gray-900 border-gray-700 text-gray-100 placeholder-gray-600' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'}`}
            />
            <button
              onClick={handleCodeSubmit}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              Unlock
            </button>
          </div>
          {codeError && (
            <p className="text-xs text-red-500">Invalid code.</p>
          )}
        </div>
      )}

    </div>
  );
}
