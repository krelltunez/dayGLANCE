import { useState, useEffect } from 'react';

const STORAGE_KEY = 'day-planner-reminder-settings';

const defaults = {
  enabled: false,
  inAppToasts: true,
  browserNotifications: false,
  morningReminderTime: '08:00',
  categories: {
    calendarEvents:  { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
    calendarTasks:   { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
    scheduledTasks:  { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
    allDayTasks:     { morningReminder: true },
    recurringTasks:  { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
  },
  preset: 'standard',
  weeklyReview: { enabled: true, day: 0, time: '19:00' },
};

export default function useReminders() {
  const [showRemindersSettings, setShowRemindersSettings] = useState(false);
  const [reminderSettings, setReminderSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!parsed.weeklyReview) parsed.weeklyReview = defaults.weeklyReview;
        return parsed;
      }
    } catch {}
    return defaults;
  });
  const [showMorningTimePicker, setShowMorningTimePicker] = useState(false);

  // Persist reminderSettings to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reminderSettings));
  }, [reminderSettings]);

  const applyReminderPreset = (name) => {
    const presets = {
      standard:   { before15: true, before10: false, before5: false, atStart: true, atEnd: false },
      aggressive: { before15: true, before10: false, before5: true,  atStart: true, atEnd: true },
      minimal:    { before15: false, before10: false, before5: false, atStart: true, atEnd: false },
    };
    const vals = presets[name];
    if (!vals) return;
    setReminderSettings(prev => ({
      ...prev,
      preset: name,
      categories: {
        ...prev.categories,
        calendarEvents:  { ...vals },
        calendarTasks:   { ...vals },
        scheduledTasks:  { ...vals },
        recurringTasks:  { ...vals },
        allDayTasks:     prev.categories.allDayTasks,
      },
    }));
  };

  const updateCategoryReminder = (category, field, value) => {
    setReminderSettings(prev => ({
      ...prev,
      preset: 'custom',
      categories: {
        ...prev.categories,
        [category]: { ...prev.categories[category], [field]: value },
      },
    }));
  };

  return {
    showRemindersSettings,
    setShowRemindersSettings,
    reminderSettings,
    setReminderSettings,
    showMorningTimePicker,
    setShowMorningTimePicker,
    applyReminderPreset,
    updateCategoryReminder,
  };
}
