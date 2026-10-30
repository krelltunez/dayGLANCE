import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../../locales.js';
import MonthGrid, { monthCellLabel } from './MonthGrid.jsx';
import { tagKind } from '../../utils/monthCellLayout.js';
import { FIXTURE_DATE, busyDayItems } from '../../utils/monthCellLayout.fixture.js';

// Static markup, no DOM (same approach as DayDial.a11y.test.jsx). Measuring
// is a browser concern, so the grid is given a fixed area; the date math it
// maps onto cells is covered in utils/monthGrid.test.js.

async function i18nFor(language) {
  const bundle = await loaders[language]();
  const i18n = i18next.createInstance();
  await i18n.init({ lng: language, fallbackLng: false, resources: { [language]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return i18n;
}

// Real-shaped data: the busy-day fixture through agenda-core on the 16th, a
// deadline on the 3rd, a lone timed task on the 25th, nothing elsewhere.
const busy = busyDayItems();
const itemsForDate = (dateStr) => {
  if (dateStr === FIXTURE_DATE) return [...busy.agenda, ...tagKind(busy.routines, 'routine')];
  if (dateStr === '2026-09-03') return [{ id: 'deadline-9', kind: 'deadline', isAllDay: true, completed: false, date: dateStr }];
  if (dateStr === '2026-09-25') return [{ id: 't-25', title: 'Dentist', date: dateStr, startTime: '14:00', duration: 45, isAllDay: false, completed: false }];
  return [];
};

const render = (i18n, props = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={i18n}>
    <MonthGrid year={2026} month={9} itemsForDate={itemsForDate} weekStartDay={0} today="2026-09-16" width={1120} height={700} {...props} />
  </I18nextProvider>,
);
const count = (html, re) => (html.match(re) || []).length;
const attr = (html, name) => [...html.matchAll(new RegExp(`${name}="([^"]*)"`, 'g'))].map((m) => m[1]);

describe('MonthGrid', () => {
  it('renders September 2026 as five whole weeks with dimmed neighbours', async () => {
    const html = render(await i18nFor('en'));
    expect(html).toContain('data-month-grid="2026-09"');
    expect(count(html, /data-month-cell=/g)).toBe(35);
    const dates = attr(html, 'data-month-cell');
    expect(dates[0]).toBe('2026-08-30');
    expect(dates[34]).toBe('2026-10-03');
    expect(count(html, /data-in-month="false"/g)).toBe(5);
    expect(html).toContain('data-today="true"');
    expect(html).toMatch(/data-month-cell="2026-09-16" data-today="true"/);
  });

  it('follows the week-start setting in the header and the cells', async () => {
    const i18n = await i18nFor('en');
    const monday = render(i18n, { weekStartDay: 1 });
    const weekdayRow = monday.slice(monday.indexOf('<div data-month-grid-weekdays'), monday.indexOf('<div data-month-grid-area'));
    expect(weekdayRow.replace(/<[^>]+>/g, ' ').trim().split(/\s+/)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(attr(monday, 'data-month-cell')[0]).toBe('2026-08-31');
    expect(count(monday, /data-month-cell=/g)).toBe(35);
  });

  it('gives a six-row month six rows', async () => {
    const html = render(await i18nFor('en'), { month: 8 });
    expect(count(html, /data-month-cell=/g)).toBe(42);
    expect(html).toContain('data-month-grid="2026-08"');
  });

  it('draws real-shaped data into the right cells', async () => {
    const html = render(await i18nFor('en'));
    const cellOf = (d) => { const i = html.indexOf(`data-month-cell="${d}"`); return html.slice(i, html.indexOf('data-month-cell=', i + 1) > 0 ? html.indexOf('data-month-cell=', i + 1) : undefined); };
    const busyCell = cellOf('2026-09-16');
    expect(count(busyCell, /data-band=/g)).toBe(9);
    expect(count(busyCell, /data-routine=/g)).toBe(6);
    expect(count(busyCell, /data-point=/g)).toBe(1);
    expect(count(busyCell, /data-allday-marker=/g)).toBe(2);
    expect(busyCell).toContain('data-kind="event"');
    expect(cellOf('2026-09-03')).toContain('data-allday-marker="deadline-9" data-kind="deadline"');
    expect(count(cellOf('2026-09-25'), /data-band=/g)).toBe(1);
    expect(count(cellOf('2026-09-10'), /data-band=|data-point=|data-allday-marker=/g)).toBe(0);
    expect(html).not.toContain('Dentist');
  });

  it('sizes cells from the area and gives wide cells a gutter, narrow cells none', async () => {
    const i18n = await i18nFor('en');
    const wide = render(i18n);
    expect(wide).toContain('grid-template-columns:repeat(7, 138px)');
    expect(count(wide, /data-month-cell-gutter/g)).toBe(35);
    const phone = render(i18n, { width: 371, height: 480 });
    expect(phone).toContain('grid-template-columns:repeat(7, 53px)');
    expect(phone).not.toContain('data-month-cell-gutter');
    expect(phone).toContain('data-month-cell-allday-row');
  });

  it('caps cell width on a very wide area instead of stretching', async () => {
    const tall = render(await i18nFor('en'), { width: 2560, height: 1250 });
    expect(tall).toContain('grid-template-columns:repeat(7, 200px)');
    const short = render(await i18nFor('en'), { width: 2560, height: 700 });
    expect(short).toContain('grid-template-columns:repeat(7, 138px)');
  });

  it('highlights exactly the selected day, and none without a selection', async () => {
    const i18n = await i18nFor('en');
    const none = render(i18n);
    expect(none).not.toContain('data-selected');
    const html = render(i18n, { selectedDate: '2026-10-02' }); // a trailing cell of September's grid
    expect(count(html, /data-selected="true"/g)).toBe(1);
    expect(html).toMatch(/data-month-cell="2026-10-02"[^>]*data-selected="true"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-month-cell="2026-10-02"[^>]*class="[^"]*ring-2 ring-inset ring-brand/); // dayGLANCE orange
  });

  it('gives every cell a localized accessible label and carries no header of its own', async () => {
    const en = render(await i18nFor('en'));
    expect(en).toContain('aria-label="Wednesday, September 16, Today: 6 events, 6 tasks, 6 routines"');
    expect(en).toContain('aria-label="Thursday, September 3: 1 deadline"');
    expect(en).toContain('aria-label="Thursday, September 10: Nothing scheduled"');
    // The app chrome pages months and names the month; the grid draws only cells and weekdays.
    expect(en).not.toContain('data-month-grid-title');
    expect(en).not.toContain('<h2');
    const de = render(await i18nFor('de'));
    expect(de).toContain('aria-label="Donnerstag, 3. September: 1 Frist"');
    expect(de).toContain('aria-label="Mittwoch, 16. September, Heute:');
  });

  it('builds labels with plural forms', async () => {
    const { t } = await i18nFor('en');
    expect(monthCellLabel('2026-09-25', itemsForDate('2026-09-25'), false, t, 'en')).toBe('Friday, September 25: 1 task');
    expect(monthCellLabel('2026-09-25', [], false, t, 'en')).toBe('Friday, September 25: Nothing scheduled');
  });

  // MUTATION: count a Do as a task and one task done in three sessions reads
  // as three tasks.
  it('counts recorded sessions on a past day as sessions, not tasks', async () => {
    const { t } = await i18nFor('en');
    const session = (id, startTime) => ({ id, title: 'Deep work', date: '2026-09-25', startTime, duration: 60, isAllDay: false, completed: false, joboDo: true });
    const items = [session('d1', '09:00'), session('d2', '11:00'), session('d3', '14:00'), { id: 't', title: 'Call', date: '2026-09-25', startTime: '16:00', duration: 15, isAllDay: false, completed: true }];
    expect(monthCellLabel('2026-09-25', items, false, t, 'en')).toBe('Friday, September 25: 1 task, 3 recorded sessions');
    const pl = await i18nFor('pl');
    expect(monthCellLabel('2026-09-25', items.slice(0, 3), false, pl.t, 'pl')).toMatch(/3 zapisane sesje$/);
  });
});
