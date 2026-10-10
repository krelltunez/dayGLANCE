import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { stripWikilinks } from '../utils/taskUtils.js';

export default function FocusDoReview({ review, onSave, onDismiss }) {
  const { t } = useTranslation();
  const { capture, summary, busy, error, choice } = review;
  const [selected, setSelected] = useState(capture.candidates[0].actionId);
  const differenceSeconds = Math.ceil(Math.abs(summary.recordedDifferenceMilliseconds) / 1000);
  const differenceKey = summary.recordedDifferenceMilliseconds > 0 ? 'differenceMore' : 'differenceLess';
  return (
    <section aria-labelledby="focus-do-heading" className="w-full max-w-md px-6 py-8 my-auto flex flex-col gap-5 text-gray-200">
      <h1 id="focus-do-heading" className="text-2xl font-bold text-white">{t('focus.doReview.title')}</h1>
      {capture.candidates.length === 1 ? (
        <p className="break-words">{stripWikilinks(capture.candidates[0].title)}</p>
      ) : (
        <label className="flex flex-col gap-2">
          <span>{t('focus.doReview.chooseTask')}</span>
          <select className="bg-gray-800 text-white rounded-lg p-3" value={selected} disabled={busy || !!choice}
            onChange={event => setSelected(event.target.value)}>
            {capture.candidates.map(task => <option key={task.actionId} value={task.actionId}>{stripWikilinks(task.title)}</option>)}
          </select>
        </label>
      )}
      <p>{t('focus.doReview.minutes', { minutes: summary.recordedMinutes })}</p>
      {differenceSeconds > 0 && <p className="text-sm text-amber-300">{t(`focus.doReview.${differenceKey}`, { seconds: differenceSeconds })}</p>}
      {summary.clockChanged && <p className="text-sm text-amber-300">{t('focus.doReview.clockChanged')}</p>}
      {error && <p role="alert" className="text-sm text-amber-300">{t(`focus.doReview.${error}`)}</p>}
      <div className="flex flex-col gap-3">
        <button disabled={busy} onClick={() => onSave(selected, true)} className="py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
          {t('focus.doReview.completed')}
        </button>
        <button disabled={busy} onClick={() => onSave(selected, false)} className="py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
          {t('focus.doReview.inProgress')}
        </button>
        {error && <button disabled={busy} onClick={onDismiss} className="py-2 text-sm underline disabled:opacity-50">{t('focus.doReview.continueWithoutSaving')}</button>}
      </div>
    </section>
  );
}
