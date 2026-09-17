import React, { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { canUseJobo, useJoboEnabled, setJoboEnabled } from '../../jobo/preference.js';
const Mobile = lazy(() => import('./MobileJoboView.jsx'));
const Day = lazy(() => import('./JoboViews.jsx').then(m => ({
  default: m.JoboDayView
})));
const Week = lazy(() => import('./JoboViews.jsx').then(m => ({
  default: m.JoboWeekView
})));
const Carry = lazy(() => import('./JoboViews.jsx').then(m => ({
  default: m.JoboCarryButton
})));
export function useJoboAvailable() {
  return canUseJobo(useJoboEnabled(), useDayPlannerCtx(), useFeaturesCtx());
}
export function JoboDayRoute({
  fallback
}) {
  const available = useJoboAvailable();
  return available ? <Suspense fallback={fallback}><Day /></Suspense> : fallback;
}
export function JoboMobileRoute({ fallback }) {
  const available = useJoboAvailable();
  const { isPhone } = useDayPlannerCtx();
  return available && isPhone ? <Suspense fallback={fallback}><Mobile /></Suspense> : fallback;
}
export function JoboWeekRoute({
  fallback
}) {
  const available = useJoboAvailable();
  return available ? <Suspense fallback={fallback}><Week /></Suspense> : fallback;
}
export function JoboCarryRoute() {
  const available = useJoboAvailable();
  return available ? <Suspense fallback={null}><Carry /></Suspense> : null;
}
export function JoboSettings() {
  const {
      t
    } = useTranslation(),
    enabled = useJoboEnabled(),
    ctx = useDayPlannerCtx(),
    features = useFeaturesCtx();
  const [error, setError] = useState(false);
  return <div className="space-y-1" data-jobo-settings>
    <label className={`flex items-center gap-2 text-xs ${ctx.textPrimary}`}>
      <input type="checkbox" checked={enabled} disabled={features.multiUserEnabled || ctx.isTrayMode} onChange={event => {
        try {
          setJoboEnabled(event.target.checked);
          setError(false);
        } catch {
          setError(true);
        }
      }} />
      {t('jobo.enabled')}
    </label>
    <p className={`text-xs ${ctx.textSecondary}`}>{t('jobo.localOnly')}</p>
    {error && <p role="alert" className="text-xs text-red-500">{t('jobo.preferenceError')}</p>}
  </div>;
}
