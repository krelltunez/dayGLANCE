import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

/**
 * The follow-up form's switch (#2422): the Inbox, where a follow-up starts,
 * or the timeline, on a day and at a time. Shared by the desktop and mobile
 * task forms, and shown only on a new follow-up (`newTask.followUp`, set by
 * utils/followUp.js and JOBO's Inbox follow-up): every other form keeps the
 * flavor it was opened in.
 *
 * It replaces a project task's "Unscheduled" tick on these forms, which says
 * the same thing. The switching itself, and re-reading a date typed in the
 * title for the form now showing, is the input hook's
 * (useNewTaskInput switchFollowUpDestination).
 */
const FollowUpDestination = () => {
  const { t } = useTranslation();
  const { newTask, mobileEditingTask, switchFollowUpDestination, darkMode, borderClass, textPrimary } = useDayPlannerCtx();

  if (!newTask?.followUp || mobileEditingTask || typeof switchFollowUpDestination !== 'function') return null;

  const toInbox = !!newTask.openInInbox;
  const option = (inbox, label) => {
    const selected = toInbox === inbox;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        data-follow-up-destination={inbox ? 'inbox' : 'schedule'}
        onClick={() => switchFollowUpDestination(inbox)}
        className={`flex-1 px-3 py-1.5 text-sm rounded-md transition-colors ${selected
          ? 'bg-blue-600 text-white'
          : `${textPrimary} ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-stone-200'}`}`}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('followUp.destination')}
      className={`flex gap-1 p-1 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700' : 'bg-stone-100'}`}
    >
      {option(true, t('followUp.toInbox'))}
      {option(false, t('followUp.toSchedule'))}
    </div>
  );
};

export default FollowUpDestination;
