import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import DialComplications, {
  COMPLICATION_MIN_DIAL_PX, COMPLICATION_SIZES, COMPLICATION_SLOTS, complicationSize,
} from './DialComplications.jsx';

// The complication slots' contract. The component takes the dial's measured
// size as a prop, so this can pin the size gate down without a DOM — the
// same renderToStaticMarkup approach the rest of the dial's tests use.

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: language, fallbackLng: false,
    resources: { [language]: { translation: bundle } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

const habit = { id: 'h1', name: 'Water', type: 'doMore', target: 8, color: 'blue', icon: 'Droplets' };
const items = [
  { key: 'inbox', kind: 'inbox', count: 7, items: [{ id: 'u1', title: 'Call the plumber' }] },
  { key: 'deadlines', kind: 'deadlines', count: 2, items: [] },
  { key: 'habit:h1', kind: 'habit', habit, count: 5 },
];

const doneItem = (over = {}) => ({
  key: 'done', kind: 'done', doneMinutes: 120, totalMinutes: 180,
  fraction: 120 / 180, remaining: [{ id: 'r1', title: 'Team sync', startTime: '14:00' }], ...over,
});

const render = (i18n, props = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DialComplications
      items={items}
      dialPx={800}
      onOpenTask={() => {}}
      onSetHabitCount={() => {}}
      {...props}
    />
  </I18nextProvider>,
);

describe('DialComplications — the done subdial', () => {
  it('shows the percentage, and rings it rather than arcing the face', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, { items: [doneItem()] });
    // A subdial, not an arc on the ring: angle means time of day everywhere
    // else on this face, so a sweep encoding a fraction would read as hours.
    expect(html).toContain('>67<');
    expect(html).toContain('aria-label="Done: 67%, 120 of 180 minutes"');
    // The ring is a dash-offset circle inside the slot, not a sector path.
    expect(html).toContain('stroke-dashoffset');
    expect(html).not.toContain('#22c55e');   // not met yet
  });

  it('turns green only once everything scheduled is done', async () => {
    const i18n = await i18nFor('en');
    const met = render(i18n, {
      items: [doneItem({ doneMinutes: 180, fraction: 1, remaining: [] })],
    });
    expect(met).toContain('#22c55e');
    // "100" is the one three-digit value and it measures 50px inside a 53px
    // ring — jammed against the stroke. At target the ring is already full
    // and green, so a check says it without the cramping, and the figure
    // stays in the accessible name for anyone reading it out.
    expect(met).not.toContain('>100<');
    expect(met).toContain('aria-label="Done: 100%, 180 of 180 minutes"');
    // Every other value still prints as a number.
    expect(render(i18n, { items: [doneItem()] })).toContain('>67<');
  });

  it('rings it at the habit rings\' own proportions', async () => {
    const i18n = await i18nFor('en');
    // HabitRing draws radius 0.38 of its box at stroke 3 (HabitRing.jsx), and
    // the two sit on the same face — matching keeps them one object rather
    // than two. Flush with the disc's edge instead, which is where this
    // started, the ring crowds the caption underneath it.
    for (const size of COMPLICATION_SIZES) {
      const html = render(i18n, { items: [doneItem()], dialPx: size.minDialPx });
      expect(html).toContain(`r="${size.dot * 0.38}"`);
      expect(html).toContain('stroke-width="3"');
    }
  });

  it('never reads an empty day as finished', async () => {
    const i18n = await i18nFor('en');
    // 0 of 0 minutes is 0%, not 100% — nothing was completed.
    const html = render(i18n, {
      items: [doneItem({ doneMinutes: 0, totalMinutes: 0, fraction: 0, remaining: [] })],
    });
    expect(html).toContain('>0<');
    expect(html).not.toContain('#22c55e');
  });
});

describe('DialComplications — Aligned and project rings', () => {
  const alignedItem = (over = {}) => ({
    key: 'aligned', kind: 'aligned', alignedMinutes: 90, totalMinutes: 210,
    fraction: 90 / 210,
    byProject: [{ id: 'p1', title: 'Billing Integration', minutes: 60 },
      { id: 'p2', title: 'API Documentation', minutes: 30 }],
    unaligned: [{ id: 'u1', title: 'Catch-up call' }],
    ...over,
  });
  const projectItem = (over = {}) => ({
    key: 'project:p1', kind: 'project', project: { id: 'p1', title: 'Billing Integration' },
    done: 3, total: 9, fraction: 3 / 9,
    remaining: [{ id: 'r1', title: 'Handle webhook retries', deadline: '2026-07-09' }],
    ...over,
  });

  it('draws Aligned as the same ring as Done, on the same denominator', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, { items: [alignedItem()] });
    expect(html).toContain('>43<');
    expect(html).toContain('aria-label="Aligned: 43%, 90 of 210 minutes on a project"');
    expect(html).toContain('stroke-dashoffset');
    for (const size of COMPLICATION_SIZES) {
      const at = render(i18n, { items: [alignedItem()], dialPx: size.minDialPx });
      expect(at).toContain(`r="${size.dot * 0.38}"`);
    }
  });

  it('never reads an empty day as fully aligned', async () => {
    // 0 of 0 minutes is 0%: nothing was pointed anywhere.
    const html = await i18nFor('en').then((i18n) => render(i18n, {
      items: [alignedItem({ alignedMinutes: 0, totalMinutes: 0, fraction: 0, byProject: [], unaligned: [] })],
    }));
    expect(html).toContain('>0<');
    expect(html).not.toContain('#22c55e');
  });

  it('carries the project name as its own caption', async () => {
    const html = render(await i18nFor('en'), { items: [projectItem()] });
    expect(html).toContain('>33<');
    expect(html).toContain('Billing Integration');
    expect(html).toContain('aria-label="Billing Integration: 33%, 3 of 9 tasks"');
  });

  it('turns green when the project is finished, like Done', async () => {
    const html = render(await i18nFor('en'), {
      items: [projectItem({ done: 9, fraction: 1, remaining: [] })],
    });
    expect(html).toContain('#22c55e');
    expect(html).not.toContain('>100<');
  });

  it('keeps a project with no tasks at zero rather than complete', async () => {
    const html = render(await i18nFor('en'), {
      items: [projectItem({ done: 0, total: 0, fraction: 0, remaining: [] })],
    });
    expect(html).toContain('>0<');
    expect(html).not.toContain('#22c55e');
  });
});

describe('DialComplications — slots are held, not packed', () => {
  const r = 800 / 2;
  // Both coordinates, because slots 0 and 2 share a `left` and 1 and 3 share
  // theirs — matching on one alone cannot tell a corner from the one below it.
  const styleOf = (slot) => `left:calc(50% + ${slot.x * r}px);top:calc(50% + ${slot.y * r}px)`;
  const slotOf = (html, label) => {
    const at = html.indexOf(label);
    if (at === -1) return -1;
    // The slot whose position is the last one emitted before the label.
    const before = COMPLICATION_SLOTS
      .map((slot, i) => ({ i, at: html.indexOf(styleOf(slot)) }))
      .filter((x) => x.at !== -1 && x.at < at);
    return before.length ? before.sort((a, b) => b.at - a.at)[0].i : -1;
  };

  it('leaves a corner empty rather than moving the readouts after it', async () => {
    const i18n = await i18nFor('en');
    // What paging a day does: the inbox has no notion of a date and a habit
    // count is today's tally, so both blank out. Done and Deadlines must not
    // move house because of it.
    expect(slotOf(render(i18n, { items }), 'aria-label="Deadlines: 2"')).toBe(1);
    const paged = render(i18n, { items: [null, items[1], null] });
    expect(slotOf(paged, 'aria-label="Deadlines: 2"')).toBe(1);
    expect(paged).not.toContain('aria-label="Inbox: 7"');
  });

  it('keeps the last slot in place when an earlier one blanks', async () => {
    const i18n = await i18nFor('en');
    expect(slotOf(render(i18n, { items }), 'aria-label="Water: 5 of 8"')).toBe(2);
    expect(slotOf(render(i18n, { items: [null, null, items[2]] }), 'aria-label="Water: 5 of 8"'))
      .toBe(2);
  });

  it('draws nothing at all when every slot is blank', async () => {
    expect(render(await i18nFor('en'), { items: [null, null, null, null] })).toBe('');
  });
});

describe('DialComplications', () => {
  it('puts each complication in its own corner slot', async () => {
    const html = render(await i18nFor('en'));
    expect(html).toContain('aria-label="Inbox: 7"');
    expect(html).toContain('aria-label="Deadlines: 2"');
    // The habit is the app's own HabitRing, so it carries that component's
    // count label rather than a name — but it says who it is to AT.
    expect(html).toContain('5/8');
    expect(html).not.toContain('>Water<');
    expect(html).toContain('aria-label="Water: 5 of 8"');

    // Slots are placed off the dial's radius, not the container's box.
    const r = 800 / 2;
    expect(html).toContain(`calc(50% + ${COMPLICATION_SLOTS[0].x * r}px)`);
  });

  it('never shows more than the four slots', async () => {
    const five = [...items, { key: 'x', kind: 'inbox', count: 1, items: [] },
      { key: 'y', kind: 'deadlines', count: 1, items: [] }];
    const html = render(await i18nFor('en'), { items: five });
    // One `left:calc(...)` per rendered slot (each also has a `top:`).
    expect((html.match(/left:calc/g) || [])).toHaveLength(COMPLICATION_SLOTS.length);
  });

  it('stays off a face too small to carry it', async () => {
    const i18n = await i18nFor('en');
    // A phone dial is ~385px across; four corner readouts there would sit on
    // the hub's own text.
    expect(render(i18n, { dialPx: COMPLICATION_MIN_DIAL_PX - 1 })).toBe('');
    expect(render(i18n, { dialPx: COMPLICATION_MIN_DIAL_PX })).not.toBe('');
    // And before the parent has measured anything.
    expect(render(i18n, { dialPx: null })).toBe('');
    expect(render(i18n, { items: [] })).toBe('');
  });

  it('grows the readouts with the face, in three steps', async () => {
    const i18n = await i18nFor('en');
    const [sm, md, lg] = COMPLICATION_SIZES;
    // The tier is chosen from the dial's measured diameter, not a viewport
    // breakpoint: the same window gives the dial very different sizes
    // depending on what else is on screen.
    expect(complicationSize(sm.minDialPx - 1)).toBe(null);
    expect(complicationSize(sm.minDialPx)).toBe(sm);
    expect(complicationSize(md.minDialPx - 1)).toBe(sm);
    expect(complicationSize(md.minDialPx)).toBe(md);
    expect(complicationSize(lg.minDialPx)).toBe(lg);
    expect(complicationSize(lg.minDialPx + 400)).toBe(lg);
    expect(complicationSize(null)).toBe(null);

    // And the tier actually reaches the markup, for both kinds of slot.
    for (const size of COMPLICATION_SIZES) {
      const html = render(i18n, { dialPx: size.minDialPx });
      expect(html).toContain(`width:${size.dot}px`);          // the count subdial
      expect(html).toContain(`width="${size.dot}"`);          // the habit ring
      expect(html).toContain(size.count);
    }
  });

  it('dresses a count as a recessed subdial', async () => {
    const html = render(await i18nFor('en'));
    // A hairline rim and an inset shadow — the chronograph reading, and what
    // separates a count from the flat text it used to be.
    expect(html).toContain('rounded-full border border-white/10');
    expect(html).toContain('inset 0 1px 1px');
  });

  it('holds the habit ring back from the now-line\'s brightness', async () => {
    const html = render(await i18nFor('en'));
    // The ring paints a saturated brand colour that belongs in a sidebar,
    // not on a face whose brightest element must be the orange now-line.
    expect(html).toContain('opacity-65');
    expect(html).toContain('saturate-[.45]');
    expect(html).toContain('hover:saturate-100');
  });

  it('localizes its labels', async () => {
    const i18n = await i18nFor('de');
    const html = render(i18n);
    expect(html).toContain(`aria-label="${i18n.t('dial.inbox')}: 7"`);
    expect(html).toContain(i18n.t('dial.deadlines'));
  });
});
