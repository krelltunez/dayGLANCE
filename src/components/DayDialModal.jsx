import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minimize, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { getStoredWeatherCoords, getSunTimes } from '../utils/solar.js';
import DayDial from './DayDial.jsx';
import Wordmark from './Wordmark.jsx';

// Fullscreen ambient surface for the Day Dial ('O', the header button, or
// booting with ?dial). Shows the viewed day; the now line and hub narration
// only exist when that day is today — another date renders as a quiet,
// static schedule shape. Always the dark instrument look regardless of app
// theme (see DayDial.jsx).
//
// Ambient idle behaviors, all keyed off one activity timestamp:
//  - chrome (cursor + corner buttons) fades after a few seconds still, so a
//    wall panel shows only the instrument;
//  - a browsed non-today date snaps back to today after a few idle minutes,
//    so a passerby's curiosity never strands the display in the past.

// Cursor/buttons fade after this much stillness.
const CHROME_HIDE_MS = 5_000;
// A browsed date returns to today after this much inactivity.
const IDLE_RETURN_MS = 5 * 60_000;

const DayDialModal = () => {
  const { t } = useTranslation();
  const {
    selectedDate, setSelectedDate, setShowDayDial,
    getTasksForDate, currentTime, formatTime, use24HourClock,
    weather,
    toggleComplete, openMobileEditTask, scrollToHour, isMobile,
  } = useDayPlannerCtx();
  const { getDayWindow } = useFeaturesCtx();

  // Always one day per keypress — changeDate() pages by visible columns,
  // which is right for the grid but jarring on a single-day dial.
  const stepDay = (delta) => setSelectedDate((prev) => {
    const next = new Date(prev);
    next.setDate(next.getDate() + delta);
    return next;
  });

  // Action-sheet callbacks. Completing stays in the dial (the wedge dims to
  // the past tier as live feedback); "open in planner" is the deliberate
  // exit ramp — close the dial (the planner is already on this date) and
  // hand off: the mobile edit sheet on touch layouts, a scroll to the
  // block's hour on desktop. toggleComplete understands recurring-instance
  // ids natively.
  const handleToggleComplete = (block) => toggleComplete(block.id);
  const handleOpenInPlanner = (block) => {
    setShowDayDial(false);
    const task = getTasksForDate(selectedDate).find((t) => t.id === block.id);
    if (isMobile && task && block.completable) {
      openMobileEditTask(task, false);
    } else {
      const hhmm = `${String(Math.floor(block.startMin / 60)).padStart(2, '0')}:00`;
      scrollToHour(hhmm);
    }
  };

  const dateStr = dateToString(selectedDate);
  const todayStr = dateToString(currentTime);
  const isToday = dateStr === todayStr;
  const nowMin = isToday ? currentTime.getHours() * 60 + currentTime.getMinutes() : null;

  // Kiosk longevity: when midnight passes while the dial is showing today,
  // follow to the new today — a wall panel must never quietly become a
  // yesterday view. Only the today view follows; a deliberately browsed
  // other day stays put (until the idle return below reclaims it). Rides
  // the existing minute tick (currentTime), so no extra timer.
  const prevTodayRef = useRef(todayStr);
  useEffect(() => {
    if (prevTodayRef.current === todayStr) return;
    if (dateStr === prevTodayRef.current) setSelectedDate(new Date(currentTime));
    prevTodayRef.current = todayStr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStr]);

  // One activity clock for both idle behaviors. chromeVisible drives the
  // cursor and corner buttons; lastActiveRef drives the return-to-today
  // check, which rides the minute tick rather than owning a timer.
  const [chromeVisible, setChromeVisible] = useState(true);
  const lastActiveRef = useRef(Date.now());
  useEffect(() => {
    let hideTimer;
    const wake = () => {
      lastActiveRef.current = Date.now();
      setChromeVisible(true);
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => setChromeVisible(false), CHROME_HIDE_MS);
    };
    wake();
    const events = ['pointermove', 'pointerdown', 'keydown'];
    events.forEach((ev) => document.addEventListener(ev, wake));
    return () => {
      clearTimeout(hideTimer);
      events.forEach((ev) => document.removeEventListener(ev, wake));
    };
  }, []);

  useEffect(() => {
    if (isToday) return;
    if (Date.now() - lastActiveRef.current >= IDLE_RETURN_MS) {
      setSelectedDate(new Date(currentTime));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, isToday]);

  // HTML5 fullscreen on the overlay element ('F' or the corner button; both
  // are user gestures, which requestFullscreen requires — so ?dial cannot
  // auto-fullscreen, and true kiosks launch the browser fullscreen instead).
  // Unsupported environments (e.g. iPhone Safari) just don't get the button.
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSupported = typeof document !== 'undefined' && !!document.fullscreenEnabled;
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      // Leaving the dial leaves fullscreen too — the planner underneath
      // should come back exactly as it was.
      if (document.fullscreenElement) document.exitFullscreen()?.catch(() => {});
    };
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()?.catch(() => {});
    else containerRef.current?.requestFullscreen()?.catch(() => {});
  };

  // Own key handling: the global shortcut map is suspended while a modal is
  // open, and the dial should still page across days from the couch.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        // Two-step exit: first Esc leaves fullscreen (explicitly — Electron
        // and headless runners don't reliably do it for us; where the
        // browser already exited on its own, fullscreenElement is simply
        // null and this press closes the dial), the next closes the dial.
        if (document.fullscreenElement) {
          document.exitFullscreen()?.catch(() => {});
          return;
        }
        setShowDayDial(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepDay(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepDay(1);
      } else if (e.key === 't') {
        e.preventDefault();
        setSelectedDate(new Date());
      } else if (e.key === 'f') {
        e.preventDefault();
        toggleFullscreen();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Solar layer: sunrise/sunset computed locally from the weather feature's
  // persisted geocode (utils/solar.js) — any date, works offline. No
  // location ever configured → null → the layer doesn't render.
  const sun = useMemo(() => {
    const coords = getStoredWeatherCoords();
    return coords ? getSunTimes(selectedDate, coords.lat, coords.lon) : null;
  }, [selectedDate]);

  // Touch paging — the couch has arrow keys, a phone or wall tablet doesn't.
  // A decisively horizontal swipe pages one day; anything vertical-ish is
  // ignored rather than misread.
  const touchStartRef = useRef(null);
  const onTouchStart = (e) => {
    if (e.touches.length !== 1) { touchStartRef.current = null; return; }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    stepDay(dx < 0 ? 1 : -1);
  };

  const chromeClass = `transition-opacity duration-500 ${
    chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`;

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={`fixed inset-0 z-[70] bg-[#0b0d12] flex flex-col p-[3vmin] ${
        chromeVisible ? '' : 'cursor-none'}`}
    >
      {/* Maker's mark — a watch face carries its brand, so this stays put
          while the interactive chrome fades; muted so it never competes
          with the now line (which wears the same orange). Top-left, except
          top-center on narrow viewports where the corners crowd the dial. */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 sm:left-6 sm:translate-x-0 z-10 opacity-70 pointer-events-none">
        <Wordmark className="text-2xl" darkMode dayClassName="text-white/60" />
      </div>
      <div className={`absolute top-4 right-4 z-10 flex items-center gap-1 ${chromeClass}`}>
        {fullscreenSupported && (
          <button
            onClick={toggleFullscreen}
            className="p-2 text-white/30 hover:text-white/80 transition-colors"
            title={isFullscreen
              ? t('dial.exitFullscreen', 'Exit full screen (F)')
              : t('dial.enterFullscreen', 'Full screen (F)')}
            aria-label={isFullscreen
              ? t('dial.exitFullscreen', 'Exit full screen (F)')
              : t('dial.enterFullscreen', 'Full screen (F)')}
          >
            {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
          </button>
        )}
        <button
          onClick={() => setShowDayDial(false)}
          className="p-2 text-white/30 hover:text-white/80 transition-colors"
          title={t('dial.close', 'Close day dial (Esc)')}
          aria-label={t('dial.close', 'Close day dial (Esc)')}
        >
          <X size={24} />
        </button>
      </div>
      <DayDial
        dayTasks={getTasksForDate(selectedDate)}
        dayWindow={getDayWindow(dateStr)}
        date={selectedDate}
        nowMin={nowMin}
        dayIsPast={dateStr < todayStr}
        formatTime={formatTime}
        use24HourClock={use24HourClock}
        sun={sun}
        hourlyWeather={weather?.hourlyByDate?.[dateStr] ?? null}
        onToggleComplete={handleToggleComplete}
        onOpenInPlanner={handleOpenInPlanner}
        onStepDay={stepDay}
        chromeVisible={chromeVisible}
      />
    </div>
  );
};

export default DayDialModal;
