import { describe, it, expect } from 'vitest';
import { generateDemoMonth } from './monthDemoData.js';
import { TASK_COLORS } from './colorUtils.js';

describe('generateDemoMonth', () => {
  const sept = generateDemoMonth(2026, 9, { today: '2026-09-12' });

  it('is deterministic for a month', () => {
    expect(generateDemoMonth(2026, 9, { today: '2026-09-12' })).toEqual(sept);
    expect(generateDemoMonth(2026, 10)).not.toEqual(sept);
  });

  it('produces app-shaped tasks and inbox items only in that month', () => {
    for (const t of sept.tasks) {
      expect(t.date).toMatch(/^2026-09-\d\d$/);
      expect(typeof t.id).toBe('string');
      if (!t.isAllDay) {
        expect(t.startTime).toMatch(/^\d\d:\d\d$/);
        expect(t.duration).toBeGreaterThan(0);
      }
      if (!t.imported) expect(TASK_COLORS.some((c) => c.class === t.color)).toBe(true);
    }
    for (const u of sept.unscheduled) {
      expect(u.deadline).toMatch(/^2026-09-\d\d$/);
      expect(u.date).toBeUndefined();
    }
    expect(new Set(sept.tasks.map((t) => t.id)).size).toBe(sept.tasks.length);
  });

  it('is realistically busy: events most weekdays, some overlaps, a few all-day items and deadlines, quiet stretches', () => {
    const byDate = new Map();
    for (const t of sept.tasks) byDate.set(t.date, [...(byDate.get(t.date) || []), t]);
    const weekdays = [];
    for (let d = 1; d <= 30; d++) {
      const dow = new Date(2026, 8, d).getDay();
      if (dow > 0 && dow < 6) weekdays.push(`2026-09-${String(d).padStart(2, '0')}`);
    }
    const busyWeekdays = weekdays.filter((d) => (byDate.get(d) || []).some((t) => t.imported && !t.isAllDay));
    expect(busyWeekdays.length).toBeGreaterThanOrEqual(weekdays.length * 0.6);
    expect(weekdays.filter((d) => !byDate.has(d)).length).toBeGreaterThanOrEqual(3);
    const overlaps = [...byDate.values()].filter((list) => {
      const timed = list.filter((t) => !t.isAllDay).map((t) => { const [h, m] = t.startTime.split(':').map(Number); const s = h * 60 + m; return [s, s + t.duration]; });
      return timed.some((a, i) => timed.some((b, j) => i !== j && a[0] < b[1] && b[0] < a[1]));
    });
    expect(overlaps.length).toBeGreaterThanOrEqual(4);
    expect(sept.tasks.filter((t) => t.isAllDay).length).toBeGreaterThanOrEqual(1);
    expect(sept.unscheduled.length).toBeGreaterThanOrEqual(5);
    expect(new Set(sept.tasks.filter((t) => t.color).map((t) => t.color)).size).toBeGreaterThanOrEqual(4);
    expect(sept.tasks.some((t) => t.completed)).toBe(true);
    expect(sept.tasks.filter((t) => t.date >= '2026-09-12' && t.completed)).toHaveLength(0);
  });
});
