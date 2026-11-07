// The Settings topics (#2075, docs/settings-redesign.md): which blocks of the
// dialog each topic page shows, in order. Pure, so the mapping and the
// visibility rules are tested without rendering the dialog.
//
// Step 1 of the redesign moves blocks without changing them, so a block keeps
// its own internal layout and collapse state here; the card pattern replaces
// that per topic in step 2. Notifications and Backup & Restore were the header
// bell's and save icon's dialogs; About & Help holds the version, the update
// notice and the help links, and General opens with the timezone notice.
//
// A label is any locale key: a topic that already had a name in the app keeps
// it (Notifications, Backup & Restore).

export const TOPICS = [
  { id: 'general', labelKey: 'settings.topics.general', fallback: 'General',
    sections: ['timezoneNotice', 'localization', 'sound', 'inbox', 'followUpTag', 'weather', 'dailyContent', 'globalShortcut'] },
  { id: 'appearance', labelKey: 'settings.topics.appearance', fallback: 'Appearance',
    sections: ['theme', 'viewDefaults', 'mobileViewDefaults', 'tabletViewDefaults', 'timelineSize', 'cardSize'] },
  { id: 'features', labelKey: 'settings.topics.features', fallback: 'Features',
    sections: ['goals', 'routines', 'habits', 'multiUser', 'experimental'] },
  { id: 'ai', labelKey: 'settings.aiFeatures', fallback: 'AI Features',
    sections: ['ai'] },
  { id: 'sync', labelKey: 'settings.topics.sync', fallback: 'Sync',
    sections: ['cloudSync'] },
  { id: 'integrations', labelKey: 'settings.topics.integrations', fallback: 'Integrations',
    sections: ['calendarSync', 'obsidian', 'todoist', 'trmnl', 'glanceIntegrations', 'glanceLauncher', 'localIntegrations', 'automationIntents'] },
  { id: 'notifications', labelKey: 'settings.notifications', fallback: 'Notifications',
    sections: ['notifications'] },
  { id: 'backup', labelKey: 'backup.title', fallback: 'Backup & Restore',
    sections: ['backup'] },
  { id: 'about', labelKey: 'settings.topics.about', fallback: 'About & Help',
    sections: ['about'] },
];

export const SETTINGS_TOPIC_KEY = 'dg-settings-topic';

/** The keys of a topic's sections that render anything here, in order. */
export function visibleSectionKeys(topic, sections) {
  return (topic?.sections ?? []).filter((key) => sections[key] && sections[key].show);
}

/** Topics with at least one visible section; an empty topic is not listed. */
export function visibleTopics(sections, topics = TOPICS) {
  return topics.filter((topic) => visibleSectionKeys(topic, sections).length > 0);
}

/**
 * A topic's mark in the list while one of its visible sections needs a look:
 * 'red' (an update is waiting) outranks 'amber' (a notice); null when none.
 */
export function topicAttention(topic, sections) {
  const marks = visibleSectionKeys(topic, sections).map((key) => sections[key].attention).filter(Boolean);
  if (marks.includes('red')) return 'red';
  return marks.includes('amber') ? 'amber' : null;
}

/** The topic to open: the remembered one if it is listed here, else the first. */
export function initialTopicId(remembered, listed) {
  return listed.some((topic) => topic.id === remembered) ? remembered : (listed[0]?.id ?? null);
}

export function readRememberedTopic() {
  try { return localStorage.getItem(SETTINGS_TOPIC_KEY); } catch { return null; }
}

export function rememberTopic(id) {
  try { localStorage.setItem(SETTINGS_TOPIC_KEY, id); } catch { /* a convenience only */ }
}
