import { useState, useRef, useEffect } from 'react';
import { dateToString, stripWikilinks } from '../utils/taskUtils.js';
import { isNativeAndroid, nativeShowNotification, nativeShowTaskNotification, nativeSyncReminders } from '../native.js';

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
  if (catSettings.before15) points.push({ key: `b15-${task.id}`, triggerMin: startMin - 15, type: 'before15' });
  if (catSettings.before10) points.push({ key: `b10-${task.id}`, triggerMin: startMin - 10, type: 'before10' });
  if (catSettings.before5) points.push({ key: `b5-${task.id}`, triggerMin: startMin - 5, type: 'before5' });
  if (catSettings.atStart) points.push({ key: `start-${task.id}`, triggerMin: startMin, type: 'start' });
  if (catSettings.atEnd) points.push({ key: `end-${task.id}`, triggerMin: endMin, type: 'end' });
  return points.filter(p => p.triggerMin >= 0);
};

export default function useReminderEngine({
  currentTime,
  reminderSettings,
  tasks,
  expandedRecurringTasks,
  hgSessions = [],
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
  const firedRemindersRef = useRef(new Set());
  const lastReminderDateRef = useRef((() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })());

  // Reminder notification engine
  useEffect(() => {
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
          localStorage.setItem('day-planner-weekly-review-fired', isoWeek);
          playUISound('reminder');
          if (reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              navigator.serviceWorker?.ready.then(reg => {
                reg.showNotification('dayGLANCE', {
                  body: 'Time for your weekly review!',
                  icon: '/icon-192.png',
                  tag: 'weekly-review',
                });
              });
            } catch {}
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
              body: `${session.title}${session.taskCount > 0 ? ` · ${session.taskCount} task${session.taskCount !== 1 ? 's' : ''}` : ''} · Starts in ${upNextMinutes}m`,
              tag: `hg-upnext-${session.id}`,
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
            body: `${session.title} · Starting now`,
            tag: `hg-start-${session.id}`,
          });
        }
      }

      if (hgFires.length > 0) {
        playUISound('reminder');
        if (reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          navigator.serviceWorker?.ready.then(reg => {
            for (const { title, body, tag } of hgFires) {
              try { reg.showNotification(title, { body, icon: '/icon-192.png', tag }); } catch {}
            }
          });
        }
        if (isNativeAndroid()) {
          for (const { title, body } of hgFires) {
            nativeShowNotification(title, body);
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

    // Gather all today's tasks
    const todayRegular = tasks.filter(t => t.date === todayStr);
    const todayRecurring = expandedRecurringTasks.filter(t => t.date === todayStr);
    const allTodayTasks = [...todayRegular, ...todayRecurring];

    const newReminders = [];
    for (const task of allTodayTasks) {
      if (task.completed) continue;
      const category = getTaskCategory(task);
      const catSettings = reminderSettings.categories[category];
      if (!catSettings) continue;
      const points = getReminderPoints(task, catSettings, reminderSettings.morningReminderTime);
      for (const point of points) {
        if (firedRemindersRef.current.has(point.key)) continue;
        // Fire if current time is within a 2-minute window of the trigger
        if (nowMin >= point.triggerMin && nowMin < point.triggerMin + 2) {
          firedRemindersRef.current.add(point.key);
          const messageMap = {
            before15: 'Starts in 15 minutes',
            before10: 'Starts in 10 minutes',
            before5: 'Starts in 5 minutes',
            start: 'Starting now',
            end: 'Ending now',
            morning: 'All-day task reminder',
          };
          newReminders.push({
            id: `${point.key}-${Date.now()}`,
            taskId: task.id,
            taskTitle: stripWikilinks(task.title),
            taskColor: task.color,
            startTime: task.startTime || null,
            message: messageMap[point.type] || 'Reminder',
            type: point.type,
            isCalendarEvent: task.imported && !task.isTaskCalendar,
            firedAt: Date.now(),
          });
        }
      }
    }

    if (newReminders.length > 0) {
      playUISound('reminder');
      if (reminderSettings.inAppToasts !== false) {
        const newTaskIds = new Set(newReminders.map(r => r.taskId));
        setActiveReminders(prev => [...prev.filter(r => !newTaskIds.has(r.taskId)), ...newReminders]);
      }
      if (reminderSettings.browserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        navigator.serviceWorker?.ready.then(reg => {
          for (const r of newReminders) {
            try {
              reg.showNotification(r.taskTitle, {
                body: r.message,
                icon: '/icon-192.png',
                tag: String(r.taskId), // Use taskId so subsequent reminders replace prior ones
              });
            } catch {}
          }
        });
      }
      // Native Android: show rich notifications with Snooze / Mark Complete action buttons
      if (isNativeAndroid()) {
        for (const r of newReminders) {
          nativeShowTaskNotification(r);
        }
      }
    }
  }, [currentTime, reminderSettings, tasks, expandedRecurringTasks, hgSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-dismiss reminders based on type
  useEffect(() => {
    if (activeReminders.length === 0) return;
    const dismissMs = { before15: 870000, before10: 570000, before5: 270000, start: 600000, end: 300000 };
    const timer = setInterval(() => {
      const now = Date.now();
      setActiveReminders(prev => prev.filter(r => {
        const ttl = dismissMs[r.type];
        if (!ttl) return true; // morning (all-day) — keep until manually dismissed
        return now - r.firedAt < ttl;
      }));
    }, 30000);
    return () => clearInterval(timer);
  }, [activeReminders.length]);

  // Native Android: pre-schedule background reminder alarms via AlarmManager so
  // notifications fire even when the app is closed. Runs whenever tasks, settings,
  // or HG sessions change. On device reboot, ReminderReceiver.BOOT_COMPLETED
  // re-registers from the persisted list stored by nativeSyncReminders.
  useEffect(() => {
    if (!isNativeAndroid()) return;

    const todayStr = dateToString(new Date());
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const now = Date.now();

    const futureReminders = [];

    // ── Task reminders (only when globally enabled) ────────────────────────
    if (reminderSettings.enabled) {
      const todayRegular = tasks.filter(t => t.date === todayStr && !t.completed);
      const todayRecurring = expandedRecurringTasks.filter(t => t.date === todayStr);
      const allTodayTasks = [...todayRegular, ...todayRecurring];

      const messageMap = {
        before15: 'Starts in 15 minutes',
        before10: 'Starts in 10 minutes',
        before5: 'Starts in 5 minutes',
        start: 'Starting now',
        end: 'Ending now',
        morning: 'All-day task reminder',
      };

      for (const task of allTodayTasks) {
        if (task.completed) continue;
        const category = getTaskCategory(task);
        const catSettings = reminderSettings.categories?.[category];
        if (!catSettings) continue;
        const points = getReminderPoints(task, catSettings, reminderSettings.morningReminderTime);
        for (const point of points) {
          const triggerAtMillis = todayMidnight.getTime() + point.triggerMin * 60 * 1000;
          if (triggerAtMillis <= now) continue;
          futureReminders.push({
            id: point.key,
            taskId: String(task.id),
            title: task.title,
            body: messageMap[point.type] || 'Reminder',
            type: point.type,
            isCalendarEvent: !!(task.imported && !task.isTaskCalendar),
            triggerAtMillis,
          });
        }
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
              body: `${session.title}${session.taskCount > 0 ? ` · ${session.taskCount} task${session.taskCount !== 1 ? 's' : ''}` : ''} · Starts in ${upNextMinutes}m`,
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
            body: `${session.title} · Starting now`,
            type: 'hg-start',
            isCalendarEvent: false,
            triggerAtMillis: startTrigger,
          });
        }
      }
    }

    nativeSyncReminders(futureReminders);
  }, [tasks, expandedRecurringTasks, reminderSettings, hgSessions]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reminder snooze: push task start time forward 15 minutes
  const snoozeReminder = (reminder) => {
    pushUndo();
    setActiveReminders(prev => prev.filter(r => r.id !== reminder.id));
    const newStartMin = Math.min(timeToMinutes(reminder.startTime) + 15, 23 * 60 + 45);
    const newStartTime = minutesToTime(newStartMin);
    const parsed = parseRecurringId(reminder.taskId);
    if (parsed) {
      setRecurringTasks(prev => prev.map(t => {
        if (t.id !== parsed.templateId) return t;
        const exceptions = { ...(t.exceptions || {}) };
        exceptions[parsed.dateStr] = { ...(exceptions[parsed.dateStr] || {}), startTime: newStartTime };
        return { ...t, exceptions };
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
