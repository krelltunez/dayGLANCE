import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Eclipse, Layers, Maximize, Minimize, Monitor, Sunrise, Thermometer, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { getStoredWeatherCoords, getSunTimes } from '../utils/solar.js';
import { acquireWakeLock, releaseWakeLock } from '../utils/wakeLock.js';
import { AMBIENT_DELAY_OPTIONS, loadAmbientPrefs, saveAmbientPrefs } from '../utils/dialPrefs.js';
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

// Layer visibility — a device-local view preference (same class as the
// summary strip's collapse state): a wall panel and a phone reasonably want
// different layers, so this deliberately does not ride the sync payload.
const DIAL_LAYERS_KEY = 'day-planner-dial-layers';
const DEFAULT_LAYERS = { solar: true, weather: true, calendars: true };
const loadLayers = () => {
  try {
    return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem(DIAL_LAYERS_KEY) || '{}') };
  } catch {
    return DEFAULT_LAYERS;
  }
};

// Burn-in guard: while ambient, the whole face drifts through this pixel
// orbit — one step a minute, eased over seconds, imperceptible in the room
// but enough that no tick, label, or hub glyph parks on one OLED pixel.
// The backdrop is a uniform color, so only the content needs to move.
const AMBIENT_ORBIT = [
  [0, 0], [7, 4], [9, -3], [3, -8], [-5, -6], [-9, 0], [-6, 6], [1, 8],
];
const AMBIENT_ORBIT_STEP_MS = 60_000;

const ToggleRow = ({ icon: Icon, label, on, onChange }) => (
  <button
    onClick={() => onChange(!on)}
    role="switch"
    aria-checked={on}
    className="w-full flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/5 transition-colors"
  >
    <Icon size={16} className="text-white/50 flex-shrink-0" />
    <span className="flex-1 text-left text-white/85 text-sm">{label}</span>
    <span className={`relative w-9 h-5 flex-shrink-0 rounded-full transition-colors ${on ? 'bg-[#fe8b00]/70' : 'bg-white/10'}`}>
      <span className={`absolute top-0.5 left-0 w-4 h-4 rounded-full bg-white transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </span>
  </button>
);

const DayDialModal = () => {
  const { t } = useTranslation();
  const {
    selectedDate, setSelectedDate, showDayDial, setShowDayDial,
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

  // Ambient mode — the dial as a screensaver, semantics carried over from
  // lifeGLANCE's watch mode: enter by gesture (button, 'A', or booting with
  // ?dial&ambient for kiosks), go fullscreen and hold a screen wake lock;
  // any DELIBERATE input — tap, click, key, wheel — exits, while a passive
  // drifting cursor does not; a 1s start guard keeps the initiating gesture
  // from immediately cancelling. An invisible shield captures the exiting
  // tap so it can't also land on a wedge. Exiting leaves fullscreen only if
  // ambient entered it.
  const [ambient, setAmbient] = useState(() =>
    showDayDial === 'ambient' ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location?.search ?? '').has('ambient')));
  const ambientGuardRef = useRef(false);
  const ambientOwnedFullscreenRef = useRef(false);
  // True screensaver semantics: ambient that the planner's idle watcher
  // started (showDayDial === 'ambient' — its only source) wakes back to the
  // planner; ambient entered from the dial (or a ?dial&ambient kiosk boot,
  // which arrives as boolean true) wakes back to the dial.
  const ambientFromPlannerRef = useRef(showDayDial === 'ambient');
  const enterAmbient = () => {
    if (ambient) return;
    setSelectedDate(new Date());
    setShowLayers(false);
    setAmbient(true);
    ambientGuardRef.current = true;
    setTimeout(() => { ambientGuardRef.current = false; }, 1000);
    acquireWakeLock();
    if (!document.fullscreenElement && containerRef.current?.requestFullscreen) {
      containerRef.current.requestFullscreen().then(
        () => { ambientOwnedFullscreenRef.current = true; },
        () => {}, // no gesture (kiosk boot) or unsupported — ambient works anyway
      );
    }
  };
  const exitAmbient = () => {
    if (ambientGuardRef.current) return;
    if (ambientFromPlannerRef.current) {
      // Wake back to the planner: closing the dial unmounts us, and the
      // mount/fullscreen cleanups release the wake lock and fullscreen.
      ambientFromPlannerRef.current = false;
      setShowDayDial(false);
      return;
    }
    setAmbient(false);
    releaseWakeLock();
    if (ambientOwnedFullscreenRef.current) {
      ambientOwnedFullscreenRef.current = false;
      if (document.fullscreenElement) document.exitFullscreen()?.catch(() => {});
    }
  };
  // Boot straight into ambient (?dial&ambient, or the planner screensaver
  // opening us with showDayDial === 'ambient'): jump to today, hold the wake
  // lock (needs no gesture), and attempt fullscreen — Electron grants it
  // without a gesture, the web denies it silently, and kiosk browsers launch
  // fullscreen themselves. Release everything on unmount.
  useEffect(() => {
    if (ambient) {
      setSelectedDate(new Date());
      acquireWakeLock();
      if (!document.fullscreenElement && containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen().then(
          () => { ambientOwnedFullscreenRef.current = true; },
          () => {},
        );
      }
    }
    return () => releaseWakeLock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Burn-in guard: step through the pixel orbit while ambient; glide back
  // to center on exit.
  const [orbitIdx, setOrbitIdx] = useState(0);
  useEffect(() => {
    if (!ambient) { setOrbitIdx(0); return undefined; }
    const interval = setInterval(
      () => setOrbitIdx((i) => (i + 1) % AMBIENT_ORBIT.length),
      AMBIENT_ORBIT_STEP_MS,
    );
    return () => clearInterval(interval);
  }, [ambient]);
  const [orbitX, orbitY] = ambient ? AMBIENT_ORBIT[orbitIdx] : [0, 0];
  // Auto-start (opt-in, configurable delay): rides the same activity clock
  // as idle-return and the same 15s tick — no timer of its own. Activity
  // resets it implicitly because lastActiveRef is stamped by the chrome
  // wake listener; hidden tabs never auto-start (lifeGLANCE's rule).
  const [ambientPrefs, setAmbientPrefs] = useState(loadAmbientPrefs);
  const setAmbientPref = (key, value) => setAmbientPrefs((prev) => {
    const next = { ...prev, [key]: value };
    saveAmbientPrefs(next);
    return next;
  });
  useEffect(() => {
    if (!ambientPrefs.auto || ambient) return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastActiveRef.current >= ambientPrefs.delayMin * 60_000) {
      enterAmbient();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, ambientPrefs.auto, ambientPrefs.delayMin, ambient]);

  // Any key exits ambient (swallowed — the first press only wakes).
  useEffect(() => {
    if (!ambient) return undefined;
    const onKeyDown = (e) => {
      if (ambientGuardRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      exitAmbient();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ambient]);

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
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel'];
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
      } else if (e.key === 'a') {
        e.preventDefault();
        enterAmbient();
      } else if (e.key === 'l') {
        e.preventDefault();
        setShowLayers((v) => !v);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Layer toggles: solar marks, weather ring, imported calendar events.
  // Persisted per device; the panel opens from the Layers chrome button.
  const [layers, setLayers] = useState(loadLayers);
  const [showLayers, setShowLayers] = useState(false);
  const setLayer = (key, value) => setLayers((prev) => {
    const next = { ...prev, [key]: value };
    try { localStorage.setItem(DIAL_LAYERS_KEY, JSON.stringify(next)); } catch { /* view pref only */ }
    return next;
  });
  // Esc closes the panel before the dial (capture phase, same pattern as
  // the block action sheet).
  useEffect(() => {
    if (!showLayers) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setShowLayers(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [showLayers]);

  // Solar layer: sunrise/sunset computed locally from the weather feature's
  // persisted geocode (utils/solar.js) — any date, works offline. No
  // location ever configured → null → the layer doesn't render.
  const sun = useMemo(() => {
    if (!layers.solar) return null;
    const coords = getStoredWeatherCoords();
    return coords ? getSunTimes(selectedDate, coords.lat, coords.lon) : null;
  }, [selectedDate, layers.solar]);

  // Calendars off hides calendar-imported events (Obsidian-imported tasks
  // are the user's own work and stay); totals and the ring follow together
  // since the same filtered list feeds computeDialModel.
  const dayTasks = useMemo(() => {
    const all = getTasksForDate(selectedDate);
    return layers.calendars
      ? all
      : all.filter((t) => !(t.imported && t.importSource !== 'obsidian'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getTasksForDate, selectedDate, layers.calendars]);

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

  // Ambient suppresses the chrome outright — no buttons, no cursor, no
  // chevrons; the shield handles every way out.
  const chromeShown = chromeVisible && !ambient;
  const chromeClass = `transition-opacity duration-500 ${
    chromeShown ? 'opacity-100' : 'opacity-0 pointer-events-none'}`;

  return (
    <div
      ref={containerRef}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      className={`fixed inset-0 z-[70] bg-[#0b0d12] ${
        chromeShown ? '' : 'cursor-none'}`}
    >
      {/* Everything but the shield rides the burn-in orbit; the uniform
          backdrop stays put (a solid color can't burn), so the drift never
          exposes an edge. */}
      <div
        className="absolute inset-0 flex flex-col p-[3vmin]"
        style={{
          transform: `translate(${orbitX}px, ${orbitY}px)`,
          transition: 'transform 5s ease-in-out',
        }}
      >
      {/* Maker's mark — a watch face carries its brand, so this stays put
          while the interactive chrome fades; muted so it never competes
          with the now line (which wears the same orange). Top-left, except
          top-center on narrow viewports where the corners crowd the dial. */}
      <div className="absolute top-5 left-1/2 -translate-x-1/2 sm:left-6 sm:translate-x-0 z-10 opacity-70 pointer-events-none">
        <Wordmark className="text-2xl" darkMode dayClassName="text-white/60" />
      </div>
      <div className={`absolute top-4 right-4 z-10 flex items-center gap-1 ${chromeClass}`}>
        <button
          onClick={enterAmbient}
          className="p-2 text-white/30 hover:text-white/80 transition-colors"
          title={t('dial.ambient', 'Ambient mode (A) — tap anywhere to exit')}
          aria-label={t('dial.ambient', 'Ambient mode (A) — tap anywhere to exit')}
        >
          <Eclipse size={22} />
        </button>
        <button
          onClick={() => setShowLayers((v) => !v)}
          className="p-2 text-white/30 hover:text-white/80 transition-colors"
          title={t('dial.layersKey', 'Layers (L)')}
          aria-label={t('dial.layersKey', 'Layers (L)')}
        >
          <Layers size={22} />
        </button>
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
        dayTasks={dayTasks}
        dayWindow={getDayWindow(dateStr)}
        date={selectedDate}
        nowMin={nowMin}
        dayIsPast={dateStr < todayStr}
        formatTime={formatTime}
        use24HourClock={use24HourClock}
        sun={sun}
        hourlyWeather={layers.weather ? (weather?.hourlyByDate?.[dateStr] ?? null) : null}
        onToggleComplete={handleToggleComplete}
        onOpenInPlanner={handleOpenInPlanner}
        onStepDay={stepDay}
        chromeVisible={chromeShown}
      />

      {/* Layers panel — same register as the block action sheet. Ambient
          layers stay honest either way: a toggle hides a layer, it never
          fakes one. */}
      {showLayers && (
        <div className="absolute inset-0 z-20" onClick={() => setShowLayers(false)}>
          <div
            role="dialog"
            aria-label={t('dial.layers', 'Layers')}
            className="absolute top-16 right-4 w-60 rounded-2xl border border-white/10 bg-[#12151c] p-1.5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ToggleRow
              icon={Sunrise}
              label={t('dial.layerSolar', 'Sunrise & sunset')}
              on={layers.solar}
              onChange={(v) => setLayer('solar', v)}
            />
            <ToggleRow
              icon={Thermometer}
              label={t('dial.layerWeather', 'Weather')}
              on={layers.weather}
              onChange={(v) => setLayer('weather', v)}
            />
            <ToggleRow
              icon={CalendarDays}
              label={t('dial.layerCalendars', 'Calendar events')}
              on={layers.calendars}
              onChange={(v) => setLayer('calendars', v)}
            />
            <div className="my-1.5 border-t border-white/10" />
            <ToggleRow
              icon={Eclipse}
              label={t('dial.autoAmbient', 'Auto ambient')}
              on={ambientPrefs.auto}
              onChange={(v) => setAmbientPref('auto', v)}
            />
            {ambientPrefs.auto && (
              <>
                <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-0.5">
                  <span className="text-white/40 text-xs flex-1">
                    {t('dial.autoAmbientAfter', 'after idle')}
                  </span>
                  {AMBIENT_DELAY_OPTIONS.map((m) => (
                    <button
                      key={m}
                      onClick={() => setAmbientPref('delayMin', m)}
                      className={`px-2 py-1 rounded-md text-xs transition-colors ${
                        ambientPrefs.delayMin === m
                          ? 'bg-[#fe8b00]/70 text-white'
                          : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                    >
                      {m}m
                    </button>
                  ))}
                </div>
                <ToggleRow
                  icon={Monitor}
                  label={t('dial.ambientFromPlanner', 'Also start from planner')}
                  on={ambientPrefs.fromPlanner}
                  onChange={(v) => setAmbientPref('fromPlanner', v)}
                />
              </>
            )}
          </div>
        </div>
      )}
      </div>

      {/* Ambient shield — screensaver glass. Catches the exiting tap so it
          can't also land on a wedge; a drifting cursor passes over it
          without consequence. */}
      {ambient && (
        <div
          className="absolute inset-0 z-30 cursor-none"
          onPointerDown={exitAmbient}
          onWheel={exitAmbient}
        />
      )}
    </div>
  );
};

export default DayDialModal;
