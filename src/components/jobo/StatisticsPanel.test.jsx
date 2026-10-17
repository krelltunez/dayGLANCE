import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import StatisticsPanel from './StatisticsPanel.jsx';
import { createDoRecord } from '../../jobo/core.js';
import { buildStatisticsDayReport, buildStatisticsReports } from '../../jobo/checkStatistics.js';

vi.mock('react-dom', async original => ({ ...await original(), createPortal: children => children }));
afterEach(() => vi.unstubAllGlobals());
const locales = ['en', 'zh-CN', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'];
const bundle = lng => JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/translation.json`, import.meta.url), 'utf8'));
const date = '2026-09-28';
const record = createDoRecord({ id: 'r1', taskId: null, title: 'Work', source: 'manual', progress: 'partial',
  timing: 'timed', date, startTime: '09:00', endDate: date, endTime: '10:00', planSnapshot: null,
  createdAt: `${date}T09:00:00Z`, updatedAt: `${date}T09:00:00Z`, observedAt: `${date}T09:00:00Z` });
async function render(lng = 'en', overrides = {}) {
  vi.stubGlobal('document', { body: {} });
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: bundle(lng) } }, interpolation: { escapeValue: false } });
  const buildReports = vi.fn(days => days.map(day => buildStatisticsDayReport({ date: day, records: [record] })));
  const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><StatisticsPanel anchorDate={date}
    weekDates={[date]} evidenceDates={[date]} buildReports={buildReports} loaded onClose={vi.fn()} {...overrides} /></I18nextProvider>);
  return { html, buildReports, t: i18n.t.bind(i18n) };
}

describe('Statistics panel with real reports', () => {
  it.each(locales)('renders translated statistics with scope details available on hover in %s', async lng => {
    const { html, t, buildReports } = await render(lng);
    expect(buildReports).toHaveBeenCalledWith([date], 'day');
    expect(html.match(/data-jobo-statistics-scope=/g)).toHaveLength(4);
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html.match(/aria-controls=/g)).toHaveLength(4);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(3);
    expect(html).toContain('role="tabpanel" aria-labelledby=');
    expect(html).toContain(t('jobo.statistics.taskScope'));
    expect(html).toContain(t('jobo.statistics.noDo'));
    expect(html).not.toContain(t('jobo.check.notStarted'));
    expect(html).toContain(t('jobo.statistics.timingScope'));
    const visibleText = html.replace(/<[^>]+>/g, '');
    for (const key of ['taskScope', 'timingScope', 'allTimeScope']) {
      expect(html).toContain(t(`jobo.statistics.${key}`));
      expect(visibleText).not.toContain(t(`jobo.statistics.${key}`));
    }
    expect(html).not.toMatch(/jobo\.(statistics|stats)\.|\{\{|NaN|undefined|Infinity/);
    const copy = bundle(lng).jobo.statistics;
    expect(copy.noDo).toBe(bundle(lng).jobo.view.summary.notStarted);
    expect(copy).not.toHaveProperty('notStarted');
    expect(Object.keys(copy).sort()).toEqual(Object.keys(bundle('en').jobo.statistics).sort());
    for (const [key, value] of Object.entries(copy)) {
      expect(value).not.toContain('—');
      expect(value.match(/\{\{\w+\}\}/g) || []).toEqual(bundle('en').jobo.statistics[key].match(/\{\{\w+\}\}/g) || []);
      if (lng !== 'en') expect(value).not.toBe(bundle('en').jobo.statistics[key]);
    }
  });

  it('does not build a report while loading or after a read error', async () => {
    const loading = await render('en', { loaded: false });
    expect(loading.buildReports).not.toHaveBeenCalled();
    expect(loading.html).toContain('role="status"');
    expect(loading.html).toContain(loading.t('common.loading'));
    const failed = await render('en', { error: 'read failure' });
    expect(failed.buildReports).not.toHaveBeenCalled();
    expect(failed.html).toContain('role="alert"');
    expect(failed.html).toContain(failed.t('jobo.statistics.unavailable'));
  });

  it('renders invalid evidence as unavailable metrics, rather than zero recorded time', async () => {
    const { html, t } = await render('en', { buildReports: days => days.map(day => buildStatisticsDayReport({ date: day, records: [record, {}] })) });
    expect(html).toContain(t('jobo.statistics.invalid'));
    expect(html).toMatch(/Recorded time<\/dt><dd[^>]*>—<\/dd>/);
  });

  it('renders Execution from real multi-day reports without counting overnight slices twice', async () => {
    const nextDate = '2026-09-29';
    const planSnapshot = { date, startTime: '23:00', duration: 60 };
    const records = [
      createDoRecord({ ...record, taskId: 'task', planSnapshot, startTime: '23:00', endDate: nextDate, endTime: '01:00' }),
      createDoRecord({ ...record, id: 'continued', taskId: 'task', planSnapshot, date: nextDate, endDate: nextDate }),
    ];
    const { html, t } = await render('en', {
      buildReports: () => buildStatisticsReports({ dates: [date, nextDate], records }),
    });
    expect(html).toContain(t('jobo.statistics.execution'));
    for (const [key, value] of [['doRecords', 2], ['single', 0], ['split', 1]]) {
      expect(html).toContain(`${t(`jobo.statistics.${key}`)}</dt><dd class="mt-0.5 text-lg font-semibold tabular-nums">${value}</dd>`);
    }
    expect(html).toContain(`${t('jobo.view.progress.partial')}: 2`);
    expect(html).toContain(`${t('jobo.statistics.noPlan')}: 0`);
  });

  it('calls a completed elapsed plan without Do missing evidence, not an unstarted task', async () => {
    const { html } = await render('en', { buildReports: days => days.map(day => buildStatisticsDayReport({
      date: day, records: [], now: { date, time: '12:00' },
      tasks: [{ id: 'completed-without-do', title: 'Finished', date, startTime: '09:00', duration: 60, completed: true }],
    })) });
    expect(html).toMatch(/No Do recorded<\/dt><dd[^>]*>1<\/dd>/);
    expect(html).not.toContain('Not started');
  });

  it('counts a skipped occurrence in the Overview and names how many', async () => {
    const template = { id: 'tpl', title: 'Read', startTime: '11:00', duration: 30, recurrence: { type: 'daily', startDate: '2026-09-01' },
      completedDates: [], exceptions: { [date]: { skipped: true, skip: { at: `${date}T09:00:00+02:00`, plan: { startTime: '11:00', duration: 30, isAllDay: false } } } } };
    const { html } = await render('en', { buildReports: days => days.map(day => buildStatisticsDayReport({
      date: day, records: [], recurringTasks: [template], now: { date: '2026-09-29', time: '12:00' } })) });
    expect(html).toMatch(/data-statistics-skipped="true">\s*Skipped occurrences: 1\.</);
    const none = await render('en');
    expect(none.html).not.toContain('data-statistics-skipped');
  });
});

// The phone's form (JOBO slice 8, step 3): the same tabs and figures, in a
// sheet that owns dismissal, with no dialog of its own around them.
describe('Statistics panel as a sheet', () => {
  it('renders the tabs and figures in the sheet, titled with the range', async () => {
    const { html, t } = await render('en', { sheet: true });
    expect(html).toContain('data-jobo-statistics-panel="sheet"');
    expect(html).toContain('data-jobo-sheet-handle');
    expect(html.match(/data-jobo-statistics-scope=/g)).toHaveLength(4);
    expect(html).toContain(t('jobo.statistics.noDo'));
    // One dialog: the sheet's, not the desktop frame inside it.
    expect(html.match(/role="dialog"/g)).toHaveLength(1);
    expect(html).not.toContain('max-w-4xl');
  });
});
