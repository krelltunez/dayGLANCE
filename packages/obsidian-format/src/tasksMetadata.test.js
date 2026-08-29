import { describe, it, expect } from 'vitest';
import { splitTasksMetadata, reattachTasksMetadata } from './tasksMetadata.js';

// The trailing-run grammar and its two invariants: the split is byte-exact
// (text + metaText === input, always — the retitle-carry's losslessness),
// and the run is TRAILING-ONLY (mid-title emoji never parse as metadata).

const F = (input) => splitTasksMetadata(input);

describe('byte-exact split', () => {
  const cases = [
    'Call dentist 📅 2026-09-10',
    'Standup ⏳ 2026-09-05 ⏫',
    'Ship it 🛫 2026-09-01 📅 2026-09-15 🔁 every 2 weeks on Monday',
    'Pay rent [due:: 2026-09-01] [priority:: high]',
    'Water plants 🔁️ every 3 days ⏳️ 2026-09-04',
    'Review [scheduled:: 2026-09-08] [repeat:: every month] [x-custom:: keep me]',
    'Weird  spacing 📅 2026-09-10',
  ];
  for (const input of cases) {
    it(`"${input}"`, () => {
      const { text, metaText } = F(input);
      expect(text + metaText).toBe(input);
      expect(metaText.length).toBeGreaterThan(0);
      expect(text.trim().length).toBeGreaterThan(0);
    });
  }

  it('no metadata → whole input is text, metaText empty', () => {
    expect(F('Just a task')).toEqual({
      text: 'Just a task', metaText: '',
      fields: { due: null, scheduled: null, priority: null, recurrence: false },
    });
  });
});

describe('field mapping', () => {
  it('due: emoji and dataview forms', () => {
    expect(F('T 📅 2026-09-10').fields.due).toBe('2026-09-10');
    expect(F('T 📅️ 2026-09-10').fields.due).toBe('2026-09-10'); // variation selector
    expect(F('T [due:: 2026-09-10]').fields.due).toBe('2026-09-10');
  });

  it('scheduled: emoji and dataview forms', () => {
    expect(F('T ⏳ 2026-09-05').fields.scheduled).toBe('2026-09-05');
    expect(F('T ⏳️ 2026-09-05').fields.scheduled).toBe('2026-09-05');
    expect(F('T [scheduled:: 2026-09-05]').fields.scheduled).toBe('2026-09-05');
  });

  it('priority collapse: {🔺,⏫}→3, 🔼→2, {🔽,⏬}→1 — and the dataview words', () => {
    expect(F('T 🔺').fields.priority).toBe(3);
    expect(F('T ⏫').fields.priority).toBe(3);
    expect(F('T 🔼').fields.priority).toBe(2);
    expect(F('T 🔽').fields.priority).toBe(1);
    expect(F('T ⏬').fields.priority).toBe(1);
    expect(F('T [priority:: highest]').fields.priority).toBe(3);
    expect(F('T [priority:: High]').fields.priority).toBe(3);
    expect(F('T [priority:: medium]').fields.priority).toBe(2);
    expect(F('T [priority:: lowest]').fields.priority).toBe(1);
    expect(F('T plain').fields.priority).toBe(null);
  });

  it('recurrence recognized (🔁 with free rule text, and [repeat::]) — flag only, rule text preserved in metaText', () => {
    const r = F('T 🔁 every 2 weeks on Monday');
    expect(r.fields.recurrence).toBe(true);
    expect(r.text).toBe('T');
    expect(r.metaText).toContain('every 2 weeks on Monday');
    expect(F('T [repeat:: every month]').fields.recurrence).toBe(true);
    expect(F('T 🔁 every day 📅 2026-09-10').fields).toMatchObject({ recurrence: true, due: '2026-09-10' });
  });

  it('unknown dataview keys and 🛫/➕/❌ dates: display-stripped, mapped to nothing', () => {
    const r = F('T 🛫 2026-09-01 ➕ 2026-08-01 [x-custom:: v] [id:: abc]');
    expect(r.text).toBe('T');
    expect(r.fields).toEqual({ due: null, scheduled: null, priority: null, recurrence: false });
    expect(r.metaText).toContain('[x-custom:: v]');
  });

  it('a non-trailing ✅ or [completion::] inside the run is display-stripped but NOT mapped (completedAt stays #1470ʼs channel)', () => {
    const r = F('T ✅ 2026-09-02 📅 2026-09-10');
    expect(r.text).toBe('T');
    expect(r.fields.due).toBe('2026-09-10');
    expect(r.fields).not.toHaveProperty('completedAt');
    expect(F('T [completion:: 2026-09-02] [due:: 2026-09-10]').text).toBe('T');
  });
});

describe('trailing-only discipline', () => {
  it('mid-title signifiers are title text, not metadata', () => {
    const input = 'Ship the 📅 2026-09-01 build tomorrow';
    expect(F(input)).toMatchObject({ text: input, metaText: '' });
  });

  it('a line that is ONLY metadata keeps its text as the title (no empty display)', () => {
    const input = '📅 2026-09-10';
    expect(F(input)).toMatchObject({ text: input, metaText: '' });
  });

  it('prose after a signifier breaks the run for everything before it', () => {
    const r = F('T ⏳ 2026-09-05 then call 📅 2026-09-10');
    expect(r.fields.scheduled).toBe(null); // ⏳ is mid-title here
    expect(r.fields.due).toBe('2026-09-10');
    expect(r.text).toBe('T ⏳ 2026-09-05 then call');
  });
});

describe('reattachTasksMetadata — the one comparison/carry space', () => {
  it('display + metadata-from-rawTitle reproduces the full line space', () => {
    const raw = 'Old name ⏳ 2026-09-05 ⏫ [x:: v]';
    const { text, metaText } = F(raw);
    expect(reattachTasksMetadata(text, raw)).toBe(raw); // identity when unrenamed
    expect(reattachTasksMetadata('New name', raw)).toBe(`New name${metaText}`);
  });

  it('no metadata → display passes through untouched (typed-in metadata included, imported on next scan)', () => {
    expect(reattachTasksMetadata('New name', 'Old name')).toBe('New name');
    expect(reattachTasksMetadata('New name 📅 2026-09-09', 'Old name')).toBe('New name 📅 2026-09-09');
  });

  it('IDEMPOTENT: an old-style display title still carrying metadata gets it REPLACED, never doubled', () => {
    // The mixed-window hazard: pre-upgrade titles include the run. Doubling
    // it would make every such task compare as permanently renamed.
    const raw = 'Task ⏳ 2026-09-05 ⏫';
    expect(reattachTasksMetadata('Task ⏳ 2026-09-05 ⏫', raw)).toBe(raw);
    expect(reattachTasksMetadata(reattachTasksMetadata('Task', raw), raw)).toBe(raw);
  });
});
