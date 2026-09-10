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

  it('localizes the listbox name and the option labels', async () => {
    const i18n = await i18nFor('de');
    const html = render(i18n, { dayTasks: [task({ completed: true })] });
    expect(html).toContain(`aria-label="${i18n.t('dial.blockList')}"`);
    expect(options(html)[0].label).toBe('Deep work, 09:00 – 10:00, 1h, erledigt');
  });
});
