import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { dateToString } from '../utils/taskUtils.js';
import DayKeyTasks from './DayKeyTasks.jsx';

// The control is absent unless that day has starred tasks, which for most days
// is always. That is what keeps a third button out of an already tight header
// cell, so it is the case most worth pinning.

async function i18n() {
  const bundle = await loaders.en();
  const inst = i18next.createInstance();
  await inst.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const TODAY = dateToString(new Date());
const task = (over = {}) => ({ id: 't1', title: 'Write the report', date: TODAY, startTime: '09:00', ...over });

const render = async (tasks, extra = {}) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={{
      getTasksForDate: () => tasks,
      goToDate: vi.fn(), scrollToHour: vi.fn(), formatTime: (t) => t,
      darkMode: false, textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      ...extra,
    }}>
      <DayKeyTasks dateStr={TODAY} />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

describe('DayKeyTasks', () => {
  it('renders nothing when nothing is starred today', async () => {
    expect(await render([task(), task({ id: 't2' })])).toBe('');
  });

  it('renders nothing when there are no tasks at all', async () => {
    expect(await render([])).toBe('');
  });

  it('renders nothing without a day-planner provider', async () => {
    expect(renderToStaticMarkup(<DayKeyTasks dateStr={TODAY} />)).toBe('');
  });

  it('renders nothing without a date', async () => {
    const html = renderToStaticMarkup(
      <DayPlannerContext.Provider value={{ getTasksForDate: () => [task({ starredDate: TODAY })] }}>
        <DayKeyTasks />
      </DayPlannerContext.Provider>,
    );
    expect(html).toBe('');
  });

  it('appears with a count once today has starred tasks', async () => {
    const html = await render([task({ starredDate: TODAY }), task({ id: 't2', starredDate: TODAY }), task({ id: 't3' })]);
    expect(html).toContain('lucide-star');
    expect(html).toContain('>2<');
  });

  it('ignores a star left behind by a task that moved to another day', async () => {
    // starredDate is the day the star was FOR; the task is no longer on it.
    expect(await render([task({ date: '2026-01-01', starredDate: TODAY })])).toBe('');
  });

  it('ignores tasks starred for a different day', async () => {
    expect(await render([task({ date: '2026-01-01', starredDate: '2026-01-01' })])).toBe('');
  });

  // #2307: it reads the day as the calendar shows it, so a starred task of a
  // hidden project is not counted in the header beside the hidden card.
  it('reads the day through the calendar filter', async () => {
    const starred = [task({ starredDate: TODAY }), task({ id: 't2', starredDate: TODAY })];
    const html = await render(starred, { getCalendarTasksForDate: () => starred.slice(0, 1) });
    expect(html).toContain('>1<');
  });

  it('keeps the list closed until asked', async () => {
    const html = await render([task({ starredDate: TODAY })]);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Write the report');
  });
});

describe('DayKeyTasks is per-day, not per-today', () => {
  // The whole reason it moved out of the app header: a star belongs beside the
  // date it was made for, so WEEK's Tuesday column answers for Tuesday.
  const OTHER = '2026-11-03';

  const renderFor = async (dateStr, tasksByDate) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <DayPlannerContext.Provider value={{
        getTasksForDate: (d) => tasksByDate[dateStr] ?? [],
        goToDate: vi.fn(), scrollToHour: vi.fn(), formatTime: (t) => t,
        darkMode: false, textSecondary: 'text-stone-500', hoverBg: 'hover:bg-stone-100',
      }}>
        <DayKeyTasks dateStr={dateStr} />
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );

  it('counts the stars belonging to the day it was given', async () => {
    const html = await renderFor(OTHER, {
      [OTHER]: [
        { id: 'x1', title: 'Ship it', date: OTHER, startTime: '10:00', starredDate: OTHER },
        { id: 'x2', title: 'Other', date: OTHER, startTime: '12:00' },
      ],
    });
    expect(html).toContain('>1<');
    expect(html).toContain(`data-day-key-tasks="${OTHER}"`);
  });

  it('stays absent on a day whose tasks are starred for a different date', async () => {
    const html = await renderFor(OTHER, {
      [OTHER]: [{ id: 'x1', title: 'Ship it', date: OTHER, startTime: '10:00', starredDate: TODAY }],
    });
    expect(html).toBe('');
  });
});
