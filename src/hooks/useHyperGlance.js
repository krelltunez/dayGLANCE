import { dateToString } from '../utils/taskUtils.js';

// Days of week in JS Date.getDay() order
export const HG_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Curated icon groups for hyperGLANCE project icon picker
export const HG_ICON_GROUPS = [
  { group: 'Education', icons: ['BookOpen', 'GraduationCap', 'Brain', 'Calculator', 'FlaskConical', 'Pencil'] },
  { group: 'Work',      icons: ['Briefcase', 'Code2', 'LineChart', 'Target', 'LayoutDashboard', 'Clipboard'] },
  { group: 'Health',    icons: ['Dumbbell', 'Heart', 'Activity', 'Apple', 'Moon', 'Bike'] },
  { group: 'Creative',  icons: ['Music', 'Camera', 'Palette', 'Lightbulb', 'Star', 'Wand2'] },
];

// Preset color palette for project bars
export const HG_COLORS = [
  { label: 'Indigo',  value: '#4f46e5' },
  { label: 'Blue',    value: '#2563eb' },
  { label: 'Teal',    value: '#0d9488' },
  { label: 'Green',   value: '#16a34a' },
  { label: 'Amber',   value: '#d97706' },
  { label: 'Orange',  value: '#ea580c' },
  { label: 'Rose',    value: '#e11d48' },
  { label: 'Purple',  value: '#9333ea' },
];

/**
 * Returns the "active instance" for a hyperGLANCE project — the earliest
 * incomplete scheduled session at or after the config's createdAt date.
 * Looks back up to 7 days (but not before createdAt) for missed sessions,
 * then forward up to 365 days for the next future session.
 *
 * Returns null if the project has no hyperglance config, is not enabled,
 * or has no scheduled days.
 */
export function getActiveHGInstance(project) {
  const hg = project.hyperglance;
  if (!hg?.enabled) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = dateToString(today);

  // Don't surface sessions from before the config was created
  const createdAtStr = hg.createdAt ? dateToString(new Date(hg.createdAt)) : null;

  const completedDates = new Set((hg.completions || []).map(c => c.date));

  if (!hg.isRecurring) {
    if (!hg.scheduledDate) return null;
    if (completedDates.has(hg.scheduledDate)) return null;
    // Don't show as overdue if the date predates when the config was created
    if (createdAtStr && hg.scheduledDate < createdAtStr) return null;
    return {
      projectId: project.id,
      date: hg.scheduledDate,
      isOverdue: hg.scheduledDate < todayStr,
    };
  }

  // Recurring: look back up to 7 days (but not before createdAt), then forward
  const scheduledDays = hg.scheduledDays || [];
  if (scheduledDays.length === 0) return null;

  for (let i = -7; i <= 365; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const ds = dateToString(d);
    const dayName = HG_DAYS[d.getDay()];

    // Skip dates before the config was first created
    if (createdAtStr && ds < createdAtStr) continue;

    if (scheduledDays.includes(dayName) && !completedDates.has(ds)) {
      return {
        projectId: project.id,
        date: ds,
        isOverdue: ds < todayStr,
      };
    }
  }

  return null;
}

/**
 * Returns all hyperGLANCE bars that should be shown on a given date string:
 * - Active (incomplete) instance for that date → full bar
 * - Completed instance for that date → small pill
 */
export function getHGBarsForDate(projects, dateStr) {
  const bars = [];

  for (const project of projects) {
    const hg = project.hyperglance;
    if (!hg?.enabled) continue;

    const active = getActiveHGInstance(project);
    const completedOnDate = (hg.completions || []).some(c => c.date === dateStr);

    if (active?.date === dateStr) {
      bars.push({ project, date: dateStr, isCompleted: false, isOverdue: active.isOverdue });
    } else if (completedOnDate) {
      bars.push({ project, date: dateStr, isCompleted: true, isOverdue: false });
    }
  }

  return bars;
}

/**
 * Returns true if current time has reached or passed the scheduled start time
 * for today's session (enabling the pulsing HG button).
 */
export function isHGSessionReachable(instance, hgConfig, currentTime) {
  if (!instance || instance.isOverdue) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (instance.date !== dateToString(today)) return false;

  const [h, m] = (hgConfig.scheduledTime || '0:0').split(':').map(Number);
  const startMinutes = h * 60 + m;
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  return nowMinutes >= startMinutes;
}

/**
 * Returns all overdue hyperGLANCE instances (missed sessions from past dates).
 */
export function getOverdueHGInstances(projects) {
  return projects
    .filter(p => p.hyperglance?.enabled)
    .map(p => ({ project: p, instance: getActiveHGInstance(p) }))
    .filter(({ instance }) => instance?.isOverdue);
}

/**
 * Returns hyperGLANCE instances scheduled for today that are not yet overdue.
 * Used to surface upcoming sessions in the GLANCE panel alongside tasks.
 */
export function getTodayHGInstances(projects) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = dateToString(today);
  return projects
    .filter(p => p.hyperglance?.enabled)
    .map(p => ({ project: p, instance: getActiveHGInstance(p) }))
    .filter(({ instance }) => instance && instance.date === todayStr && !instance.isOverdue);
}
