import React from 'react';
import { useTranslation } from 'react-i18next';
import { isNativeApp, nativeUpdateEvent } from '../native.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { nativeEventEndString } from '../utils/nativeCalendar.js';

// Which notes panel an event gets. Every view uses the app's own notes panel
// (NotesSubtasksPanel) for a calendar event, as for a task: a feed event's
// description shows read-only there, with your own note beneath it in the
// same editor, formatting and Shift+Enter as any task's notes
// (utils/eventNotes.js). The one exception is an event from this device's
// own calendar in the phone app (`nativeEventId`): its description is the
// event's real notes, edited here and written back to the device calendar.
export const editsDeviceCalendar = (task) => isNativeApp() && task?.nativeEventId != null;

const TONES = {
  // On the event's own colour (desktop cards): white text.
  onColor: {
    label: 'text-xs font-semibold opacity-75 mb-1',
    field: 'w-full text-sm p-2 rounded bg-white/10 text-white placeholder:text-white/40 resize-y focus:outline-none focus:bg-white/20',
  },
  // On the app's surface (phone sheets): theme colours.
  themed: (darkMode) => ({
    label: `text-xs font-semibold mb-1 ${darkMode ? 'text-gray-400' : 'text-stone-500'}`,
    field: `w-full text-sm p-3 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-white/5 text-white placeholder:text-white/40' : 'bg-black/5 text-stone-900 placeholder:text-stone-400'}`,
  }),
};

/**
 * What a description edit writes back to the device calendar: the event as it
 * stands with its new notes. An event that runs past midnight ends on the
 * next date (#2278, nativeEventEndString): "…T25:00:00" is not a time the
 * calendar can read, and the write would fail.
 */
export function deviceEventNotesWrite(task, notes, allDay = false) {
  const start = task.startTime || '00:00';
  return {
    id: task.nativeEventId,
    title: task.title,
    start: `${task.date}T${start}:00`,
    end: nativeEventEndString(task.date, start, task.duration || 0),
    allDay,
    notes,
    location: task.location || '',
  };
}

/** The notes of an event from this device's calendar (see editsDeviceCalendar). */
export default function EventNotesPanel({ task, tone = 'onColor', rows = 3, allDay = false }) {
  const { t } = useTranslation();
  const { setTasks, darkMode } = useDayPlannerCtx();
  const th = tone === 'themed' ? TONES.themed(darkMode) : TONES.onColor;
  const description = task.notes || '';
  return (
    <div data-event-notes="device">
      <div className={th.label}>{t('common.description')}</div>
      <textarea
        defaultValue={description}
        placeholder={t('task.descriptionPlaceholder', { defaultValue: 'Add description…' })}
        rows={rows}
        className={th.field}
        onBlur={async (e) => {
          const newNotes = e.target.value;
          if (newNotes === description) return;
          setTasks(prev => prev.map(row => row.id === task.id ? { ...row, notes: newNotes, transitionId: crypto.randomUUID() } : row));
          await nativeUpdateEvent(deviceEventNotesWrite(task, newNotes, allDay));
        }}
      />
    </div>
  );
}
