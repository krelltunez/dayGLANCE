import { useState, useRef, useEffect } from 'react';
// The bare singleton, not ../i18n.js: that module boots the language detector
// as an import side effect, which node-side tests must not inherit. main.jsx
// imports it before anything fires, so t() is always initialized at runtime.
import i18n from 'i18next';
import { dateToString, stripWikilinks } from '../utils/taskUtils.js';
import { formatDuration } from '../utils/formatDuration.js';
import { isNativeAndroid, isNativeApp, nativeShowNotification, nativeShowTaskNotification, nativeSyncReminders } from '../native.js';

// The tray popup runs the same App tree — skip the reminder engine there so
// sounds and notifications don't fire twice (once per renderer process).
import { isTrayMode } from '../utils/trayMode.js';
import { writeItem } from '../utils/storageWrites.js';

// Pure local helpers
const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const minutesToTime = (minutes) => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
};

// Notification/toast text, localized at fire (or native-schedule) time rather
// than hardcoded English. Pre-scheduled native bodies re-bake after a language
// switch, since the scheduling effect below re-runs and nativeSyncReminders
// replaces the pending set.
const REMINDER_TYPES = ['before15', 'before10', 'before5', 'start', 'end', 'morning'];

// Longer lead times (#2249): 30 minutes to 12 hours before the start, each a
// category setting `ahead<minutes>` and a reminder type of the same name. A
// lead past midnight lands the day before the task, so the engine reads
// today's and tomorrow's tasks (reminderPointsToday). These reminders are
// early notice: they offer no Snooze, which on every platform pushes the task
// itself 15 minutes later (useless hours ahead). The native sides tell them
// apart by the `ahead` prefix (nativeReminderActions.test.js).
export const LEAD_AHEAD_MINUTES = Object.freeze([30, 60, 120, 240, 480, 720]);
export const isAheadReminder = (type) => typeof type === 'string' && type.startsWith('ahead');

export const reminderMessage = (type) => {
  if (isAheadReminder(type)) {
    return i18n.t('reminders.startsIn', { duration: formatDuration(Number(type.slice('ahead'.length)), i18n.t.bind(i18n)) });
  }
  return i18n.t(REMINDER_TYPES.includes(type) ? `reminders.${type}` : 'reminders.fallback');
};
const hgUpNextBody = (session, minutes) =>
  session.taskCount > 0
    ? i18n.t('reminders.hgUpNextWithTasks', { title: session.title, count: session.taskCount, minutes })
    : i18n.t('reminders.hgUpNext', { title: session.title, minutes });

const getTaskCategory = (task) => {
  if (task.isAllDay) return 'allDayTasks';
  if (typeof task.id === 'string' && task.id.startsWith('recurring-')) return 'recurringTasks';
  if (task.imported && task.isTaskCalendar) return 'calendarTasks';
  if (task.imported && !task.isTaskCalendar) return 'calendarEvents';
  return 'scheduledTasks';
};

const getReminderPoints = (task, catSettings, morningTime) => {
  if (!catSettings) return [];
  if (task.isAllDay) {
    if (!catSettings.morningReminder) return [];
    const [h, m] = morningTime.split(':').map(Number);
    return [{ key: `morning-${task.id}`, triggerMin: h * 60 + m, type: 'morning' }];
  }
  const startMin = timeToMinutes(task.startTime);
  const endMin = startMin + (task.duration || 0);
  const points = [];
  for (const minutes of LEAD_AHEAD_MINUTES) {
    if (catSettings[`ahead${minutes}`]) points.push({ key: `a${minutes}-${task.id}`, triggerMin: startMin - minutes, type: `ahead${minutes}` });
  }
  if (catSettings.before15) points.push({ key: `b15-${task.id}`, triggerMin: startMin - 15, type: 'before15' });
  if (catSettings.before10) points.push({ key: `b10-${task.id}`, triggerMin: startMin - 10, type: 'before10' });
  if (catSettings.before5) points.push({ key: `b5-${task.id}`, triggerMin: startMin - 5, type: 'before5' });
  if (catSettings.atStart) points.push({ key: `start-${task.id}`, triggerMin: startMin, type: 'start' });
  if (catSettings.atEnd) points.push({ key: `end-${task.id}`, triggerMin: endMin, type: 'end' });
  return points;
};

/**
 * Every reminder that lands today, from today's tasks and tomorrow's (a lead
 * past midnight lands the evening before), each as the minute of today it
 * fires at. Before a task, it is measured from the task's own day: a point
 * before midnight belongs to the day before, after it to the day after, so
 * one never fires twice. Completed tasks remind of nothing.
 *
 * @returns {Array<{ key: string, type: string, minute: number, task: object }>}
 */
export function reminderPointsToday({ todayTasks = [], tomorrowTasks = [], reminderSettings }) {
  const out = [];
  const add = (task, dayOffset) => {
    if (task.completed) return;
    const catSettings = reminderSettings?.categories?.[getTaskCategory(task)];
    if (!catSettings) return;
    for (const point of getReminderPoints(task, catSettings, reminderSettings.morningReminderTime)) {
      const minute = point.triggerMin + dayOffset * 1440;
      if (minute >= 0 && minute < 1440) out.push({ key: point.key, type: point.type, minute, task });
    }
  };
  todayTasks.forEach((task) => add(task, 0));
  tomorrowTasks.forEach((task) => add(task, 1));
  return out;
}

const tomorrowOf = (date) => {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  return dateToString(d);
};

export default function useReminderEngine({
  currentTime,
  reminderSettings,
  tasks,
  expandedRecurringTasks,
  hgSessions = [],
  isVisibleForUser = () => true,
  playUISound,
  pushUndo,
  setTasks,
  setRecurringTasks,
  parseRecurringId,
  setShowWeeklyReviewReminder,
  weeklyReviewDismissedRef,
  lastWeeklyReviewFiredRef,
}) {
  const [activeReminders, setActiveReminders] = useState([]);
  // Bumped on languageChanged so the native-scheduling effect below re-runs
  // and re-bakes every pending notification body in the new language. The
  // live-fire effect needs no equivalent: it localizes at fire time.
  const [langEpoch, setLangEpoch] = useState(0);
  useEffect(() => {
    const bump = () => setLangEpoch(e => e + 1);
    i18n.on('languageChanged', bump);
    return () => i18n.off('languageChanged', bump);
  }, []);
  const firedRemindersRef = useRef(new Set());
  const lastReminderDateRef = useRef((() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })());

  // Reminder notification engine
  useEffect(() => {
    if (isTrayMode) return;
    // Weekly review notification (independent of main reminder toggle)
    const wr = reminderSettings.weeklyReview;
    if (wr?.enabled) {
      const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
      const [wrH, wrM] = wr.time.split(':').map(Number);
      const wrMin = wrH * 60 + wrM;
      const endMin = 23 * 60 + 55; // 11:55 PM (before daily auto-refresh)
      if (currentTime.getDay() === wr.day && nowMin >= wrMin && nowMin < endMin) {
        // Compute ISO week string to prevent re-firing sound/notification
        const d = new Date(currentTime);
        d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
        const isoWeek = `${d.getFullYear()}-W${String(Math.ceil((((d - new Date(d.getFullYear(), 0, 4)) / 86400000) + 1) / 7)).padStart(2, '0')}`;
        // Show persistent reminder for the rest of the day (unless dismissed this week)
        if (weeklyReviewDismissedRef.current !== isoWeek) {
          setShowWeeklyReviewReminder(true);
        }
        // Play sound + browser notification only on initial fire
        if (lastWeeklyReviewFiredRef.current !== isoWeek) {
          lastWeeklyReviewFiredRef.current = isoWeek;
          writeItem('day-planner-weekly-review-fired', isoWeek);
          playUISound('reminder');
          if (reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            if (window.electronAPI?.isElectron) {
              try { new Notification('dayGLANCE', { body: i18n.t('reminders.weeklyReview') }); } catch {}
            } else {
              try {
                navigator.serviceWorker?.ready.then(reg => {
                  reg.showNotification('dayGLANCE', { body: i18n.t('reminders.weeklyReview'), icon: '/icon-192.png', tag: 'weekly-review' });
                });
              } catch {}
            }
          }
        }
      } else {
        setShowWeeklyReviewReminder(false);
      }
    } else {
      setShowWeeklyReviewReminder(false);
    }

    // ── hyperGLANCE session notifications ─────────────────────────────────────
    // Independent of the global enabled toggle (same pattern as Weekly Review).
    const hgNotifEnabled = reminderSettings.hyperGlance?.enabled !== false;
    if (hgNotifEnabled && hgSessions.length > 0) {
      const upNextMinutes = reminderSettings.hyperGlance?.upNextMinutes ?? 10;
      const nowMinHG = currentTime.getHours() * 60 + currentTime.getMinutes();
      const todayStrHG = dateToString(currentTime);
      const hgFires = [];

      for (const session of hgSessions) {
        if (session.date !== todayStrHG) continue;

        // "Up next" — fires upNextMinutes before session start
        if (upNextMinutes > 0) {
          const upNextKey = `hg-upnext-${session.id}-${session.date}`;
          const triggerMin = session.startMinutes - upNextMinutes;
          if (!firedRemindersRef.current.has(upNextKey) && triggerMin >= 0 &&
              nowMinHG >= triggerMin && nowMinHG < triggerMin + 2) {
            firedRemindersRef.current.add(upNextKey);
            hgFires.push({
              title: 'hyperGLANCE',
              body: hgUpNextBody(session, upNextMinutes),
              tag: `hg-session-${session.id}`,
            });
          }
        }

        // "Session start" — fires at the scheduled start time
        const startKey = `hg-start-${session.id}-${session.date}`;
        if (!firedRemindersRef.current.has(startKey) &&
            nowMinHG >= session.startMinutes && nowMinHG < session.startMinutes + 2) {
          firedRemindersRef.current.add(startKey);
          hgFires.push({
            title: 'hyperGLANCE',
            body: i18n.t('reminders.hgStartingNow', { title: session.title }),
            tag: `hg-session-${session.id}`,
          });
        }
      }

      if (hgFires.length > 0) {
        playUISound('reminder');
        if (window.electronAPI?.isElectron) window.electronAPI.setTrayIndicator(true);
        // Native apps: bridge already fires showTaskNotification (with Snooze) — don't duplicate.
        if (!isNativeApp() && reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          if (window.electronAPI?.isElectron) {
            for (const { title, body } of hgFires) {
              try { new Notification(title, { body }); } catch {}
            }
          } else {
            navigator.serviceWorker?.ready.then(reg => {
              for (const { title, body, tag } of hgFires) {
                try { reg.showNotification(title, { body, icon: '/icon-192.png', tag }); } catch {}
              }
            });
          }
        }
      }
    }

    if (!reminderSettings.enabled) return;
    const todayStr = dateToString(currentTime);
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();

    // Reset fired reminders at midnight
    if (lastReminderDateRef.current !== todayStr) {
      firedRemindersRef.current = new Set();
      lastReminderDateRef.current = todayStr;
    }

    // Today's tasks, and tomorrow's for a lead that lands this evening.
    const onDay = (dateStr) => [
      ...tasks.filter(t => t.date === dateStr && isVisibleForUser(t)),
      ...expandedRecurringTasks.filter(t => t.date === dateStr && isVisibleForUser(t)),
    ];
    const points = reminderPointsToday({
      todayTasks: onDay(todayStr), tomorrowTasks: onDay(tomorrowOf(currentTime)), reminderSettings,
    });

    const newReminders = [];
    for (const { task, ...point } of points) {
      if (firedRemindersRef.current.has(point.key)) continue;
      // Fire if current time is within a 2-minute window of the trigger
      if (nowMin >= point.minute && nowMin < point.minute + 2) {
        firedRemindersRef.current.add(point.key);
        newReminders.push({
          id: `${point.key}-${Date.now()}`,
          taskId: task.id,
          taskTitle: stripWikilinks(task.title),
          taskColor: task.color,
          startTime: task.startTime || null,
          message: reminderMessage(point.type),
          type: point.type,
          isCalendarEvent: task.imported && !task.isTaskCalendar,
          firedAt: Date.now(),
        });
      }
    }

    if (newReminders.length > 0) {
      playUISound('reminder');
      if (window.electronAPI?.isElectron) window.electronAPI.setTrayIndicator(true);
      if (reminderSettings.inAppToasts !== false) {
        const newTaskIds = new Set(newReminders.map(r => r.taskId));
        setActiveReminders(prev => [...prev.filter(r => !newTaskIds.has(r.taskId)), ...newReminders]);
      }
      if (reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        if (window.electronAPI?.isElectron) {
          for (const r of newReminders) {
            try { new Notification(r.taskTitle, { body: r.message }); } catch {}
          }
        } else {
          navigator.serviceWorker?.ready.then(reg => {
            for (const r of newReminders) {
              try {
                reg.showNotification(r.taskTitle, {
                  body: r.message,
                  icon: '/icon-192.png',
                  tag: String(r.taskId),
                });
              } catch {}
            }
          });
        }
      }
      // Native app: show rich notifications with Snooze / Mark Complete action buttons
      if (isNativeApp()) {
        for (const r of newReminders) {
          nativeShowTaskNotification(r);
        }
      }
    }
  }, [currentTime, reminderSettings, tasks, expandedRecurringTasks, hgSessions, isVisibleForUser]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss reminders based on type
  useEffect(() => {
    if (isTrayMode || activeReminders.length === 0) return;
    const dismissMs = { before15: 870000, before10: 570000, before5: 270000, start: 600000, end: 300000 };
    const timer = setInterval(() => {
      const now = Date.now();
      setActiveReminders(prev => prev.filter(r => {
        // Early notice (#2249) stays up as long as a 15-minute reminder does.
        const ttl = dismissMs[r.type] ?? (isAheadReminder(r.type) ? 870000 : undefined);
        if (!ttl) return true; // morning (all-day) — keep until manually dismissed
        return now - r.firedAt < ttl;
      }));
    }, 30000);
    return () => clearInterval(timer);
  }, [activeReminders.length]);

  // Native app: pre-schedule background reminder alarms so notifications fire even
  // when the app is closed. On Android uses AlarmManager (re-registered on reboot);
  // on iOS uses UNCalendarNotificationTrigger (restored automatically by the OS).
  useEffect(() => {
    if (isTrayMode || !isNativeApp()) return;

    const todayStr = dateToString(new Date());
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const now = Date.now();

    const futureReminders = [];

    // ── Task reminders (only when globally enabled) ────────────────────────
    if (reminderSettings.enabled) {
      const onDay = (dateStr) => [
        ...tasks.filter(t => t.date === dateStr && isVisibleForUser(t)),
        ...expandedRecurringTasks.filter(t => t.date === dateStr && isVisibleForUser(t)),
      ];
      const points = reminderPointsToday({
        todayTasks: onDay(todayStr), tomorrowTasks: onDay(tomorrowOf(new Date())), reminderSettings,
      });

      for (const { task, ...point } of points) {
        const triggerAtMillis = todayMidnight.getTime() + point.minute * 60 * 1000;
        if (triggerAtMillis <= now) continue;
        futureReminders.push({
          id: point.key,
          taskId: String(task.id),
          // Same rule as the foreground path's taskTitle above: a notification
          // shade cannot open a note, so the [[wikilink]] goes.
          title: stripWikilinks(task.title),
          body: reminderMessage(point.type),
          type: point.type,
          isCalendarEvent: !!(task.imported && !task.isTaskCalendar),
          triggerAtMillis,
        });
      }
    }

    // ── HG session alarms (independent of global enabled toggle) ──────────
    const hgNotifEnabled = reminderSettings.hyperGlance?.enabled !== false;
    if (hgNotifEnabled) {
      const upNextMinutes = reminderSettings.hyperGlance?.upNextMinutes ?? 10;
      for (const session of hgSessions) {
        if (session.date !== todayStr) continue;
        if (upNextMinutes > 0) {
          const triggerAtMillis = todayMidnight.getTime() + (session.startMinutes - upNextMinutes) * 60 * 1000;
          if (triggerAtMillis > now) {
            futureReminders.push({
              id: `hg-upnext-${session.id}-${session.date}`,
              taskId: `hg-${session.id}`,
              title: 'hyperGLANCE',
              body: hgUpNextBody(session, upNextMinutes),
              type: 'hg-upnext',
              isCalendarEvent: false,
              triggerAtMillis,
            });
          }
        }
        const startTrigger = todayMidnight.getTime() + session.startMinutes * 60 * 1000;
        if (startTrigger > now) {
          futureReminders.push({
            id: `hg-start-${session.id}-${session.date}`,
            taskId: `hg-${session.id}`,
            title: 'hyperGLANCE',
            body: i18n.t('reminders.hgStartingNow', { title: session.title }),
            type: 'hg-start',
            isCalendarEvent: false,
            triggerAtMillis: startTrigger,
          });
        }
      }
    }

    nativeSyncReminders(futureReminders);
  }, [tasks, expandedRecurringTasks, reminderSettings, hgSessions, isVisibleForUser, langEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reminder snooze: push task start time forward 15 minutes
  const snoozeReminder = (reminder) => {
    pushUndo({ key: 'snoozed', taskId: reminder.taskId });
    setActiveReminders(prev => prev.filter(r => r.id !== reminder.id));
    const newStartMin = Math.min(timeToMinutes(reminder.startTime) + 15, 23 * 60 + 45);
    const newStartTime = minutesToTime(newStartMin);
    const parsed = parseRecurringId(reminder.taskId);
    if (parsed) {
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== parsed.templateId) return t;
        const exceptions = { ...(t.exceptions || {}) };
        exceptions[parsed.dateStr] = { ...(exceptions[parsed.dateStr] || {}), startTime: newStartTime };
        return { ...t, exceptions, lastModified: new Date().toISOString() };
      }));
    } else {
      setTasks(prev => prev.map(t =>
        t.id === reminder.taskId ? { ...t, startTime: newStartTime } : t
      ));
    }
    // Clear fired keys for this task so new-time reminders fire fresh
    const keysToRemove = [...firedRemindersRef.current].filter(k => k.includes(String(reminder.taskId)));
    keysToRemove.forEach(k => firedRemindersRef.current.delete(k));
  };

  const dismissReminder = (reminderId) => {
    setActiveReminders(prev => prev.filter(r => r.id !== reminderId));
  };

  const dismissAllReminders = () => {
    setActiveReminders([]);
  };

  return {
    activeReminders,
    setActiveReminders,
    snoozeReminder,
    dismissReminder,
    dismissAllReminders,
  };
}
