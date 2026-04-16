import { dateToString } from '../utils/taskUtils.js';

// Days of week in JS Date.getDay() order
export const HG_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Curated icon groups for hyperGLANCE project icon picker
export const HG_ICON_GROUPS = [
  { group: 'Education', icons: ['BookOpen', 'GraduationCap', 'Brain', 'Calculator', 'FlaskConical', 'Pencil', 'Globe', 'Microscope'] },
  { group: 'Work',      icons: ['Briefcase', 'Code2', 'LineChart', 'Target', 'LayoutDashboard', 'Clipboard', 'Users', 'Mail'] },
  { group: 'Health',    icons: ['Dumbbell', 'Heart', 'Activity', 'Apple', 'Moon', 'Bike', 'Leaf', 'Trophy'] },
  { group: 'Creative',  icons: ['Music', 'Camera', 'Palette', 'Lightbulb', 'Wand2', 'Headphones', 'Mic', 'Film'] },
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
export function getActiveHGInstance(project, nowMinutes) {
  const hg = project.hyperglance;
  if (!hg?.enabled) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = dateToString(today);

  // Don't surface sessions from before the config was created
  const createdAtStr = hg.createdAt ? dateToString(new Date(hg.createdAt)) : null;

  const completedDates = new Set((hg.completions || []).map(c => c.date));
  const skippedDates = new Set(hg.skippedDates || []);

  // Returns true if a date+session is overdue, accounting for same-day time if nowMinutes provided
  const isSessionOverdue = (ds) => {
    if (ds < todayStr) return true;
    if (ds === todayStr && nowMinutes !== undefined) {
      const effectiveTime = hg.scheduledTimeOverrides?.[ds] || hg.scheduledTime;
      if (effectiveTime) {
        const [sh, sm] = effectiveTime.split(':').map(Number);
        const duration = hg.scheduledDurationOverrides?.[ds] || hg.scheduledDuration || 60;
        return (sh * 60 + sm) + duration <= nowMinutes;
      }
    }
    return false;
  };

  if (!hg.isRecurring) {
    if (!hg.scheduledDate) return null;
    if (completedDates.has(hg.scheduledDate)) return null;
    if (skippedDates.has(hg.scheduledDate)) return null;
    // Don't show as overdue if the date predates when the config was created
    if (createdAtStr && hg.scheduledDate < createdAtStr) return null;
    return {
      projectId: project.id,
      date: hg.scheduledDate,
      isOverdue: isSessionOverdue(hg.scheduledDate),
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

    if (scheduledDays.includes(dayName) && !completedDates.has(ds) && !skippedDates.has(ds)) {
      return {
        projectId: project.id,
        date: ds,
        isOverdue: isSessionOverdue(ds),
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
export function getHGBarsForDate(projects, dateStr, nowMinutes) {
  const bars = [];

  for (const project of projects) {
    if (project.archived) continue;
    const hg = project.hyperglance;
    if (!hg?.enabled) continue;

    const active = getActiveHGInstance(project, nowMinutes);
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

  const effectiveTime = hgConfig.scheduledTimeOverrides?.[instance.date] || hgConfig.scheduledTime || '0:0';
  const [h, m] = effectiveTime.split(':').map(Number);
  const startMinutes = h * 60 + m;
  const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  return nowMinutes >= startMinutes;
}

/**
 * Returns all hyperGLANCE instances for the GLANCE panel: today's sessions
 * plus any overdue (missed) sessions, overdue entries sorted first, then by time.
 */
export function getGlanceHGInstances(projects, nowMinutes) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = dateToString(today);
  return projects
    .filter(p => !p.archived && p.hyperglance?.enabled)
    .map(p => ({ project: p, instance: getActiveHGInstance(p, nowMinutes) }))
    .filter(({ instance }) => instance && (instance.isOverdue || instance.date === todayStr))
    .sort((a, b) => {
      if (a.instance.isOverdue && !b.instance.isOverdue) return -1;
      if (!a.instance.isOverdue && b.instance.isOverdue) return 1;
      // Same overdue status — sort chronologically by effective start time
      const tA = a.project.hyperglance.scheduledTimeOverrides?.[a.instance.date] || a.project.hyperglance.scheduledTime || '0:0';
      const tB = b.project.hyperglance.scheduledTimeOverrides?.[b.instance.date] || b.project.hyperglance.scheduledTime || '0:0';
      const [ah, am] = tA.split(':').map(Number);
      const [bh, bm] = tB.split(':').map(Number);
      return (ah * 60 + am) - (bh * 60 + bm);
    });
}
