import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import ClockTimePicker from './ClockTimePicker.jsx';
import { formatDuration } from '../utils/formatDuration.js';
import { durationChoices, durationUntil, endOf, parseDurationInput } from '../utils/taskDuration.js';

// The task dialogs' duration and end time (#2249). A fixed menu of six
// durations was all there was: a task resized to 75 minutes, or given "22m"
// in its title, showed a blank or the wrong value, and nothing else could be
// chosen. The arithmetic is in utils/taskDuration.js.

const CUSTOM = 'custom';

/**
 * The duration menu: the presets and the task's own duration, then
 * "Custom…", which becomes a field taking any duration ("22", "1:30",
 * "1h 30"). Enter or leaving the field keeps a valid entry; Escape, or an
 * entry that is not a duration, goes back to the menu unchanged.
 */
export function DurationField({ value, onChange, disabled = false, className = '' }) {
  const { t } = useTranslation();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const invalid = draft.trim() !== '' && parseDurationInput(draft) === null;

  const commit = () => {
    const minutes = parseDurationInput(draft);
    if (minutes !== null) onChange(minutes);
    setTyping(false);
  };

  if (typing) {
    return (
      <input
        type="text"
        inputMode="text"
        autoFocus
        data-duration-custom
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          // The dialog is a form: Enter would submit it, Escape would close it.
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setTyping(false); }
        }}
        placeholder={t('task.durationCustomHint')}
        aria-label={t('task.duration')}
        aria-invalid={invalid || undefined}
        className={`${className} ${invalid ? 'ring-2 ring-red-500' : ''}`}
      />
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value === CUSTOM) { setDraft(''); setTyping(true); return; }
        onChange(parseInt(e.target.value, 10));
      }}
      disabled={disabled}
      data-duration-select
      className={className}
    >
      {durationChoices(value).map((minutes) => (
        <option key={minutes} value={minutes}>{formatDuration(minutes, t)}</option>
      ))}
      <option value={CUSTOM}>{t('task.durationCustom')}</option>
    </select>
  );
}

/**
 * When the task ends, from its start and duration; choosing an end sets the
 * duration. An end at or before the start is the next day, marked "+1".
 */
export function EndTimeField({ startTime, duration, onChange, disabled = false, formatTime, darkMode, isTablet, use24HourClock, className = '' }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const end = disabled ? null : endOf(startTime, duration);
  return (
    <>
      <button
        type="button"
        data-end-time
        onClick={() => end && setOpen(true)}
        disabled={!end}
        title={end?.nextDay ? t('task.nextDay') : undefined}
        className={`${className} ${end ? '' : 'opacity-50 cursor-not-allowed'}`}
      >
        {end ? (
          <>
            {formatTime(end.time)}
            {end.nextDay && <sup data-next-day className="ml-0.5 text-[10px] font-semibold opacity-70">+1</sup>}
          </>
        ) : '—'}
      </button>
      {/* Portalled: a dialog sheet that animates with a transform would
          otherwise trap the picker's fixed overlay inside itself. */}
      {open && end && createPortal(
        <ClockTimePicker
          value={end.time}
          onChange={(time) => { const minutes = durationUntil(startTime, time); if (minutes) onChange(minutes); }}
          onClose={() => setOpen(false)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />,
        document.body,
      )}
    </>
  );
}
