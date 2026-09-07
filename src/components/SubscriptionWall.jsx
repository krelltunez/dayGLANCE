import React, { useState, useEffect, useRef } from 'react';
import Wordmark from './Wordmark';
import { Check, Loader } from 'lucide-react';
import { paywallErrorMessage } from '../utils/paywallErrorMessage.js';
import { useTranslation } from 'react-i18next';

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
 * Prices AND the trial length come from StoreKit / Play Billing at runtime —
 * there are deliberately no hardcoded price or trial-length strings in this
 * component. When the store hasn't answered yet, price copy shows a loading
 * state and trial copy omits the length; it never invents a number.
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
  trialDays = null,
  billingEvent,
  clearBillingEvent,
  billingErrorMessage,
}) {
  const { t } = useTranslation();
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
      // isAndroid: this wall only renders on the three native platforms, and
      // isIOSApp covers both Apple ones — so !isIOSApp here means Android.
      const fallback = paywallErrorMessage(billingEvent, {
        isAndroid: !isIOSApp,
        mapCode: billingErrorMessage,
      });
      if (!isIOSApp && billingEvent.code === -1) {
        setErrorMsg(t('subscription.errorConnectingGooglePlay', { defaultValue: 'Still connecting to Google Play. Please try again in a moment.' }));
      } else if (billingEvent.code === 1) {
        setErrorMsg(t('subscription.errorProductNotFound', { defaultValue: 'Product not found. Please try again later.' }));
      } else if (billingEvent.code === 3) {
        setErrorMsg(t('subscription.errorBillingUnavailable', { defaultValue: 'Billing is not available on this device.' }));
      } else if (billingEvent.code === 4) {
        setErrorMsg(t('subscription.errorSubscriptionUnavailable', { defaultValue: "This subscription isn't available right now. Please try again later." }));
      } else if (billingEvent.code === 6) {
        setErrorMsg(t('subscription.errorNetwork', { defaultValue: 'Network error. Please check your connection and try again.' }));
      } else if (billingEvent.code === 7) {
        setErrorMsg(t('subscription.errorAlreadyOwned', { defaultValue: 'You already own this item.' }));
      } else {
        setErrorMsg(t('subscription.errorPurchase', { defaultValue: fallback }));
      }
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
  const yearlyPriceShort = prices?.yearly
    ? `${prices.yearly}${t('subscription.perYearShort', { defaultValue: '/yr' })}`
    : null;
  const yearlyPrice = prices?.yearly
    ? `${prices.yearly}${t('subscription.perYear', { defaultValue: '/year' })}`
    : t('subscription.yearly', { defaultValue: 'yearly' });
  const storeName = isIOSApp ? 'App Store' : 'Google Play';
  const features = [
    ['visualPlanner', t('subscription.featureVisualPlanner', { defaultValue: 'Visual day planner with time blocking' })],
    ['tasksProjects', t('subscription.featureTasksProjects', { defaultValue: 'Tasks, projects, routines & goals' })],
    ['deviceCalendar', t('subscription.featureDeviceCalendar', { defaultValue: 'Sync with your device calendar' })],
    ['habitTracking', t('subscription.featureHabitTracking', { defaultValue: 'Habit tracking with streaks & stats' })],
    ['reminders', t('subscription.featureReminders', { defaultValue: 'Reminders and notifications' })],
    ['cloudSync', t('subscription.featureCloudSync', { defaultValue: 'Cross-device sync via your own cloud' })],
  ];

  if (isLoading) {
    return (
      <div className={`fixed inset-0 z-[9999] flex items-center justify-center ${bg}`} role="status" aria-label={t('common.loading')}>
        <Loader className={`w-8 h-8 animate-spin ${sub}`} />
      </div>
    );
  }

  return (
    // Outer layer scrolls; the inner min-h-full wrapper keeps the content
    // vertically centered on tall screens without clipping the top of the
    // page on short ones (the classic justify-center + overflow pitfall).
    <div className={`fixed inset-0 z-[9999] overflow-y-auto ${bg}`}>
    <div className="min-h-full flex flex-col items-center justify-center px-6 py-8">

      {/* Logo */}
      <div className="mb-6 flex flex-col items-center gap-2">
        <Wordmark className="text-4xl" darkMode={dark} />
      </div>

      {/* Headline — trial length comes from the store; omit it when unknown */}
      <h1 className={`text-xl font-semibold text-center mb-2 ${text}`}>
        {trialEligible
          ? (trialDays
              ? t('subscription.trialHeadlineWithDays', { count: trialDays, defaultValue: 'Start your {{count}}-day free trial' })
              : t('subscription.trialHeadline', { defaultValue: 'Start your free trial' }))
          : t('subscription.unlockPro', { defaultValue: 'Unlock dayGLANCE Pro' })}
      </h1>
      <p className={`text-sm text-center mb-7 max-w-xs ${sub}`}>
        {trialEligible
          ? (trialDays
              ? t('subscription.trialDescriptionWithDays', { count: trialDays, defaultValue: 'Free for {{count}} days, nothing charged today. Cancel anytime, keep your data.' })
              : t('subscription.trialDescription', { defaultValue: 'Free to start, nothing charged today. Cancel anytime, keep your data.' }))
          : t('subscription.unlockDescription', { defaultValue: 'Pick a plan to pick up where you left off. Your data is safe and waiting.' })}
      </p>

      {/* What the purchase includes — guideline 3.1.2(c) requires the paywall to
          clearly describe what the user receives for the price. Both plans unlock
          the identical feature set, so one list covers both. Keep bullets limited
          to features that ship on every paywalled platform (iOS, Android, macOS). */}
      <div className="w-full max-w-xs mb-6">
        <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${sub}`}>
          {t('subscription.everyPlanUnlocks', { defaultValue: 'Every plan unlocks the full app' })}
        </p>
        <ul className="space-y-1.5">
          {features.map(([key, label]) => (
            <li key={key} className="flex items-start gap-2">
              <Check size={14} className="text-green-500 flex-shrink-0 mt-0.5" />
              <span className={`text-xs leading-snug ${text}`}>{label}</span>
            </li>
          ))}
        </ul>
      </div>

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
            <span className={`font-semibold text-sm ${text}`}>{t('subscription.annual', { defaultValue: 'Annual' })}</span>
            {prices?.yearly
              ? <span className={`text-sm font-medium ${text}`}>{prices.yearly}<span className={`text-xs ${sub}`}>{t('subscription.perYearShort', { defaultValue: '/yr' })}</span></span>
              : <span className={`text-xs ${sub}`}>{t('common.loading')}</span>
            }
          </div>
          <div className={`text-xs mt-0.5 ${sub}`}>
            {trialEligible
              ? (prices?.yearly
                  ? (trialDays
                      ? t('subscription.trialThenPriceWithDays', { count: trialDays, yearlyPrice: yearlyPriceShort, defaultValue: '{{count}}-day free trial, then {{yearlyPrice}}' })
                      : t('subscription.trialThenPrice', { yearlyPrice: yearlyPriceShort, defaultValue: 'Free trial, then {{yearlyPrice}}' }))
                  : (trialDays
                      ? t('subscription.trialIncludedWithDays', { count: trialDays, defaultValue: '{{count}}-day free trial included' })
                      : t('subscription.trialIncluded', { defaultValue: 'Free trial included' })))
              : (prices?.yearly
                  ? t('subscription.billedYearlyWithPrice', { yearlyPrice: yearlyPriceShort, defaultValue: 'Billed yearly · {{yearlyPrice}}' })
                  : t('subscription.billedYearly', { defaultValue: 'Billed yearly' }))}
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
              <span className={`font-semibold text-sm ${text}`}>{t('subscription.lifetime', { defaultValue: 'Lifetime' })}</span>
              <span className="text-xs bg-indigo-600 text-white rounded-full px-2 py-0.5 leading-none">{t('subscription.bestValue', { defaultValue: 'Best value' })}</span>
            </div>
            {prices?.lifetime
              ? <span className={`text-sm font-medium ${text}`}>{prices.lifetime}</span>
              : <span className={`text-xs ${sub}`}>{t('common.loading')}</span>
            }
          </div>
          <div className={`text-xs mt-0.5 ${sub}`}>{t('subscription.lifetimeDescription', { defaultValue: 'One-time purchase · yours forever' })}</div>
          {pending === 'lifetime' && <Loader className={`w-4 h-4 mt-2 animate-spin ${sub}`} />}
        </button>

      </div>

      {/* Subscription disclosure — required by App Store guideline 3.1.2 and Play
          Subscriptions policy. The price figure is included once the store has
          reported it; until then the disclosure makes no numeric claim rather
          than asserting a price the store hasn't confirmed. */}
      <p className={`text-xs text-center mb-3 max-w-xs leading-relaxed ${sub}`}>
        {trialEligible
          ? (trialDays
              ? t('subscription.trialDisclosureWithDays', { count: trialDays, yearlyPrice, storeName, defaultValue: 'Your {{count}}-day free trial automatically converts to a {{yearlyPrice}} subscription that renews annually until canceled. Cancel anytime in your {{storeName}} subscription settings.' })
              : t('subscription.trialDisclosure', { yearlyPrice, storeName, defaultValue: 'Your free trial automatically converts to a {{yearlyPrice}} subscription that renews annually until canceled. Cancel anytime in your {{storeName}} subscription settings.' }))
          : t('subscription.renewalDisclosure', { yearlyPrice, storeName, defaultValue: 'Your {{yearlyPrice}} subscription automatically renews annually until canceled. Cancel anytime in your {{storeName}} subscription settings.' })}
      </p>

      <p className={`text-xs text-center mb-6 max-w-xs ${sub}`}>
        {isIOSApp
          ? t('subscription.paymentAppStore', { defaultValue: 'Payment via App Store.' })
          : t('subscription.paymentGooglePlay', { defaultValue: 'Payment via Google Play.' })}
      </p>

      {/* Legal links — required by App Store guideline 3.1.2 for auto-renewable subscriptions */}
      <div className={`mb-6 flex items-center justify-center gap-2 text-xs ${sub}`}>
        <button
          onClick={() => window.open('https://glance-apps.com/dayglance/privacy', '_blank', 'noopener')}
          className="underline hover:opacity-80 transition-opacity"
        >
          {t('subscription.privacyPolicy', { defaultValue: 'Privacy Policy' })}
        </button>
        <span className="opacity-50">·</span>
        <button
          onClick={() => window.open('https://www.glance-apps.com/eula', '_blank', 'noopener')}
          className="underline hover:opacity-80 transition-opacity"
        >
          {t('subscription.termsOfUse', { defaultValue: 'Terms of Use' })}
        </button>
      </div>

      <button
        onClick={handleRestore}
        disabled={!!pending}
        className={`text-sm underline ${sub} disabled:opacity-50`}
      >
        {pending === 'restore'
          ? t('subscription.checking', { defaultValue: 'Checking…' })
          : t('subscription.restorePurchase', { defaultValue: 'Restore purchase' })}
      </button>

      {/* Reviewer / access code bypass */}
      {!showCodeInput ? (
        <button
          onClick={handleShowCodeInput}
          className={`mt-4 text-xs ${sub} opacity-50 hover:opacity-80 transition-opacity`}
        >
          {t('subscription.reviewerAccess', { defaultValue: 'Reviewer access' })}
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
              placeholder={t('subscription.accessCodePlaceholder', { defaultValue: 'Access code' })}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-blue-500 ${dark ? 'bg-gray-900 border-gray-700 text-gray-100 placeholder-gray-600' : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'}`}
            />
            <button
              onClick={handleCodeSubmit}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700"
            >
              {t('subscription.unlock', { defaultValue: 'Unlock' })}
            </button>
          </div>
          {codeError && (
            <p className="text-xs text-red-500">{t('subscription.invalidCode', { defaultValue: 'Invalid code.' })}</p>
          )}
        </div>
      )}

    </div>
    </div>
  );
}
