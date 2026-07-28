import { describe, it, expect } from 'vitest';
import { normalizeTranscript, parseTranscriptTasks } from './voiceQuickAdd.js';

// Same pinned clock as quickAddParser.test.js: Monday, July 27 2026.
const NOW = new Date(2026, 6, 27, 10, 0, 0);
const P = (text) => parseTranscriptTasks(text, { now: NOW });

describe('normalizeTranscript', () => {
  it.each([
    ['call mom at 3 p.m.', 'call mom at 3 pm'],
    ['standup at 9 A.M.', 'standup at 9 am'],
    ['gym hashtag fitness tomorrow', 'gym #fitness tomorrow'],
    ['gym hash tag fitness', 'gym #fitness'],
    ['Buy milk.', 'Buy milk'],
    ['Really?!', 'Really'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTranscript(input)).toBe(expected);
  });
});

describe('parseTranscriptTasks', () => {
  it('parses the spoken headline phrase end to end', () => {
    const [task] = P('remind me to see the dentist tomorrow at 3 p.m. every 2 weeks');
    expect(task).toMatchObject({
      title: 'See the dentist',
      date: '2026-07-28',
      time: '15:00',
      recurrence: { type: 'biweekly' },
      recurrenceDisplay: 'Every 2 weeks',
    });
  });

  it.each([
    ['add a task to buy milk', 'Buy milk'],
    ['add task call the bank', 'Call the bank'],
    ['create a new task to water plants', 'Water plants'],
    ['new task: email Sam', 'Email Sam'],
    ['remember to stretch', 'Stretch'],
    ['please remind me to breathe', 'Breathe'],
  ])('strips lead-in: %s → %s', (text, title) => {
    expect(P(text)[0].title).toBe(title);
  });

  it('keeps an utterance that is ONLY a lead-in-looking phrase', () => {
    // "task" alone would strip to nothing → falls back to the utterance
    const [task] = P('task');
    expect(task.title).toBe('Task');
  });

  it('anchors a bare time to today', () => {
    const [task] = P('call mom at 3pm');
    expect(task).toMatchObject({ title: 'Call mom', date: '2026-07-27', time: '15:00' });
  });

  it('anchors a bare recurrence to today', () => {
    const [task] = P('water the plants every morning');
    expect(task).toMatchObject({
      date: '2026-07-27',
      time: '09:00', // implied by "every morning"
      recurrence: { type: 'daily' },
    });
  });

  it('no date and no time → inbox-shaped (date null)', () => {
    const [task] = P('buy milk');
    expect(task).toMatchObject({ title: 'Buy milk', date: null, time: null, duration: 30 });
  });

  it('extracts tags into the array and out of the title', () => {
    const [task] = P('gym hashtag fitness tomorrow morning');
    expect(task.tags).toEqual(['fitness']);
    expect(task.title).toBe('Gym');
    expect(task).toMatchObject({ date: '2026-07-28', time: '09:00' });
  });

  it('time range sets time + duration', () => {
    const [task] = P('deep work friday 9-11am');
    expect(task).toMatchObject({ date: '2026-07-31', time: '09:00', duration: 120 });
  });

  it('explicit duration wins', () => {
    const [task] = P('review PRs tomorrow for 45 min');
    expect(task).toMatchObject({ date: '2026-07-28', duration: 45 });
  });

  it('returns [] for empty input', () => {
    expect(P('')).toEqual([]);
    expect(P('   ')).toEqual([]);
  });

  it('is deterministic', () => {
    expect(P('dentist tomorrow 3pm')).toEqual(P('dentist tomorrow 3pm'));
  });
});
