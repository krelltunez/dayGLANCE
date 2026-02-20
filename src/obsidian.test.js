import { describe, it, expect } from 'vitest';
import { parseTasksFromMarkdown } from './obsidian.js';

describe('parseTasksFromMarkdown', () => {
  const dateStr = '2026-02-20';

  it('parses incomplete tasks', () => {
    const md = '- [ ] Buy groceries\n- [ ] Call dentist';
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks).toHaveLength(0);
    expect(inboxTasks).toHaveLength(2);
    expect(inboxTasks[0].title).toContain('Buy groceries');
    expect(inboxTasks[0].title).toContain('#obsidian');
    expect(inboxTasks[0].completed).toBe(false);
    expect(inboxTasks[1].title).toContain('Call dentist');
  });

  it('parses completed tasks', () => {
    const md = '- [x] Done task\n- [X] Also done';
    const { inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(inboxTasks).toHaveLength(2);
    expect(inboxTasks[0].completed).toBe(true);
    expect(inboxTasks[1].completed).toBe(true);
  });

  it('parses 24h time into scheduled tasks', () => {
    const md = '- [ ] 09:00 Stand-up meeting\n- [ ] 14:30 Review PR';
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks).toHaveLength(2);
    expect(inboxTasks).toHaveLength(0);
    expect(scheduledTasks[0].startTime).toBe('09:00');
    expect(scheduledTasks[0].title).toContain('Stand-up meeting');
    expect(scheduledTasks[0].date).toBe(dateStr);
    expect(scheduledTasks[1].startTime).toBe('14:30');
    expect(scheduledTasks[1].title).toContain('Review PR');
  });

  it('parses AM/PM time', () => {
    const md = '- [ ] 9:00 AM Breakfast\n- [ ] 2:30 PM Lunch';
    const { scheduledTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks).toHaveLength(2);
    expect(scheduledTasks[0].startTime).toBe('09:00');
    expect(scheduledTasks[1].startTime).toBe('14:30');
  });

  it('parses lowercase am/pm', () => {
    const md = '- [ ] 8:00am Run\n- [ ] 12:00pm Lunch';
    const { scheduledTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks).toHaveLength(2);
    expect(scheduledTasks[0].startTime).toBe('08:00');
    expect(scheduledTasks[1].startTime).toBe('12:00');
  });

  it('does not double-add #obsidian tag', () => {
    const md = '- [ ] Task with #obsidian tag';
    const { inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(inboxTasks[0].title).toBe('Task with #obsidian tag');
    // Should not have double tag
    expect(inboxTasks[0].title.match(/#obsidian/g)).toHaveLength(1);
  });

  it('ignores non-task lines', () => {
    const md = '# Heading\nSome text\n- Regular list item\n- [ ] Actual task\n> quote';
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks).toHaveLength(0);
    expect(inboxTasks).toHaveLength(1);
    expect(inboxTasks[0].title).toContain('Actual task');
  });

  it('handles indented tasks', () => {
    const md = '  - [ ] Indented task\n    - [ ] Double indented';
    const { inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(inboxTasks).toHaveLength(2);
  });

  it('returns empty for empty content', () => {
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown('', dateStr);
    expect(scheduledTasks).toHaveLength(0);
    expect(inboxTasks).toHaveLength(0);
  });

  it('returns empty for null content', () => {
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(null, dateStr);
    expect(scheduledTasks).toHaveLength(0);
    expect(inboxTasks).toHaveLength(0);
  });

  it('generates stable IDs based on date and title', () => {
    const md = '- [ ] Same task';
    const r1 = parseTasksFromMarkdown(md, dateStr);
    const r2 = parseTasksFromMarkdown(md, dateStr);
    expect(r1.inboxTasks[0].id).toBe(r2.inboxTasks[0].id);
  });

  it('generates different IDs for different dates', () => {
    const md = '- [ ] Same task';
    const r1 = parseTasksFromMarkdown(md, '2026-02-20');
    const r2 = parseTasksFromMarkdown(md, '2026-02-21');
    expect(r1.inboxTasks[0].id).not.toBe(r2.inboxTasks[0].id);
  });

  it('sets importSource to obsidian', () => {
    const md = '- [ ] 10:00 Scheduled\n- [ ] Inbox task';
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks[0].importSource).toBe('obsidian');
    expect(inboxTasks[0].importSource).toBe('obsidian');
  });

  it('sets purple color for Obsidian tasks', () => {
    const md = '- [ ] Task';
    const { inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(inboxTasks[0].color).toBe('bg-purple-600');
  });

  it('mixes scheduled and inbox tasks', () => {
    const md = '- [ ] 09:00 Morning standup\n- [ ] Buy milk\n- [x] 14:00 Review\n- [ ] Read chapter 3';
    const { scheduledTasks, inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks).toHaveLength(2);
    expect(inboxTasks).toHaveLength(2);
    expect(scheduledTasks[0].startTime).toBe('09:00');
    expect(scheduledTasks[1].startTime).toBe('14:00');
    expect(scheduledTasks[1].completed).toBe(true);
  });

  it('handles 12 AM and 12 PM correctly', () => {
    const md = '- [ ] 12:00 AM Midnight task\n- [ ] 12:00 PM Noon task';
    const { scheduledTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks).toHaveLength(2);
    expect(scheduledTasks[0].startTime).toBe('00:00');
    expect(scheduledTasks[1].startTime).toBe('12:00');
  });

  it('stores obsidianRawTitle on inbox tasks (title without #obsidian, without time)', () => {
    const md = '- [ ] Buy groceries';
    const { inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(inboxTasks[0].obsidianRawTitle).toBe('Buy groceries');
    expect(inboxTasks[0].title).toBe('Buy groceries #obsidian');
  });

  it('stores obsidianRawTitle on scheduled tasks (time stripped)', () => {
    const md = '- [ ] 09:00 Stand-up meeting';
    const { scheduledTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(scheduledTasks[0].obsidianRawTitle).toBe('Stand-up meeting');
    expect(scheduledTasks[0].startTime).toBe('09:00');
  });

  it('obsidianRawTitle preserves existing tags but not our #obsidian', () => {
    const md = '- [ ] Fix bug #urgent';
    const { inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(inboxTasks[0].obsidianRawTitle).toBe('Fix bug #urgent');
    expect(inboxTasks[0].title).toBe('Fix bug #urgent #obsidian');
  });

  it('obsidianRawTitle for task already tagged with #obsidian', () => {
    const md = '- [ ] Task with #obsidian';
    const { inboxTasks } = parseTasksFromMarkdown(md, dateStr);
    expect(inboxTasks[0].obsidianRawTitle).toBe('Task with #obsidian');
    expect(inboxTasks[0].title).toBe('Task with #obsidian');
  });
});
