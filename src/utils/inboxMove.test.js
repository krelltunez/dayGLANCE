import { describe, it, expect } from 'vitest';
import { toInboxCopy } from './inboxMove.js';

describe('toInboxCopy — the one inbox copy every move-to-inbox path produces', () => {
  const NOW = '2026-09-08T05:00:00.000Z';
  it('an Obsidian task with a time records the time the move removes', () => {
    const t = { id: 'obsidian-dg-abc', importSource: 'obsidian', title: 'A', date: '2026-09-08', startTime: '10:30', isAllDay: false, duration: 30, priority: 2, lastModified: '2026-09-01T00:00:00.000Z' };
    expect(toInboxCopy(t, NOW)).toEqual({ id: 'obsidian-dg-abc', importSource: 'obsidian', title: 'A', date: null, startTime: null, isAllDay: false, duration: 30, priority: 2, lastModified: NOW, obsidianClearedTime: '10:30' });
  });
  it('an all-day Obsidian task and a non-Obsidian task record nothing', () => {
    expect(toInboxCopy({ id: 1, importSource: 'obsidian', date: '2026-09-08', isAllDay: true }, NOW)).not.toHaveProperty('obsidianClearedTime');
    expect(toInboxCopy({ id: 2, date: '2026-09-08', startTime: '10:30' }, NOW)).not.toHaveProperty('obsidianClearedTime');
  });
  it('a prior marker never survives a new move; priority defaults to 0', () => {
    const out = toInboxCopy({ id: 1, importSource: 'obsidian', obsidianClearedTime: '08:00', date: '2026-09-08', isAllDay: true }, NOW);
    expect(out).not.toHaveProperty('obsidianClearedTime');
    expect(out.priority).toBe(0);
  });
});
