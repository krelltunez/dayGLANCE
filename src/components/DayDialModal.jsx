import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import DayDial from './DayDial.jsx';

// Fullscreen ambient surface for the Day Dial ('O', or the header button).
// Shows the viewed day; the now line and hub narration only exist when that
// day is today — another date renders as a quiet, static schedule shape.
// Always the dark instrument look regardless of app theme (see DayDial.jsx).
const DayDialModal = () => {
  const { t } = useTranslation();
  const {
    selectedDate, setSelectedDate, setShowDayDial,
    getTasksForDate, currentTime, formatTime, use24HourClock,
  } = useDayPlannerCtx();
  const { getDayWindow } = useFeaturesCtx();

  // Always one day per keypress — changeDate() pages by visible columns,
  // which is right for the grid but jarring on a single-day dial.
  const stepDay = (delta) => setSelectedDate((prev) => {
    const next = new Date(prev);
    next.setDate(next.getDate() + delta);
    return next;
  });

  const dateStr = dateToString(selectedDate);
  const isToday = dateStr === dateToString(new Date());
  const nowMin = isToday ? currentTime.getHours() * 60 + currentTime.getMinutes() : null;

  // Own key handling: the global shortcut map is suspended while a modal is
  // open, and the dial should still page across days from the couch.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowDayDial(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepDay(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepDay(1);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[70] bg-[#0b0d12] flex flex-col p-[3vmin]">
      <button
        onClick={() => setShowDayDial(false)}
        className="absolute top-4 right-4 z-10 p-2 text-white/30 hover:text-white/80 transition-colors"
        title={t('dial.close', 'Close day dial (Esc)')}
        aria-label={t('dial.close', 'Close day dial (Esc)')}
      >
        <X size={24} />
      </button>
      <DayDial
        dayTasks={getTasksForDate(selectedDate)}
        dayWindow={getDayWindow(dateStr)}
        date={selectedDate}
        nowMin={nowMin}
        formatTime={formatTime}
        use24HourClock={use24HourClock}
      />
    </div>
  );
};

export default DayDialModal;
