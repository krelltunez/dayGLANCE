// Settings search (docs/settings-redesign.md, "Search"). Each section names
// the strings a user would look for it by, as locale keys: its title first,
// then its own labels. Matching runs on the translated text, so search works
// in every language, and only on sections this device shows.
import { TOPICS, visibleSectionKeys } from './settingsTopics.js';

export const SECTION_SEARCH = {
  theme: ['settings.theme', 'settings.lightMode', 'settings.darkMode', 'settings.themeSystem'],
  timezoneNotice: ['settings.timezoneMismatch', 'settings.timezoneHome'],
  localization: ['settings.localization', 'settings.language', 'settings.clockFormat', 'settings.clock24h', 'settings.firstDayOfWeek', 'settings.homeTimezone'],
  sound: ['settings.sound', 'settings.enableUISounds'],
  weather: ['settings.weather', 'settings.showWeatherInHeader', 'settings.weatherTempUnit', 'settings.location'],
  dailyContent: ['settings.dailyContent', 'settings.showDailyContent'],
  viewDefaults: ['settings.viewDefaults', 'settings.defaultViewOnLoad', 'settings.dayViewMode', 'settings.weekViewMode', 'settings.weekTimelineStart', 'settings.glanceDefault'],
  mobileViewDefaults: ['settings.viewDefault', 'settings.endOfDay', 'settings.glanceDefault'],
  tabletViewDefaults: ['settings.viewDefaults', 'settings.portraitViewDefault', 'settings.landscapeViewDefault', 'settings.endOfDay'],
  timelineSize: ['timelineZoom.label'],
  cardSubtasks: ['settings.taskCards', 'settings.showCardSubtasks'],
  cardSize: ['cardSize.label'],
  goals: ['settings.goalsProjects', 'settings.enableGoalsProjects'],
  routines: ['settings.routines', 'settings.enableRoutines'],
  habits: ['settings.habitTracking', 'settings.enableHabitTracking'],
  multiUser: ['settings.multiUser', 'settings.multiUserMode', 'settings.multiUserPeople'],
  inbox: ['settings.inbox', 'settings.inboxAutoArchive', 'settings.binAutoEmpty'],
  followUpTag: ['followUp.settingTitle', 'followUp.settingLabel'],
  experimental: ['settings.experimental', 'settings.enableJobo', 'settings.enableAspire'],
  notifications: ['settings.notifications', 'reminders.title', 'weeklyReview.title', 'reminders.hyperGlanceSessions', 'reminders.scheduledTasks', 'reminders.calendarEvents', 'reminders.morningReminderAt'],
  ai: ['settings.aiFeatures', 'settings.aiProvider', 'settings.aiApiKey', 'settings.aiModel'],
  cloudSync: ['settings.cloudSync', 'sync.form.encryptionTitle', 'sync.form.webdavTitle', 'sync.form.vaultTitle', 'icloudSync.title'],
  calendarSync: ['settings.calendarSync', 'settings.taskCalendarUrl', 'settings.addCalendar', 'settings.keepPastEvents'],
  obsidian: ['settings.obsidianIntegration', 'settings.obsidianDailyNotesFolder'],
  todoist: ['todoist.title'],
  trmnl: ['settings.trmnlDashboard', 'settings.trmnlWebhookUrl'],
  glanceIntegrations: ['settings.glanceIntegrations', 'settings.glanceServerUrl'],
  localIntegrations: ['settings.localIntegrations'],
  glanceLauncher: ['settings.launcherPromo.title'],
  automationIntents: ['settings.automationIntents'],
  backup: ['backup.title', 'backup.exportBackup', 'backup.restoreBackup', 'backup.autoBackup', 'backup.localBackups', 'backup.remoteBackups', 'backup.folderBackup', 'backup.historyTitle'],
  globalShortcut: ['settings.globalShortcuts'],
  about: ['settings.topics.about', 'app.documentation', 'onboarding.privacyPolicy', 'onboarding.termsOfUse'],
};

/** Lower case, accents dropped, so "réglages" finds "reglages" and back. */
export function foldText(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * The sections matching a query, in topic order, each once:
 * `{ topicId, sectionKey, title, match }`. `match` is the label that matched
 * when it is not the title, so the result can name the setting. A query
 * shorter than two characters matches nothing.
 */
export function searchSettings(query, sections, t, topics = TOPICS) {
  const q = foldText(query);
  if (q.length < 2) return [];
  const results = [];
  for (const topic of topics) {
    for (const sectionKey of visibleSectionKeys(topic, sections)) {
      const keys = SECTION_SEARCH[sectionKey];
      if (!keys?.length) continue;
      const labels = keys.map((key) => t(key)).map((text) => String(text).replace(/\{\{[^}]*\}\}/g, '').trim());
      const hit = labels.findIndex((label) => foldText(label).includes(q));
      if (hit < 0) continue;
      results.push({ topicId: topic.id, sectionKey, title: labels[0], match: hit === 0 ? null : labels[hit] });
    }
  }
  return results;
}
