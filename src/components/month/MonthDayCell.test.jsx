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

  it('separates events from tasks by more than colour: events are hatched and outlined', () => {
    const html = render({ items: [event('e', '09:00', 60), task('t', '10:00', 60)] });
    const eventMarkup = html.slice(html.indexOf('data-band="e"'), html.indexOf('data-band="t"'));
    expect(eventMarkup).toMatch(/fill="url\(#mdc-hatch-/);
    expect(eventMarkup).toContain('stroke-gray-500');
    const taskMarkup = html.slice(html.indexOf('data-band="t"'));
    expect(taskMarkup).not.toMatch(/fill="url\(#/);
    expect(html).toContain('<pattern id="mdc-hatch-');
  });

  it('renders a point item as a hollow diamond, not a band', () => {
    const html = render({ items: [task('p', '11:00', 0)] });
    expect(html).toContain('data-point="p" data-kind="task"');
    expect(html).not.toContain('data-band=');
    expect(html).toMatch(/data-point="p"[^>]*d="M[\d.]+,[\d.]+ L/);
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
    expect(visibleText(html)).toBe('16+1');
    expect(count(html, /data-band=/g)).toBe(3);
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

  it('marks today and dims days outside the month', () => {
    expect(render({ items: [], isToday: true })).toContain('data-today="true"');
    expect(render({ items: [], isToday: true })).toContain('bg-blue-600 text-white');
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
