import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import CheckPanel, { CheckJournal } from './CheckPanel.jsx';
import { journalDate } from './checkJournal.js';
import { buildJoboDayModel } from '../../jobo/viewModel.js';
import { createDoRecord } from '../../jobo/core.js';
import { summaryRows, timingRows } from './ExecutionAxes.jsx';

vi.mock('react-dom', async importOriginal => ({ ...await importOriginal(), createPortal: children => children }));
afterEach(() => vi.unstubAllGlobals());

const date = '2026-09-28';
const plan = { date, startTime: '09:00', duration: 60 };
const task = { ...plan, id: 't1', title: 'Report', color: 'bg-green-500', priority: 0, completed: true };
const stamp = `${date}T11:00:00+08:00`;
const row = (over = {}) => createDoRecord({ id: 'r1', taskId: 't1', title: task.title, source: 'completion', timing: 'timed',
  date, startTime: '09:10', endDate: date, endTime: '10:20', progress: 'mostly', planSnapshot: plan,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over });
const build = (records = [row()], extra = {}) => buildJoboDayModel({ date, records, tasks: [task], taskLookup: [task], ...extra });
const locales = ['en', 'zh-CN', 'de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'];
const bundle = lng => JSON.parse(readFileSync(new URL(`../../../public/locales/${lng}/translation.json`, import.meta.url), 'utf8'));
async function render(lng = 'en', props = {}, Component = CheckJournal) {
  const i18n = i18next.createInstance();
  await i18n.init({ lng, fallbackLng: false, resources: { [lng]: { translation: bundle(lng) } }, interpolation: { escapeValue: false } });
  const html = renderToStaticMarkup(<I18nextProvider i18n={i18n}><Component date={date} model={build()} loaded onOpenNotes={vi.fn()} {...props} /></I18nextProvider>);
  return { html, t: i18n.t.bind(i18n) };
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Check reads as the execution journal from #1726 / #1882', () => {
  it.each(locales)('renders the actual %s translations and existing card terminology', async lng => {
    const { html, t } = await render(lng);
    expect(html).toContain('Report');
    expect(html).toContain('background-color:#22c55e');
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*data-check-swatch/);
    expect(html).toMatch(/<h3 class="font-semibold min-w-0 break-words">Report<\/h3>/);
    expect(html).toContain('09:00–10:00');
    expect(html).toContain('09:10–10:20');
    expect(html).toContain('data-check-progress="mostly"');
    expect(html).toContain('data-check-notes');
    expect(html).not.toMatch(/jobo\.(check|view)\.|\{\{|NaN|undefined|Infinity/);
    expect(html).not.toMatch(/<table|<input|<textarea|<select/);
    expect(text(html)).not.toMatch(/P[1-4]|Allen|captured-plan groups|measured pieces/);
    const item = build().plans[0];
    for (const r of [...summaryRows(item.labels, item.comparison, t), ...timingRows(item.comparison, t)]) {
      expect(text(html)).toContain(r.text);
    }
    const copy = bundle(lng).jobo.check;
    const english = bundle('en').jobo.check;
    // Plural forms follow each language's rules (pl and uk have four): compare
    // their base, and read a form English lacks against its `_other`.
    const PLURAL = /_(zero|one|two|few|many|other)$/;
    const bases = keys => [...new Set(keys.map(key => key.replace(PLURAL, '')))].sort();
    expect(bases(Object.keys(copy))).toEqual(bases(Object.keys(english)));
    for (const [key, value] of Object.entries(copy)) {
      const reference = english[key] ?? english[key.replace(PLURAL, '_other')];
      expect(value).not.toContain('—');
      expect(value.match(/\{\{\w+\}\}/g) || []).toEqual(reference.match(/\{\{\w+\}\}/g) || []);
      if (lng !== 'en') expect(value).not.toBe(reference);
    }
  });
  it('lists sessions once with individual progress, without replacing it with native completion', async () => {
    const second = row({ id: 'r2', startTime: '11:00', endTime: '11:30', progress: 'partial', createdAt: `${date}T12:00:00+08:00`, updatedAt: `${date}T12:00:00+08:00` });
    const { html } = await render('en', { model: build([row(), second]) });
    expect([...html.matchAll(/data-check-entry=/g)]).toHaveLength(1);
    expect([...html.matchAll(/data-check-session=/g)]).toHaveLength(2);
    expect(html).toContain('Session 1'); expect(html).toContain('Session 2');
    expect(text(html)).toContain('Latest: Partial');
    expect(text(html)).not.toContain('Completed');
  });
  it('does not paint an untimed completion as an actual interval', async () => {
    const { html } = await render('en', { model: build([row({ timing: 'untimed', startTime: null, endDate: null, endTime: null })]) });
    expect(text(html)).toContain('Time not recorded');
    expect(html).toContain('data-check-completion');
    expect(text(html)).not.toContain('0 min');
    expect(html).not.toContain('data-check-timing');
  });
  it('does not present a manual untimed save timestamp as execution time', async () => {
    const { html } = await render('en', { model: build([row({ timing: 'untimed', source: 'manual', taskId: null, planSnapshot: null, startTime: null, endDate: null, endTime: null })]) });
    expect(html).not.toContain('data-check-completion'); expect(html).not.toContain('data-check-notes');
  });
  it('shows dates for off-day sessions and does not hide them behind today’s clock', async () => {
    const { html } = await render('en', { model: build([row({ date: '2026-09-27', startTime: '23:30', endTime: '00:30' })]) });
    expect(html).toContain('Sun, Sep 27 23:30–Mon, Sep 28 00:30');
    expect(html).not.toContain('2026-09-27');
    expect(text(html)).not.toContain('Includes sessions on other days.');
  });
  it('marks inferred intervals and suppresses exact timing comparisons', async () => {
    const { html } = await render('en', { model: build([row({ timingBasis: 'planDuration' })]) });
    expect(text(html)).toContain('Start time inferred'); expect(html).not.toContain('data-check-timing');
  });
  it.each(['bg-amber-500', 'bg-yellow-500'])('keeps %s on a decorative swatch, not the title', async color => {
    const coloured = { ...task, color };
    const { html } = await render('en', { model: build([row()], { tasks: [coloured], taskLookup: [coloured] }) });
    expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*data-check-swatch[^>]*style="background-color:#[0-9a-f]+"/);
    expect(html).toMatch(/<h3 class="font-semibold min-w-0 break-words">Report<\/h3>/);
    expect(html).not.toMatch(/<h3[^>]*style=/);
  });
  it.each(['en', 'zh-CN', 'de'])('localizes the panel heading and cross-day sessions in %s', async lng => {
    vi.stubGlobal('document', { body: {} });
    const previous = '2026-09-27';
    const localDate = day => new Intl.DateTimeFormat(lng, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00`));
    const { html } = await render(lng, { model: build([row({ date: previous, startTime: '23:30', endTime: '00:30' })]) }, CheckPanel);
    expect(html.match(/<h2[^>]*>.*?<\/h2>/)?.[0]).toContain(localDate(date));
    expect(html).toContain(`${localDate(previous)} 23:30–${localDate(date)} 00:30`);
    expect(text(html)).not.toContain(previous);
    expect(text(html)).not.toContain(date);
  });
  it('localizes an off-day untimed completion without inventing an interval', async () => {
    const next = '2026-09-29';
    const record = row({ id: 'next', timing: 'untimed', date: next, startTime: null, endDate: null, endTime: null,
      createdAt: `${next}T11:00:00+08:00`, updatedAt: `${next}T11:00:00+08:00`, observedAt: `${next}T11:00:00+08:00` });
    const { html } = await render('en', { model: build([row(), record]), formatTime: time => `clock(${time})` });
    expect(text(html)).toContain('Marked complete at Tue, Sep 29 clock(11:00)');
    expect(text(html)).toContain('Time not recorded');
    expect(html).not.toContain(`${next} 11:00`);
  });
  it('has no notes action for orphaned tasks and keeps their captured titles', async () => {
    const { html } = await render('en', { model: build([row()], { tasks: [], taskLookup: [] }) });
    expect(html).toContain('Report'); expect(html).not.toContain('data-check-notes');
  });
  it('escapes record titles instead of trusting them as markup', async () => {
    const { html } = await render('en', { model: build([row({ title: '<img src=x onerror=alert(1)>' })], { tasks: [], taskLookup: [] }) });
    expect(html).not.toContain('<img'); expect(html).toContain('&lt;img');
  });
  it('retains load, error, empty and malformed evidence distinctions', async () => {
    expect((await render('en', { loaded: false })).html).toContain('Loading');
    const failed = (await render('en', { error: 'storageRead' })).html;
    expect(failed).toContain('role="alert"'); expect(failed).not.toContain('Report');
    const empty = (await render('en', { model: build([]) })).html;
    expect(text(empty)).toContain('No executions recorded'); expect(empty).not.toContain('data-check-entry');
    const broken = (await render('en', { model: build([row(), { id: 'broken' }]) })).html;
    expect(text(broken)).toContain('Some execution records could not be loaded.'); expect(broken).toContain('Report');
    expect(broken).not.toContain('data-check-timing'); expect(broken).not.toContain('data-check-summary');
  });
  it('does not claim an empty day when all execution records are unreadable', async () => {
    const { html, t } = await render('en', { model: build([{ id: 'broken' }]) });
    expect(text(html)).toContain(t('jobo.check.invalid'));
    expect(text(html)).not.toContain(t('jobo.check.noRecords'));
    expect(html).not.toContain('data-check-entry');
  });
  it('keeps copy limited to the journal and concise data states', async () => {
    for (const lng of locales) {
      const check = bundle(lng).jobo.check;
      // Plural forms differ by language (pl and uk have four); compare their base.
      const base = [...new Set(Object.keys(check).map(key => key.replace(/_(zero|one|two|few|many|other)$/, '')))].sort();
      expect(base).toEqual(['actual', 'allHandled', 'button', 'clash', 'clashUnnamed', 'completedLater', 'continue', 'continueAllDay',
        'continued', 'deleted', 'followUp', 'invalid', 'moveToProject', 'movedToInbox', 'movedToProject', 'next', 'noRecords',
        'notStarted', 'pending', 'recurringNotStarted', 'restore', 'restoreRedone', 'restoreUndone', 'restored', 'schedule', 'session',
        'skip', 'skipChanged', 'skipRedone', 'skipUndone', 'skipped', 'skippedGroup', 'title', 'unavailable', 'untimed', 'workRecorded']);
    }
    expect(bundle('en').jobo.check.noRecords).toBe('No executions recorded for this day.');
    expect(bundle('zh-CN').jobo.check.noRecords).toBe('当天暂无执行记录。');
  });
  it('keeps statistics dormant, without importing their module into the panel', () => {
    const source = readFileSync(new URL('./CheckPanel.jsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/checkSummary|summarizeJoboDayModel|recordJobo|localStorage|updateTask|setTasks|pushUndo/);
    expect(source).toContain("from './ExecutionAxes.jsx'");
    expect(source).toContain('event.stopImmediatePropagation()');
    expect(source).toContain('previous.focus()');
  });
});

describe('Check entries offer Continue or Add follow-up (docs/jobo-carry-forward.md)', () => {
  const today = '2026-09-30';
  const carry = { continueTask: vi.fn(), editOn: vi.fn(), openFollowUp: vi.fn() };
  const open = { ...task, completed: false };
  const withTask = (current, records = [row()]) => buildJoboDayModel({ date, records, tasks: current.date === date ? [current] : [], taskLookup: [current] });
  const carryOf = html => [...html.matchAll(/data-check-carry="(\w+)"/g)].map(m => m[1]);

  it('stays a read-only journal when no actions are passed in', async () => {
    const { html } = await render('en', { model: withTask(open), today });
    expect(carryOf(html)).toEqual([]);
    expect(html).not.toContain('data-check-continue');
  });
  it.each(locales)('offers Continue to the day after today, with the time that is left, in %s', async lng => {
    // 09:10–10:20 measured against a 60 minute plan ran over: the plan is kept.
    const { html, t } = await render(lng, { model: withTask(open), today, carry });
    expect(carryOf(html)).toEqual(['continue']);
    const slot = `${journalDate('2026-10-01', lng, date)} 09:00`;
    const label = t('jobo.check.continue', { slot, minutes: 60 });
    expect(label).not.toContain('jobo.check');
    expect(text(html)).toContain(label);
  });
  it('subtracts measured time from the continuation', async () => {
    const { html, t } = await render('en', { model: withTask(open, [row({ endTime: '09:30' })]), today, carry });
    expect(text(html)).toContain(t('jobo.check.continue', { slot: `${journalDate('2026-10-01', 'en', date)} 09:00`, minutes: 45 }));
  });
  it.each(locales)('offers a follow-up for a finished task in %s', async lng => {
    const { html, t } = await render(lng, { model: withTask(task), today, carry });
    expect(carryOf(html)).toEqual(['followUp']);
    expect(text(html)).toContain(t('jobo.check.followUp'));
  });
  it('shows where a task already moved went, with no button', async () => {
    const { html, t } = await render('en', { model: withTask({ ...open, date: '2026-10-02', startTime: '14:00' }), today, carry });
    expect(carryOf(html)).toEqual(['moved']);
    expect(text(html)).toContain(t('jobo.check.next', { slot: `${journalDate('2026-10-02', 'en', date)} 14:00` }));
    expect(html).not.toMatch(/data-check-(continue|follow-up|schedule)/);
  });
  it('offers Schedule… for an unscheduled task', async () => {
    const { html } = await render('en', { model: withTask({ ...open, date: null, startTime: null }), today, carry });
    expect(carryOf(html)).toEqual(['schedule']);
  });
  it('offers nothing for a recurring occurrence or an unlinked Do', async () => {
    const occurrence = { ...open, id: 'recurring-tpl-2026-09-28', recurringTemplateId: 'tpl', isRecurring: true };
    const recurring = await render('en', { model: withTask(occurrence, [row({ taskId: occurrence.id })]), today, carry });
    expect(carryOf(recurring.html)).toEqual([]);
    const unlinked = await render('en', { model: withTask(open, [row({ taskId: null, planSnapshot: null, source: 'manual' })]), today, carry });
    expect(carryOf(unlinked.html)).toEqual([]);
  });
  it('names the task on each action for assistive technology', async () => {
    const { html, t } = await render('en', { model: withTask(task), today, carry });
    expect(html).toContain(`aria-label="${t('jobo.check.followUp')}: Report"`);
  });
});

describe('the Check reviews the whole plan: Not started and the summary line (addendum)', () => {
  const today = '2026-09-30';
  const carry = { continueTask: vi.fn(), editOn: vi.fn(), openFollowUp: vi.fn(), unscheduleTask: vi.fn(), deleteTask: vi.fn() };
  const plain = (id, over = {}) => ({ ...plan, id, title: id, color: 'bg-blue-500', priority: 0, completed: false, ...over });
  // As JoboView builds it: the day's timed tasks, read at `today` 18:00.
  const day = (tasks, records = []) => buildJoboDayModel({
    date, records, tasks: tasks.filter(item => !item.isAllDay), taskLookup: tasks, now: { date: today, time: '18:00' },
  });
  const notStartedIds = html => [...html.matchAll(/data-check-not-started="([^"]+)"/g)].map(m => m[1]);
  const view = (tasks, records, lng = 'en', extra = {}) => render(lng, { model: day(tasks, records), today, carry, dayTasks: tasks, ...extra });

  it.each(locales)('lists tasks never started, with Continue, a move off the timeline and Delete, in %s', async lng => {
    const { html, t } = await view([plain('idle'), plain('project', { startTime: '11:00', projectId: 'p1' })], [], lng);
    expect(notStartedIds(html)).toEqual(['idle', 'project']);
    expect(text(html)).toContain(t('jobo.check.notStarted'));
    expect(html.match(/data-check-continue/g)).toHaveLength(2);
    expect(html).toMatch(/data-check-not-started="idle"[^]*data-check-unschedule="inbox"/);
    expect(html).toMatch(/data-check-not-started="project"[^]*data-check-unschedule="project"/);
    expect(html.match(/data-check-delete/g)).toHaveLength(2);
    expect(text(html)).toContain(t('task.moveToInbox'));
    expect(text(html)).toContain(t('jobo.check.moveToProject'));
    // Continue keeps the full plan, since nothing was recorded.
    expect(text(html)).toContain(t('jobo.check.continue', { slot: `${journalDate('2026-10-01', lng, date)} 09:00`, minutes: 60 }));
  });
  it('lists a recurring occurrence with nothing to offer', async () => {
    const occurrence = plain('recurring-tpl-2026-09-28', { recurringTemplateId: 'tpl', isRecurring: true });
    const { html, t } = await view([occurrence]);
    expect(html).toContain('data-check-carry="recurring"');
    expect(text(html)).toContain(t('jobo.check.recurringNotStarted'));
    expect(html).not.toMatch(/data-check-(continue|unschedule|delete)/);
  });
  it.each(locales)('offers Skip for today\'s ended occurrence, and lists the day\'s skips with Restore, in %s', async lng => {
    const occurrence = plain(`recurring-tpl-${today}`, { date: today, recurringTemplateId: 'tpl', isRecurring: true });
    const model = buildJoboDayModel({ date: today, records: [], tasks: [occurrence], taskLookup: [occurrence], now: { date: today, time: '18:00' } });
    const skipRow = (id, skipState, startTime) => ({ ...plain(`recurring-${id}-${today}`, { date: today, startTime, recurringTemplateId: id, isRecurring: true }),
      skippedAt: 'at', skipState });
    const skippedOn = vi.fn(() => [skipRow('a', 'skipped', '07:00'), skipRow('b', 'completed', '08:00'), skipRow('c', 'worked', '10:00')]);
    const { html, t } = await render(lng, { model, date: today, today, dayTasks: [occurrence],
      carry: { ...carry, skipTask: vi.fn(), restoreSkip: vi.fn(), skippedOn } });
    expect(skippedOn).toHaveBeenCalledWith(today);
    expect(html).toMatch(/data-check-not-started="recurring-tpl-2026-09-30"[^]*data-check-skip=/);
    expect(html).toContain(`aria-label="${t('jobo.check.skip')}: recurring-tpl-2026-09-30"`);
    expect(text(html)).toContain(t('jobo.check.skippedGroup'));
    expect([...html.matchAll(/data-check-skipped="([^"]+)"/g)].map(m => m[1])).toEqual(['recurring-a-2026-09-30', 'recurring-b-2026-09-30', 'recurring-c-2026-09-30']);
    expect([...html.matchAll(/data-check-skip-state="(\w+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]])).toEqual([
      ['skipped', t('jobo.check.skipped')], ['completed', t('jobo.check.completedLater')], ['worked', t('jobo.check.workRecorded')]]);
    // Every row keeps Restore, overtaken or not, with its frozen plan.
    expect(html.match(/data-check-restore/g)).toHaveLength(3);
    expect(html).toContain('07:00–08:00');
    expect(html).not.toMatch(/jobo\.check\.|\{\{|NaN|undefined/);
  });
  it('offers no Skip on a past day, and no Skipped group without skips', async () => {
    const occurrence = plain('recurring-tpl-2026-09-28', { recurringTemplateId: 'tpl', isRecurring: true });
    const { html } = await view([occurrence], [], 'en', { carry: { ...carry, skipTask: vi.fn(), restoreSkip: vi.fn(), skippedOn: () => [] } });
    expect(html).toContain('data-check-carry="recurring"');
    expect(html).not.toMatch(/data-check-skip=|data-check-skipped-group/);
  });
  it('shows an all-day task on a past day as all day', async () => {
    const { html, t } = await view([plain('offsite', { isAllDay: true, startTime: '00:00' })]);
    expect(notStartedIds(html)).toEqual(['offsite']);
    expect(html).toMatch(new RegExp(`data-check-plan="true"[^>]*>${t('task.allDay')}<`));
  });
  it('leaves the journal to tasks with a Do, and offers no actions without them', async () => {
    const withDo = await view([plain('t1')], [row({ source: 'manual', taskId: 't1' })]);
    expect(notStartedIds(withDo.html)).toEqual([]);
    const readOnly = await render('en', { model: day([plain('idle')]), today, dayTasks: [plain('idle')] });
    expect(notStartedIds(readOnly.html)).toEqual(['idle']);
    expect(readOnly.html).not.toMatch(/data-check-(continue|unschedule|delete)/);
  });

  it.each(locales)('counts the tasks that still need a next step, in %s', async lng => {
    const records = [row({ source: 'manual', taskId: 'partial', progress: 'partial' })];
    const { html, t } = await view([plain('partial'), plain('idle', { startTime: '11:00' })], records, lng);
    expect(html).toContain('data-check-next-steps="2"');
    const line = t('jobo.check.pending', { count: 2 });
    expect(line).not.toContain('jobo.check');
    expect(text(html)).toContain(line);
  });
  it('says every task has a next step once none is left on the day', async () => {
    const { html, t } = await view([plain('done', { completed: true })], [row({ source: 'manual', taskId: 'done', progress: 'completed' })]);
    expect(html).toContain('data-check-next-steps="0"');
    expect(text(html)).toContain(t('jobo.check.allHandled'));
  });
  it('says nothing on a day with no plan and no Do', async () => {
    const { html } = await view([]);
    expect(html).not.toContain('data-check-next-steps');
    expect(html).not.toContain('data-check-not-started-group');
  });
  it('keeps both off a Check opened without today, as before', async () => {
    const { html } = await render('en', { model: day([plain('idle')]), dayTasks: [plain('idle')] });
    expect(html).not.toContain('data-check-next-steps');
    expect(html).not.toContain('data-check-not-started');
  });
});
