import React, { useState } from 'react';
import { Loader } from 'lucide-react';

/**
 * Full-screen paywall shown on Android when the user has no active subscription
 * (trial expired or never started).
 *
 * The 14-day free trial period is configured in Play Console as a free-trial
 * offer on the base plan — no code change needed to adjust it.
 */
export default function SubscriptionWall({ onSubscribeMonthly, onSubscribeAnnual, onRestore, isLoading }) {
  const dark = (() => {
    try { return JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'); }
    catch { return false; }
  })();

  const [pending, setPending] = useState(null);

  const handleSubscribe = (productId, label) => {
    setPending(label);
    onSubscribeMonthly && label === 'monthly' && onSubscribeMonthly();
    onSubscribeAnnual  && label === 'annual'  && onSubscribeAnnual();
  };

  const handleRestore = () => {
    setPending('restore');
    onRestore?.();
  };

  const bg    = dark ? 'bg-gray-950' : 'bg-white';
  const text  = dark ? 'text-gray-100' : 'text-gray-900';
  const sub   = dark ? 'text-gray-400' : 'text-gray-500';
  const card  = dark ? 'bg-gray-900 border-gray-800' : 'bg-gray-50 border-gray-200';
  const btnPrimary = 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white';
  const btnSecondary = dark
    ? 'bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700'
    : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300';

  if (isLoading) {
    return (
      <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${bg}`}>
        <Loader className={`w-8 h-8 animate-spin ${sub}`} />
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center px-6 ${bg}`}>
      {/* Logo / wordmark */}
      <div className="mb-8 flex flex-col items-center gap-2">
        <img
          src="/dayglance-dark.svg"
          alt="dayGLANCE"
          className={`h-10 ${dark ? '' : 'invert'}`}
          onError={e => { e.target.style.display = 'none'; }}
        />
        <span className={`text-2xl font-bold tracking-tight ${text}`}>dayGLANCE</span>
      </div>

      {/* Headline */}
      <h1 className={`text-xl font-semibold text-center mb-2 ${text}`}>
        Your free trial has ended
      </h1>
      <p className={`text-sm text-center mb-8 max-w-xs ${sub}`}>
        Subscribe to keep using dayGLANCE. Your data is safe and waiting.
      </p>

      {/* Plan cards */}
      <div className="w-full max-w-xs space-y-3 mb-6">
        <button
          onClick={() => handleSubscribe('dayglance_pro_monthly', 'monthly')}
          disabled={!!pending}
          className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${card} ${pending === 'monthly' ? 'opacity-60' : ''}`}
        >
          <div className={`font-semibold text-sm mb-0.5 ${text}`}>Monthly</div>
          <div className={`text-xs ${sub}`}>Billed monthly · cancel any time</div>
          {pending === 'monthly' && (
            <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />
          )}
        </button>

        <button
          onClick={() => handleSubscribe('dayglance_pro_annual', 'annual')}
          disabled={!!pending}
          className={`w-full rounded-xl border px-4 py-4 text-left transition-colors ${card} ${pending === 'annual' ? 'opacity-60' : ''}`}
        >
          <div className="flex items-center gap-2">
            <span className={`font-semibold text-sm ${text}`}>Annual</span>
            <span className="text-xs bg-indigo-600 text-white rounded-full px-2 py-0.5">Best value</span>
          </div>
          <div className={`text-xs mt-0.5 ${sub}`}>Billed yearly · cancel any time</div>
          {pending === 'annual' && (
            <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />
          )}
        </button>
      </div>

      {/* CTA */}
      <p className={`text-xs text-center mb-6 max-w-xs ${sub}`}>
        Prices shown in the next screen. Payment charged via Google Play.
        Cancel any time from Play Store.
      </p>

      {/* Restore */}
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
