import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import MonthDayCell from './MonthDayCell.jsx';
import { tagKind } from '../../utils/monthCellLayout.js';

// Static markup, no DOM (the repo has no jsdom). These pin what the cell
// RENDERS for each collection the layout returns; the geometry itself is
// step 1's and covered in utils/monthCellLayout.test.js.

const DATE = '2026-09-16';
const task = (id, startTime, duration, extra = {}) =>
  ({ id, title: `Title of ${id}`, date: DATE, startTime, duration, isAllDay: false, completed: false, ...extra });
const event = (id, startTime, duration, extra = {}) => task(id, startTime, duration, { imported: true, ...extra });
const render = (props) => renderToStaticMarkup(<MonthDayCell date={DATE} width={160} height={140} gutterWidth={16} {...props} />);
const count = (html, re) => (html.match(re) || []).length;
const visibleText = (html) => html.replace(/<[^>]+>/g, '').trim();

describe('MonthDayCell', () => {
  it('renders an empty day as just the date number', () => {
    const html = render({ items: [] });
    expect(html).toContain('data-month-cell="2026-09-16"');
    expect(html).toContain('data-month-cell-date');
    expect(visibleText(html)).toBe('16');
    expect(html).not.toContain('data-band=');
    expect(html).not.toContain('data-point=');
    expect(html).not.toContain('data-allday-marker=');
    expect(html).not.toContain('data-month-cell-overflow');
  });

  it('renders bands for events, tasks and routines, each tagged by kind', () => {
    const html = render({ items: [
      event('e', '09:00', 60), task('t', '10:00', 60),
      ...tagKind([{ id: 'r', name: 'Lunch', startTime: '12:00', duration: 60, isAllDay: false, completed: false }], 'routine'),
    ] });
    expect(html).toContain('data-band="e" data-kind="event"');
    expect(html).toContain('data-band="t" data-kind="task"');
    expect(html).toContain('data-band="r" data-kind="routine"');
    expect(count(html, /data-band=/g)).toBe(3);
  });

  it('separates events from tasks by more than colour: events carry a left-edge cap, tasks their own colour', () => {
    const html = render({ items: [event('e', '09:00', 60), task('t', '10:00', 60, { color: 'bg-purple-500' })] });
    const eventMarkup = html.slice(html.indexOf('data-band="e"'), html.indexOf('data-band="t"'));
    expect(eventMarkup).toContain('data-event-edge');
    expect(eventMarkup).toContain('fill-gray-400');
    const taskMarkup = html.slice(html.indexOf('data-band="t"'));
    expect(taskMarkup).not.toContain('data-event-edge');
    expect(taskMarkup).toContain('fill="#a855f7"');
    expect(taskMarkup).toContain('[fill-opacity:0.42]');
    expect(html).not.toContain('<pattern');
  });

  it('draws each task in its own colour, a gray task still told from an event by the cap', () => {
    const html = render({ items: [
      task('blue', '08:00', 30), task('red', '09:00', 30, { color: 'bg-red-500' }),
      task('native', '10:00', 30, { nativeCalendarColor: '#123456' }), task('gray', '11:00', 30, { color: 'bg-gray-500' }),
      event('ev', '12:00', 30),
    ] });
    const bandOf = (id) => { const i = html.indexOf(`data-band="${id}"`); return html.slice(i, html.indexOf('data-band=', i + 1) > 0 ? html.indexOf('data-band=', i + 1) : undefined); };
    expect(bandOf('blue')).toContain('fill="#3b82f6"');
    expect(bandOf('red')).toContain('fill="#ef4444"');
    expect(bandOf('native')).toContain('fill="#123456"');
    expect(bandOf('gray')).not.toContain('data-event-edge');
    expect(bandOf('ev')).toContain('data-event-edge');
  });

  it('rounds every band, point and mark, and insets bands uniformly from the cell edges', () => {
    const html = render({ items: [task('a', '09:00', 60), task('p', '11:00', 0), task('ad', null, null, { isAllDay: true })] });
    expect(html).toMatch(/data-band="a"[^>]*rx="[0-9.]+"/);
    expect(html).toMatch(/data-point="p"[^>]*rx="[0-9.]+"/);
    expect(html).toMatch(/data-allday-marker="ad"[^>]*rx="[0-9.]+"/);
    // The lane group is translated by the inset; a lone band starts at x=0 inside it
    // and spans the timeline width, which is the cell minus gutter minus two insets.
    expect(html).toMatch(/data-month-cell-lanes="true" transform="translate\(7, \d+\)"/);
    expect(html).toMatch(/data-band="a"[^>]*x="0"[^>]*width="130"/);
  });

  it('renders a point item as a hollow diamond, not a band', () => {
    const html = render({ items: [task('p', '11:00', 0)] });
    expect(html).toContain('data-point="p" data-kind="task"');
    expect(html).not.toContain('data-band=');
    expect(html).toMatch(/data-point="p"[^>]*transform="rotate\(45 /);
    expect(html).toMatch(/data-point="p"[^>]*fill-white dark:fill-gray-900/);
  });

  it('renders all-day items, deadlines included, as markers in the gutter in a fixed order', () => {
    const html = render({ items: [
      task('t-ad', null, null, { isAllDay: true }),
      { id: 'dl', kind: 'deadline', isAllDay: true, completed: false, date: DATE },
      task('e-ad', null, null, { isAllDay: true, imported: true }),
      ...tagKind([{ id: 'r-ad', name: 'Stretch', startTime: null, duration: null, isAllDay: true, completed: false }], 'routine'),
      task('timed', '09:00', 60),
    ] });
    const gutterStart = html.indexOf('data-month-cell-gutter');
    expect(gutterStart).toBeGreaterThan(-1);
    // The track is a hairline only: no full-height fill behind the marks.
    const gutterMarkup = html.slice(gutterStart, html.indexOf('data-band='));
    expect(gutterMarkup).toContain('<line');
    expect(gutterMarkup).not.toMatch(/<rect[^>]*fill-stone-100/);
    expect(html.slice(html.indexOf('data-allday-marker="e-ad"'), html.indexOf('data-allday-marker="t-ad"'))).toContain('data-event-edge');
    const order = [...html.matchAll(/data-allday-marker="([^"]+)" data-kind="([^"]+)"/g)].map((m) => m[2]);
    expect(order).toEqual(['deadline', 'event', 'task', 'routine']);
    expect(html.indexOf('data-allday-marker="dl"')).toBeGreaterThan(gutterStart);
    expect(html).toContain('data-band="timed"');
    expect(html).not.toContain('data-month-cell-allday-row');
  });

  it('draws the gutter only when the gutter width is nonzero, and moves all-day marks to the header otherwise', () => {
    const items = [task('ad', null, null, { isAllDay: true }), task('a', '09:00', 60)];
    const withGutter = render({ items, gutterWidth: 16 });
    expect(withGutter).toContain('data-month-cell-gutter');
    expect(withGutter).not.toContain('data-month-cell-allday-row');
    expect(withGutter).toContain('data-allday-marker="ad"');

    const noGutter = render({ items, gutterWidth: 0 });
    expect(noGutter).not.toContain('data-month-cell-gutter');
    expect(noGutter).toContain('data-month-cell-allday-row');
    expect(noGutter).toContain('data-allday-marker="ad"');
    expect(noGutter).toContain('data-band="a"');
  });

  it('shows the overflow count when the layout hides bands past the lane cap', () => {
    const html = render({ items: [task('a', '09:00', 60), task('b', '09:10', 50), task('c', '09:20', 40), task('d', '09:30', 30)] });
    expect(html).toContain('data-month-cell-overflow="+1"');
    expect(visibleText(html).split('').sort().join('')).toBe('+116');
    expect(count(html, /data-band=/g)).toBe(3);
  });

  it('scales the gutter and its marks with the cell', () => {
    const items = [task('ad', null, null, { isAllDay: true })];
    const small = render({ items, width: 96, height: 120, gutterWidth: undefined });
    const big = render({ items, width: 200, height: 200, gutterWidth: undefined });
    const markW = (html) => Number(html.match(/data-allday-marker="ad"[^>]*width="([\d.]+)"/)[1]);
    expect(markW(big)).toBeGreaterThan(markW(small));
    const gutterX = (html) => Number(html.match(/data-month-cell-gutter="true"><line x1="([\d.]+)"/)[1]);
    expect(96 - gutterX(small)).toBeLessThan(200 - gutterX(big));
  });

  it('counts all-day marks that do not fit into the overflow', () => {
    const many = Array.from({ length: 12 }, (_, i) => task(`ad${i}`, null, null, { isAllDay: true }));
    const html = render({ items: many, width: 40, height: 40, gutterWidth: 0 });
    expect(html).toMatch(/data-month-cell-overflow="\+\d+"/);
    expect(count(html, /data-allday-marker=/g)).toBeLessThan(12);
  });

  it('never renders item text', () => {
    const html = render({ items: [event('e', '09:00', 60), task('t', '10:00', 60), task('p', '11:00', 0), task('ad', null, null, { isAllDay: true })] });
    expect(html).not.toContain('Title of');
    expect(visibleText(html)).toBe('16');
  });

  it('marks today with a soft rounded square and dims days outside the month', () => {
    const today = render({ items: [], isToday: true });
    expect(today).toContain('data-today="true"');
    expect(today).toMatch(/data-month-cell-date[^>]*rounded-md[^>]*bg-blue-100 text-blue-800/);
    expect(today).not.toContain('rounded-full');
    expect(today).not.toContain('bg-blue-600');
    expect(render({ items: [] })).not.toContain('data-today');
    expect(render({ items: [], inMonth: false })).toContain('opacity-40');
    expect(render({ items: [], inMonth: false })).toContain('data-in-month="false"');
  });

  it('is one button with an accessible name, and nothing inside it is interactive', () => {
    const html = render({ items: [task('a', '09:00', 60)], label: 'Wednesday 16 September, 1 task' });
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-label="Wednesday 16 September, 1 task"');
    expect(count(html, /<button/g)).toBe(1);
    expect(html).not.toMatch(/<a /);
    expect(render({ items: [] })).toContain('aria-label="2026-09-16"');
  });
});
