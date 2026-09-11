import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, CalendarDays, Eclipse, Inbox, Layers, Maximize, Minimize, Monitor, Sparkles, Sunrise, Target, Thermometer, X, Timer, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import { getStoredWeatherCoords, getSunTimes } from '../utils/solar.js';
import { computeDayCompletion, computeDaylightBand, computeFocusSpans, dialPeakUv } from '../utils/dayDial.js';
import { acquireWakeLock, releaseWakeLock } from '../utils/wakeLock.js';
import { isNativeApp, nativeSetImmersiveMode } from '../native.js';
import { AMBIENT_DELAY_OPTIONS, loadAmbientPrefs, saveAmbientPrefs } from '../utils/dialPrefs.js';
import { HABIT_ICONS } from '../constants/habits.js';
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
const DEFAULT_LAYERS = { solar: true, weather: true, calendars: true, routines: true, focus: true };
const loadLayers = () => {
  try {
    return { ...DEFAULT_LAYERS, ...JSON.parse(localStorage.getItem(DIAL_LAYERS_KEY) || '{}') };
  } catch {
    return DEFAULT_LAYERS;
  }
};

// Complications — which readouts ride the face, in the order they were
// switched on (that order IS the slot order: top-left, top-right,
// bottom-left, bottom-right). Device-local like the layer toggles: a wall
// panel and a phone reasonably want different ones.
const DIAL_COMPLICATIONS_KEY = 'day-planner-dial-complications';
const MAX_COMPLICATIONS = 4;
const loadComplications = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(DIAL_COMPLICATIONS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((k) => typeof k === 'string') : [];
  } catch {
    return [];
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

const ToggleRow = ({ icon: Icon, label, on, onChange, disabled = false }) => (
  <button
    onClick={() => !disabled && onChange(!on)}
    role="switch"
    aria-checked={on}
    aria-disabled={disabled || undefined}
    className={`w-full flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
      disabled ? 'opacity-40 cursor-default' : 'hover:bg-white/5'}`}
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
    filteredUnscheduledTasks, getDeadlineTasksForDate,
  } = useDayPlannerCtx();
  const {
    getDayWindow, routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion,
    habitsEnabled, activeHabits, getTodayHabitCount, setHabitCount, incrementHabit,
    focusLog, focusModeAvailable, enterFocusMode,
  } = useFeaturesCtx();

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
  const handleToggleComplete = (block) => (block.isRoutine
    ? toggleRoutineCompletion(block.id)
    : toggleComplete(block.id));
  const handleOpenInPlanner = (block) => {
    setShowDayDial(false);
    // A routine lives on today's timeline only, and has no task to edit —
    // the planner just needs to be looking at its hour.
    if (block.isRoutine) {
      scrollToHour(`${String(Math.floor(block.startMin / 60)).padStart(2, '0')}:00`);
      return;
    }
    // A block carried over from last night is filed under that day, so the
    // planner has to land there — following it to the date it belongs to,
    // and to the hour it actually starts.
    const home = new Date(selectedDate);
    if (block.startedPrevDay) {
      home.setDate(home.getDate() - 1);
      setSelectedDate(home);
    }
    const task = getTasksForDate(home).find((t) => t.id === block.id);
    if (isMobile && task && block.completable) {
      openMobileEditTask(task, false);
    } else {
      const startMin = block.startedPrevDay ? block.startMinTrue : block.startMin;
      const hhmm = `${String(Math.floor(startMin / 60)).padStart(2, '0')}:00`;
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
    enterFullscreen().then(
      () => { ambientOwnedFullscreenRef.current = true; },
      () => {}, // no gesture (kiosk boot) or unsupported — ambient works anyway
    );
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
      exitFullscreen();
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
      enterFullscreen().then(
        () => { ambientOwnedFullscreenRef.current = true; },
        () => {},
      );
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
  //
  // focusin counts as activity: the corner buttons and the hub's day
  // chevrons stay in the tab order while faded, so a Tab that lands on one
  // — or the action sheet handing focus back to the ring — has to bring the
  // chrome back rather than leave a focused control invisible. It cannot
  // wake the display out of ambient (that needs a key, tap, or wheel on the
  // shield), so a programmatic focus never ends a screensaver.
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
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'focusin'];
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
  //
  // The native apps are different: neither WebView offers the Fullscreen API
  // (Android implements no onShowCustomView; iPhone WKWebView has none at
  // all), but both shells can hide the system chrome themselves through the
  // same setImmersiveMode bridge call — Android hides the status and nav
  // bars, iOS the status bar and home indicator (an iOS shell predating the
  // call no-ops harmlessly: the bar stays, as it always did). So there
  // "fullscreen" means immersive mode, tracked by hand because no
  // fullscreenchange event ever fires; a bonus is that the native call
  // needs no user gesture, so ambient auto-start truly hides the bars.
  const containerRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const nativeApp = isNativeApp();
  const nativeImmersiveRef = useRef(false);
  const fullscreenSupported = nativeApp ||
    (typeof document !== 'undefined' && !!document.fullscreenEnabled);
  // Current fullscreen truth, safe to read inside handlers where the
  // isFullscreen state could be stale.
  const inFullscreen = () =>
    (nativeApp ? nativeImmersiveRef.current : !!document.fullscreenElement);
  // Resolves when this call took the screen fullscreen; rejects when it
  // didn't (already fullscreen, unsupported, or no gesture on the web) so
  // callers can track ownership exactly as requestFullscreen() allows.
  const enterFullscreen = () => {
    if (inFullscreen()) return Promise.reject(new Error('already fullscreen'));
    if (nativeApp) {
      nativeSetImmersiveMode(true);
      nativeImmersiveRef.current = true;
      setIsFullscreen(true);
      return Promise.resolve();
    }
    if (containerRef.current?.requestFullscreen) {
      return containerRef.current.requestFullscreen();
    }
    return Promise.reject(new Error('fullscreen unsupported'));
  };
  const exitFullscreen = () => {
    if (nativeApp) {
      if (!nativeImmersiveRef.current) return;
      nativeSetImmersiveMode(false);
      nativeImmersiveRef.current = false;
      setIsFullscreen(false);
      return;
    }
    if (document.fullscreenElement) document.exitFullscreen()?.catch(() => {});
  };
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      // Leaving the dial leaves fullscreen too — the planner underneath
      // should come back exactly as it was.
      if (document.fullscreenElement) document.exitFullscreen()?.catch(() => {});
      if (nativeImmersiveRef.current) nativeSetImmersiveMode(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleFullscreen = () => {
    if (inFullscreen()) exitFullscreen();
    else enterFullscreen().catch(() => {});
  };

  // Focus containment. The dial is a fullscreen overlay laid over the whole
  // planner, which stays mounted underneath — so without a trap, Tab walks
  // hundreds of controls the user cannot see, and focus that has wandered
  // out there has no way back to the dial. Tab cycles the dial's own
  // controls instead, and a Tab arriving from outside pulls focus in, so
  // the overlay is always one press away however it was opened.
  //
  // Stands down for the block action sheet (aria-modal), which runs a
  // tighter trap of its own, and while ambient is up, where the first key
  // press exits rather than moves.
  useEffect(() => {
    if (ambient) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Tab') return;
      const root = containerRef.current;
      if (!root || root.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const items = Array.from(
        root.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.disabled);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.shiftKey
        ? (i <= 0 ? items.length - 1 : i - 1)
        : (i === -1 || i === items.length - 1 ? 0 : i + 1);
      items[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [ambient]);

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
        if (inFullscreen()) {
          exitFullscreen();
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
  const solar = useMemo(() => {
    if (!layers.solar) return null;
    const coords = getStoredWeatherCoords();
    return coords ? { coords, sun: getSunTimes(selectedDate, coords.lat, coords.lon) } : null;
  }, [selectedDate, layers.solar]);
  const sun = solar?.sun ?? null;

  // The daylight band. Its extent and shape are the local solar solution, so
  // it draws on any date and offline; the forecast's UV only scales it, on
  // the few days the forecast reaches. Deliberately NOT gated on the weather
  // layer: that toggle governs what the weather ring shows, while this is the
  // sun, and it belongs with the marks the solar layer already draws.
  const daylight = useMemo(() => (solar
    ? computeDaylightBand(selectedDate, solar.coords, solar.sun,
      dialPeakUv(weather?.hourlyByDate?.[dateStr]))
    : []),
  [solar, selectedDate, weather, dateStr]);

  // Calendars off hides calendar-imported events (Obsidian-imported tasks
  // are the user's own work and stay); totals and the ring follow together
  // since the same filtered list feeds computeDialModel.
  const applyLayers = (all) => (layers.calendars
    ? all
    : all.filter((t) => !(t.imported && t.importSource !== 'obsidian')));

  const dayTasks = useMemo(() => applyLayers(getTasksForDate(selectedDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getTasksForDate, selectedDate, layers.calendars]);

  // Yesterday's list, for the one thing the dial takes from it: a block that
  // ran past midnight still occupies this morning. Filtered through the same
  // layer toggles, so hiding calendar events hides their overrun too.
  const prevDayTasks = useMemo(() => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    return applyLayers(getTasksForDate(prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getTasksForDate, selectedDate, layers.calendars]);

  // Focus sessions for the day being drawn. The log is keyed by date, so
  // paging back shows the hours actually spent in focus on that day — but
  // only from the version that started recording spans, since the entries
  // before it kept totals without times.
  const focusSpans = useMemo(
    () => (layers.focus ? computeFocusSpans(focusLog, dateStr) : []),
    [layers.focus, focusLog, dateStr],
  );

  // Starting a session leaves the dial: focus mode is its own fullscreen
  // view, with its own wake lock and (on Android) its own notification.
  // enterFocusMode derives the block from NOW, which is why the dial only
  // offers the action on the block that is actually running.
  const handleStartFocus = () => {
    setShowDayDial(false);
    enterFocusMode();
  };

  // Complications. Each carries its own items, so the sheet that opens has
  // nothing left to fetch. The counts deliberately reuse the app's own
  // numbers rather than recomputing: the inbox count is the sidebar badge's
  // exact expression (filteredUnscheduledTasks already applies all six inbox
  // filters, sorted), and the deadline list is the same accessor the
  // planner's all-day area uses.
  const [complicationKeys, setComplicationKeys] = useState(loadComplications);
  const toggleComplication = (key) => setComplicationKeys((prev) => {
    const next = prev.includes(key)
      ? prev.filter((k) => k !== key)
      : [...prev, key].slice(0, MAX_COMPLICATIONS);
    try { localStorage.setItem(DIAL_COMPLICATIONS_KEY, JSON.stringify(next)); } catch { /* view pref only */ }
    return next;
  });

  const complicationsFull = complicationKeys.length >= MAX_COMPLICATIONS;

  const complications = useMemo(() => complicationKeys.map((key) => {
    if (key === 'inbox') {
      const items = (filteredUnscheduledTasks || []).filter((t) => !t.isExample);
      return { key, kind: 'inbox', count: items.length, items };
    }
    if (key === 'deadlines') {
      const items = getDeadlineTasksForDate(dateStr) || [];
      return { key, kind: 'deadlines', count: items.length, items };
    }
    if (key === 'done') {
      // Weighted by minutes, not by block count: this face is about time,
      // so a two-hour block counts for more than a fifteen-minute errand.
      return { key, kind: 'done', ...computeDayCompletion(dayTasks) };
    }
    const habit = (activeHabits || []).find((h) => `habit:${h.id}` === key);
    return habit
      ? { key, kind: 'habit', habit, count: getTodayHabitCount(habit.id) }
      : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  })
    // Some readouts only mean anything about today: the inbox is one global
    // list with no notion of a date, and a habit count is today's tally. The
    // rest are per-date and stay useful when the dial is paged back — the
    // deadline list is already fetched for the date on screen, and a day's
    // completion is a fact about that day.
    .filter((c) => c && (isToday || c.kind === 'done' || c.kind === 'deadlines')),
  [complicationKeys, filteredUnscheduledTasks, getDeadlineTasksForDate,
    dateStr, activeHabits, getTodayHabitCount, dayTasks, isToday]);

  // A complication row hands the task to the app's own editor — the same one
  // the planner opens — so a deadline or an inbox item can be given a date
  // without leaving for the planner first and without this surface inventing
  // a scheduling path of its own.
  const handleOpenTask = (task) => {
    setShowDayDial(false);
    openMobileEditTask(task, true);
  };

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
          with the now line (which wears the same orange). Top-left on every
          viewport: the earlier top-center narrow variant sat in the same
          band as the corner buttons and they overlapped. Narrow shrinks it
          a step so mark and buttons clear each other even on the smallest
          phones. The wide-viewport variant sits at top-12: on macOS
          Electron (titleBarStyle hiddenInset, traffic lights at y:8) the
          window controls own the top ~20px of this corner, and the mark
          must clear them. All the top chrome adds env(safe-area-inset-top):
          on the phones the dial underlaps the status bar / notch, and the
          inset collapses to 0 when fullscreen hides the bars (and on
          desktops, which never have one). */}
      <div className="absolute top-[calc(1.25rem+env(safe-area-inset-top,0px))] left-4 sm:top-[calc(3rem+env(safe-area-inset-top,0px))] sm:left-6 z-10 opacity-70 pointer-events-none">
        <Wordmark className="text-xl sm:text-2xl" darkMode dayClassName="text-white/60" />
      </div>
      <div className={`absolute top-[calc(1rem+env(safe-area-inset-top,0px))] right-4 z-10 flex items-center gap-1 ${chromeClass}`}>
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
        prevDayTasks={prevDayTasks}
        // Routines are a today-only construct (useRoutines rolls them at
        // midnight), so any other date gets none rather than a stale set.
        routines={layers.routines && routinesEnabled && isToday ? todayRoutines : null}
        routineCompletions={routineCompletions}
        focusSpans={focusSpans}
        onStartFocus={isToday && focusModeAvailable ? handleStartFocus : null}
        complications={complications}
        onOpenTask={handleOpenTask}
        onSetHabitCount={(habit, next) => setHabitCount(habit.id, next)}
        onIncrementHabit={(habit) => incrementHabit(habit.id)}
        dayWindow={getDayWindow(dateStr)}
        date={selectedDate}
        nowMin={nowMin}
        dayIsPast={dateStr < todayStr}
        formatTime={formatTime}
        use24HourClock={use24HourClock}
        sun={sun}
        daylight={daylight}
        hourlyWeather={layers.weather ? (weather?.hourlyByDate?.[dateStr] ?? null) : null}
        onToggleComplete={handleToggleComplete}
        onOpenInPlanner={handleOpenInPlanner}
        onStepDay={stepDay}
        onGoToday={() => setSelectedDate(new Date())}
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
            className="absolute top-[calc(4rem+env(safe-area-inset-top,0px))] right-4 w-60 rounded-2xl border border-white/10 bg-[#12151c] p-1.5 shadow-2xl"
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
            {routinesEnabled && (
              <ToggleRow
                icon={Sparkles}
                label={t('dial.routines', 'Routines')}
                on={layers.routines}
                onChange={(v) => setLayer('routines', v)}
              />
            )}
            <ToggleRow
              icon={Timer}
              label={t('dial.focus', 'Focus')}
              on={layers.focus}
              onChange={(v) => setLayer('focus', v)}
            />
            {/* Complications: four slots, filled in the order they are
                switched on. Only offered where the face has room for them —
                see COMPLICATION_MIN_DIAL_PX. */}
            <div className="my-1.5 border-t border-white/10" />
            <div className="px-3 pb-1 text-white/35 text-[11px] uppercase tracking-[0.14em]">
              {t('dial.complications', 'Complications')}
            </div>
            <ToggleRow
              icon={Inbox}
              label={t('dial.inbox', 'Inbox')}
              on={complicationKeys.includes('inbox')}
              disabled={complicationsFull && !complicationKeys.includes('inbox')}
              onChange={() => toggleComplication('inbox')}
            />
            <ToggleRow
              icon={CircleCheck}
              label={t('dial.done', 'Done')}
              on={complicationKeys.includes('done')}
              disabled={complicationsFull && !complicationKeys.includes('done')}
              onChange={() => toggleComplication('done')}
            />
            <ToggleRow
              icon={CalendarClock}
              label={t('dial.deadlines', 'Deadlines')}
              on={complicationKeys.includes('deadlines')}
              disabled={complicationsFull && !complicationKeys.includes('deadlines')}
              onChange={() => toggleComplication('deadlines')}
            />
            {habitsEnabled && (activeHabits || []).map((habit) => {
              const key = `habit:${habit.id}`;
              return (
                <ToggleRow
                  key={key}
                  icon={HABIT_ICONS[habit.icon] || Target}
                  label={habit.name}
                  on={complicationKeys.includes(key)}
                  disabled={complicationsFull && !complicationKeys.includes(key)}
                  onChange={() => toggleComplication(key)}
                />
              );
            })}

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
