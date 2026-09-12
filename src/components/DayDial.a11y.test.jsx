import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import DayDial from './DayDial.jsx';

// The ring's accessibility contract. The wedges are inside an SVG that AT
// reads as one image, so the blocks carry their semantics in a parallel
// listbox (see DayDial.jsx) — this pins that markup down: one option per
// block, in time order, each with the id aria-activedescendant will name and
// a label that says everything the hub would.
//
// Static markup, not a DOM: this repo has no jsdom (same approach as
// GlanceLocalization.test.jsx), so the keyboard MOVES are tested as pure
// functions in utils/dayDial.test.js and the wiring they move through is
// tested here.

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

const task = (over = {}) => ({
  id: 1, title: 'Deep work', startTime: '09:00', duration: 60,
  isAllDay: false, completed: false, ...over,
});

const render = (i18n, props = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <DayDial
      dayTasks={[]}
      dayWindow={null}
      date={new Date('2026-09-09T12:00:00')}
      nowMin={9 * 60 + 30}
      formatTime={(hhmm) => hhmm}
      use24HourClock
      {...props}
    />
  </I18nextProvider>,
);

// <div role="option" id="…" aria-selected="…">label</div>, in document order.
const options = (html) => Array.from(
  html.matchAll(/<div id="([^"]*)" role="option" aria-selected="([^"]*)" class="sr-only">([^<]*)</g),
).map(([, id, selected, label]) => ({ id, selected, label }));

// The all-day pill's chip titles, in render order.
const allDayChips = (html) => Array.from(
  html.matchAll(/<span class="truncate max-w-\[8rem\]">([^<]*)</g),
).map(([, title]) => title);

describe('DayDial keyboard/AT contract', () => {
  it('exposes one labelled option per block, in time order', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, {
      dayTasks: [
        task({ id: 2, title: 'Team sync', startTime: '14:00', duration: 30 }),
        task({ id: 1, title: 'Deep work #focus', startTime: '09:00', duration: 90 }),
      ],
    });
    expect(options(html)).toEqual([
      { id: 'dial-opt-1', selected: 'false', label: 'Deep work #focus, 09:00 – 10:30, 1h 30m, 1h left' },
      { id: 'dial-opt-2', selected: 'false', label: 'Team sync, 14:00 – 14:30, 30m, in 4h 30m' },
    ]);
  });

  it('gives the ring one tab stop, named and empty-aware', async () => {
    const i18n = await i18nFor('en');
    const withBlocks = render(i18n, { dayTasks: [task()] });
    expect(withBlocks).toContain('role="listbox"');
    expect(withBlocks).toContain('aria-label="Schedule blocks"');
    expect(withBlocks).toContain('tabindex="0"');
    // Nothing to select yet, so no dangling aria-activedescendant.
    expect(withBlocks).not.toContain('aria-activedescendant');

    // A day with no timed blocks is not a tab stop at all.
    const empty = render(i18n, { dayTasks: [task({ isAllDay: true })] });
    expect(empty).toContain('tabindex="-1"');
    expect(options(empty)).toEqual([]);
  });

  it('says "completed" instead of the clock for a finished block', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, { dayTasks: [task({ completed: true })] });
    expect(options(html)[0].label).toBe('Deep work, 09:00 – 10:00, 1h, completed');
  });

  it('drops the relative phrase on a day with no now line', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, { dayTasks: [task()], nowMin: null, dayIsPast: true });
    expect(options(html)[0].label).toBe('Deep work, 09:00 – 10:00, 1h');
  });

  it('keeps option ids usable for any task id', async () => {
    const i18n = await i18nFor('en');
    // Recurring instances carry separators, and a title-derived id could
    // carry spaces — an HTML id tolerates everything but whitespace.
    const html = render(i18n, {
      dayTasks: [task({ id: 'recur-7::2026-09-09' }), task({ id: 'has space', startTime: '11:00' })],
    });
    expect(options(html).map((o) => o.id)).toEqual([
      'dial-opt-recur-7::2026-09-09',
      'dial-opt-has_space',
    ]);
  });

  it('speaks a block\'s true hours when it crosses midnight', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, {
      // 23:00 + 2h: the ring clips it at midnight, the label must not.
      dayTasks: [task({ id: 1, title: 'Late session', startTime: '23:00', duration: 120 })],
      // Last night's 22:00 + 4h still owns this morning's first two hours.
      prevDayTasks: [task({ id: 'y1', title: 'Night shift', startTime: '22:00', duration: 240 })],
    });
    expect(options(html).map((o) => o.label)).toEqual([
      'Night shift, 22:00 – 02:00, started the day before, 4h, ended 7h 30m ago',
      'Late session, 23:00 – 01:00, ends the next day, 2h, in 13h 30m',
    ]);
  });

  it('marks a block that ends exactly at midnight as landing the next day', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, {
      dayTasks: [task({ id: 1, title: 'Wind down', startTime: '23:00', duration: 60 })],
    });
    // 24:00 is not a time to print; it is the next day's 00:00.
    expect(options(html)[0].label).toBe('Wind down, 23:00 – 00:00, ends the next day, 1h, in 13h 30m');
  });

  it('keeps all-day items off the ring and out of its options', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, {
      dayTasks: [
        task({ id: 1 }),
        // An Obsidian date-only line arrives at 00:00; it must not become a
        // midnight wedge, nor a block the arrow keys walk onto.
        task({ id: 'a1', title: 'Labour Day', isAllDay: true, startTime: '00:00' }),
        task({ id: 'a2', title: 'Water the plants #home', isAllDay: true, startTime: null }),
      ],
    });
    expect(options(html).map((o) => o.id)).toEqual(['dial-opt-1']);
    // They live in their own pill instead, in the legend's grammar, with
    // #tags set aside exactly as the hub does it.
    expect(html).toContain('All Day');
    expect(allDayChips(html)).toEqual(['Labour Day', 'Water the plants']);
  });

  it('makes each all-day item its own button into the action sheet', async () => {
    const i18n = await i18nFor('en');
    const actionable = render(i18n, {
      dayTasks: [task({ id: 'a1', title: 'Labour Day', isAllDay: true })],
      onToggleComplete: () => {},
    });
    expect(actionable).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Labour Day/s);

    // With no handlers wired (a read-only host), the titles are plain text.
    const inert = render(i18n, {
      dayTasks: [task({ id: 'a1', title: 'Labour Day', isAllDay: true })],
    });
    expect(allDayChips(inert)).toEqual(['Labour Day']);
    expect(inert).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*Labour Day/s);
  });

  it('leaves the bottom band alone on a day with no all-day items', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, { dayTasks: [task()] });
    expect(html).not.toContain('All Day');
    expect(allDayChips(html)).toEqual([]);
    // No grid wrapper at all: the legend sits in the flow, centered as before.
    expect(html).not.toContain('minmax(0,1fr)');
  });

  it('splits the band on the dial\'s axis when all-day items are present', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, {
      dayTasks: [task(), task({ id: 'a1', title: 'Labour Day', isAllDay: true })],
    });
    // Two EQUAL tracks: that is what puts the seam between the pills on the
    // dial's vertical axis, each growing outward from under the 12. The
    // three-track fallback (centred legend) is for widths where the legend
    // cannot fit in half the band — never the default.
    expect(html).toContain('minmax(0,1fr) minmax(0,1fr)');
    expect(html).not.toContain('minmax(0,1fr) auto minmax(0,1fr)');
  });

  it('lets the arrow keys walk routines alongside blocks', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, {
      dayTasks: [task({ id: 1, title: 'Deep work', startTime: '09:00', duration: 60 })],
      routines: [
        { id: 'r1', name: 'Stretch', startTime: '06:45', duration: 15, isAllDay: false },
        { id: 'r2', name: 'Focus block', startTime: '14:30', duration: 120, isAllDay: false },
        // No hour, so no place on a clock — the planner keeps this one.
        { id: 'r3', name: 'No time set', startTime: null, duration: 15, isAllDay: true },
      ],
      routineCompletions: { r1: '2026-09-09' },
    });
    expect(options(html).map((o) => o.label)).toEqual([
      'Stretch, routine, 06:45 – 07:00, 15m, completed',
      'Deep work, 09:00 – 10:00, 1h, 30m left',
      'Focus block, routine, 14:30 – 16:30, 2h, in 5h',
    ]);
  });

  it('draws no routine track on a day without routines', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, { dayTasks: [task()], routines: null });
    expect(html).not.toContain('Routines');
    expect(options(html)).toHaveLength(1);
  });

  it('draws the daylight band under the schedule, and only when lit', async () => {
    const i18n = await i18nFor('en');
    const steps = [
      { startMin: 400, endMin: 404, opacity: 0.05 },
      { startMin: 404, endMin: 408, opacity: 0.2 },
    ];
    const html = render(i18n, { dayTasks: [task()], daylight: steps });
    // Each step is feathered into three concentric sub-bands, so its radial
    // edges fade instead of cutting: two paths per step at a third strength
    // and one at full.
    expect(html).toContain('fill="#fcd34d"');
    expect((html.match(/fill-opacity="0\.2"/g) || [])).toHaveLength(1);
    expect((html.match(/fill-opacity="0\.07"/g) || [])).toHaveLength(2); // 0.2 x 0.35, twice
    expect((html.match(/fill-opacity="0\.0175"/g) || [])).toHaveLength(2); // 0.05 x 0.35
    // Beneath the wedges: the band's group opens before the first block.
    expect(html.indexOf('#fcd34d')).toBeLessThan(html.indexOf('Deep work'));

    // A polar night, or no location at all, draws nothing.
    expect(render(i18n, { dayTasks: [task()], daylight: [] })).not.toContain('#fcd34d');
    expect(render(i18n, { dayTasks: [task()] })).not.toContain('#fcd34d');
  });

  it('rails the day\'s focus sessions inside the blocks they happened in', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, {
      dayTasks: [task()],
      focusSpans: [{ startMin: 540, endMin: 591 }, { startMin: 840, endMin: 870 }],
    });
    expect((html.match(/fill-opacity="0\.42"/g) || [])).toHaveLength(1); // one group
    expect((html.match(/A 315 315/g) || [])).toHaveLength(2);  // one arc per span
    // The rail sits INSIDE the schedule band (300-385) rather than beside
    // it, and clear of the wedge's own inner edge stroke at 300.
    expect(html).toContain('A 307 307');
    // And the total gets a home in the legend, kept out of the minute totals
    // above it (focus happens INSIDE those same blocks).
    expect(html).toContain('Focus');
    expect(html).toContain('1h 21m');

    expect(render(i18n, { dayTasks: [task()], focusSpans: [] })).not.toContain('fill-opacity="0.42"');
    expect(render(i18n, { dayTasks: [task()] })).not.toContain('>Focus<');
  });

  it('keeps the now line from swallowing taps on the blocks beneath it', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n, { dayTasks: [task()] });
    // The needle and its afterglow are painted OVER the wedges. Without this
    // the glow eats every tap for the hour behind now — which is exactly the
    // part of the running block someone reaches for.
    expect(html).toMatch(/<g pointer-events="none">(?:(?!<\/g>).)*#fe8b00/s);
  });

  it('measures the date off a hidden twin, and speaks the full month', async () => {
    const i18n = await i18nFor('en');
    const html = render(i18n);
    // Unmeasured (no layout in static markup), so the full date shows —
    // abbreviating a date that would have fitted is the worse failure.
    expect(html).toContain('September 9');
    // The twin the decision is measured from always carries the LONG form,
    // so an abbreviation that fits can never flip the answer back.
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*class="absolute invisible[^"]*"[^>]*>September 9</);
    // AT gets the month in full whichever form is drawn.
    expect(html).toContain('aria-label="Day dial: Wednesday September 9"');
  });

  it('localizes the listbox name and the option labels', async () => {
    const i18n = await i18nFor('de');
    const html = render(i18n, { dayTasks: [task({ completed: true })] });
    expect(html).toContain(`aria-label="${i18n.t('dial.blockList')}"`);
    expect(options(html)[0].label).toBe('Deep work, 09:00 – 10:00, 1h, erledigt');
  });
});
