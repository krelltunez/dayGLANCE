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

  it('localizes the listbox name and the option labels', async () => {
    const i18n = await i18nFor('de');
    const html = render(i18n, { dayTasks: [task({ completed: true })] });
    expect(html).toContain(`aria-label="${i18n.t('dial.blockList')}"`);
    expect(options(html)[0].label).toBe('Deep work, 09:00 – 10:00, 1h, erledigt');
  });
});
