import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import TaskPlanHistory, { PlanHistoryPanel } from './TaskPlanHistory.jsx';
import { planHistory } from '../utils/originalPlan.js';

// The badge must be ABSENT on the overwhelming majority of tasks: everything
// that predates the baseline, and everything still sitting where it was first
// put. An icon on all of them that opens to say "nothing happened" would be
// worse than no icon, so that is the case worth pinning.

async function i18n(lng = 'en') {
  const bundle = await loaders[lng]();
  const inst = i18next.createInstance();
  await inst.init({ lng, fallbackLng: false, resources: { [lng]: { translation: bundle } }, interpolation: { escapeValue: false } });
  return inst;
}

const ctx = { formatTime: (t) => t };

const render = async (task) => renderToStaticMarkup(
  <I18nextProvider i18n={await i18n()}>
    <DayPlannerContext.Provider value={ctx}>
      <TaskPlanHistory task={task} />
    </DayPlannerContext.Provider>
  </I18nextProvider>,
);

const PLANNED = { date: '2026-09-17', startTime: '09:00', duration: 60 };

describe('TaskPlanHistory', () => {
  it('renders nothing for a task with no baseline', async () => {
    expect(await render({ id: 't1', date: '2026-09-17', startTime: '09:00' })).toBe('');
  });

  it('renders nothing for a task still where it was first put', async () => {
    expect(await render({ id: 't1', ...PLANNED, originalPlan: PLANNED })).toBe('');
  });

  it('renders the badge once the task has moved', async () => {
    const html = await render({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).toContain('lucide-history');
    expect(html).toContain('Schedule history');
  });

  it('renders for a duration-only change, which is the easiest one to miss', async () => {
    const html = await render({ id: 't1', ...PLANNED, duration: 15, originalPlan: PLANNED });
    expect(html).toContain('lucide-history');
  });

  it('keeps the history closed until asked', async () => {
    const html = await render({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).not.toContain('Originally planned');
    expect(html).toContain('aria-expanded="false"');
  });
});

// The panel body is where the formatting actually happens, and it only runs
// while the popover is open. The first version of this component imported the
// duration formatter from the wrong module; every test above still passed,
// because none of them reached this code. The dev server caught it instead.
describe('PlanHistoryPanel', () => {
  const renderPanel = async (task, lng) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n(lng)}>
      <PlanHistoryPanel history={planHistory(task)} task={task} formatTime={(v) => v} />
    </I18nextProvider>,
  );

  it('shows the original schedule beside the current one', async () => {
    const html = await renderPanel({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).toContain('Originally planned');
    expect(html).toContain('09:00');
    expect(html).toContain('Now');
    expect(html).toContain('16:00');
  });

  it('formats durations rather than printing raw minutes', async () => {
    const html = await renderPanel({ id: 't1', ...PLANNED, duration: 15, originalPlan: PLANNED });
    expect(html).toContain('1h');   // the original 60
    expect(html).toContain('15m');  // the current
  });

  // Durations come from the `common.duration*` keys of the panel's own i18n
  // instance, not from Intl's narrow units, which give Ukrainian a bare "х".
  it('formats durations through the translated ladder', async () => {
    const html = await renderPanel({ id: 't1', ...PLANNED, duration: 15, originalPlan: PLANNED }, 'uk');
    expect(html).toContain('>1 г<');
    expect(html).toContain('>15 хв<');
  });

  it('emphasises what changed and dims what did not', async () => {
    // Duration moved, date and time did not: only the duration should be bold.
    const html = await renderPanel({ id: 't1', ...PLANNED, duration: 15, originalPlan: PLANNED });
    expect(html).toMatch(/font-semibold[^>]*>1h/);
    expect(html).toMatch(/opacity-60[^>]*>09:00/);
  });

  it('omits the duration entirely when the baseline carries none', async () => {
    const plan = { date: '2026-09-17', startTime: '09:00' };
    const html = await renderPanel({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: plan });
    expect(html).toContain('Originally planned');
    expect(html).toContain('09:00');
  });
});

describe('rendering outside the timeline', () => {
  const MOVED = { id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED };

  it('takes the icon size of the row it sits in', async () => {
    // SCHED rows use 10px icons; the timeline card uses 12.
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <DayPlannerContext.Provider value={ctx}>
          <TaskPlanHistory task={MOVED} size={10} />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
    expect(html).toContain('width="10"');
  });

  it('renders without the day-planner provider at all', async () => {
    // SchedTaskCard is also used by the project planner, which is not guaranteed
    // to sit under that provider. Reading formatTime off a null context threw.
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <TaskPlanHistory task={MOVED} />
      </I18nextProvider>,
    );
    expect(html).toContain('lucide-history');
  });

  it('falls back to the raw time in the panel when there is no provider', async () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <PlanHistoryPanel history={planHistory(MOVED)} task={MOVED} formatTime={(v) => v} />
      </I18nextProvider>,
    );
    expect(html).toContain('09:00');
  });
});

describe('the surfaces that carry it', () => {
  // Four now: the timeline card, SCHED, LIST, and MONTH's embedded SCHED pane.
  // LIST was missed when the badge first shipped and found in manual testing, so
  // this pins the rule rather than the wiring: any card showing a task's time
  // should offer its history, and a calendar event never should.
  const MOVED = { id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED };

  it('offers history for a task that has moved', async () => {
    expect(await render(MOVED)).toContain('lucide-history');
  });

  it('takes the icon size of the row it sits in', async () => {
    const html = renderToStaticMarkup(
      <I18nextProvider i18n={await i18n()}>
        <DayPlannerContext.Provider value={ctx}>
          <TaskPlanHistory task={MOVED} size={11} />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
    expect(html).toContain('width="11"');
  });
});

// The question this answers, asked of the shipped feature: "the popup shows the
// original plan and the current plan, nothing in between. Is this by design?"
// It was, because nothing recorded the in-between. Now something does.
describe('PlanHistoryPanel — the stops in between', () => {
  const renderPanel = async (task) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <PlanHistoryPanel history={planHistory(task)} task={task} formatTime={(v) => v} />
    </I18nextProvider>,
  );
  const stop = (at, date, startTime) => ({ at, date, startTime });

  // Two intermediate stops, on distinct days, so the order assertions below can
  // actually catch a list that renders the wrong way round.
  const SLID = {
    id: 't1', date: '2026-09-20', startTime: '14:00', duration: 60,
    originalPlan: PLANNED, deferrals: 3,
    planTrail: [
      stop(1, '2026-09-18', '11:00'),
      stop(2, '2026-09-19', '13:00'),
      stop(3, '2026-09-20', '14:00'),
    ],
  };

  it('lists the schedules the task passed through', async () => {
    const html = await renderPanel(SLID);
    expect(html).toContain('Recent moves');
    expect(html).toContain('11:00');
  });

  it('does not repeat the final stop, which is already the current plan', async () => {
    const html = await renderPanel(SLID);
    // "14:00" belongs to the "Now" line only — one occurrence, not two.
    expect(html.match(/14:00/g)).toHaveLength(1);
  });

  it('says nothing about stops when there are none to show', async () => {
    const html = await renderPanel({ id: 't1', ...PLANNED, startTime: '16:00', originalPlan: PLANNED });
    expect(html).not.toContain('Recent moves');
  });

  // Newest first, top to bottom, all the way down: "Now", then the stops in
  // descending order, then the baseline. A panel that reverses only its middle
  // section runs its dates 15, 18, 15, 19 down the page.
  it('reads newest first from top to bottom', async () => {
    const html = await renderPanel(SLID);
    const order = ['Sep 20', 'Sep 19', 'Sep 18', 'Sep 17'];
    const at = order.map((d) => html.indexOf(d));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  // The count of what the cap dropped sits where those moves happened: after
  // the oldest stop still kept, before the baseline it followed. That is the
  // position that lets it read as a list tail rather than a dangling fragment.
  it('puts the dropped-stop count below the stops and above the baseline', async () => {
    const html = await renderPanel({ ...SLID, deferrals: 9 });
    expect(html.indexOf('+6 earlier')).toBeGreaterThan(html.indexOf('11:00'));
    expect(html.indexOf('+6 earlier')).toBeLessThan(html.indexOf('Originally planned'));
  });

  it('says nothing about dropped stops when the trail holds them all', async () => {
    const html = await renderPanel(SLID);
    expect(html).not.toContain('earlier');
  });

  // An intermediate stop took no part in the baseline-versus-now diff, so
  // bolding it against that diff would point at nothing.
  it('renders the stops flat rather than emphasised', async () => {
    const html = await renderPanel(SLID);
    expect(html).not.toMatch(/font-semibold[^>]*>11:00/);
  });
});

// An Inbox task keeps its history (SCHED shows Inbox cards with a deadline,
// and a task can be moved back to the Inbox), but it has no date or time now.
// Opening the panel used to format that missing date and throw "Invalid time
// value", which took the view down with it.
describe('PlanHistoryPanel — a task now in the Inbox', () => {
  const renderPanel = async (task, lng) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n(lng)}>
      <PlanHistoryPanel history={planHistory(task)} task={task} formatTime={(v) => v} />
    </I18nextProvider>,
  );
  const INBOX = { id: 'i1', date: null, startTime: null, duration: 30, originalPlan: PLANNED, deferrals: 2 };

  it('opens without throwing and says where the task is now', async () => {
    const html = await renderPanel(INBOX);
    expect(html).toContain('Now');
    expect(html).toContain('In the Inbox');
    expect(html).not.toContain('Invalid');
    // The original plan still reads in full.
    expect(html).toContain('Originally planned');
    expect(html).toContain('09:00');
  });

  it('carries the Inbox wording in every language', async () => {
    const html = await renderPanel(INBOX, 'de');
    expect(html).toContain('Im Posteingang');
  });

  it('the badge itself still shows for an Inbox task with history', async () => {
    expect(await render(INBOX)).toContain('<svg');
  });

  it('a stop with no start time reads its date alone', async () => {
    const task = {
      id: 's1', date: '2026-09-20', startTime: '10:00', duration: 60, originalPlan: PLANNED, deferrals: 3,
      planTrail: [
        { at: Date.parse('2026-09-18T08:00:00Z'), date: '2026-09-18' },
        { at: Date.parse('2026-09-19T08:00:00Z'), date: '2026-09-19', startTime: '11:00' },
        { at: Date.parse('2026-09-20T08:00:00Z'), date: '2026-09-20', startTime: '10:00' },
      ],
    };
    const html = await renderPanel(task);
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });
});

// A chore another GLANCE app sends arrives all-day and is then given a time.
// The badge appeared and the panel read "Originally planned ... 00:00".
describe('a task first planned all-day', () => {
  const ALL_DAY = { date: '2026-09-17', startTime: '00:00', duration: 30, allDay: true };
  const renderPanel = async (task) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <PlanHistoryPanel history={planHistory(task)} task={task} formatTime={(v) => v} />
    </I18nextProvider>,
  );

  it('given a time on its own day shows no history badge', async () => {
    expect(await render({ id: 'c1', date: '2026-09-17', startTime: '14:00', duration: 45, originalPlan: ALL_DAY })).toBe('');
  });

  it('moved to another day shows the plan as its day, "All Day", with no midnight and no length', async () => {
    const html = await renderPanel({ id: 'c1', date: '2026-09-19', startTime: '14:00', duration: 45, originalPlan: ALL_DAY });
    const planned = html.slice(html.indexOf('Originally planned'));
    expect(planned).toContain('All Day');
    expect(planned).not.toContain('00:00');
    expect(planned).not.toContain('30m');
    // Where it is now still reads in full.
    expect(html.slice(0, html.indexOf('Originally planned'))).toContain('14:00');
  });

  it('a timed task that is all-day now reads "All Day" on its current row', async () => {
    const html = await renderPanel({ id: 't1', date: '2026-09-17', startTime: '00:00', duration: 60, isAllDay: true, originalPlan: { date: '2026-09-17', startTime: '09:00', duration: 60 } });
    const now = html.slice(0, html.indexOf('Originally planned'));
    expect(now).toContain('All Day');
    expect(now).not.toContain('00:00');
    expect(html.slice(html.indexOf('Originally planned'))).toContain('09:00');
  });
});

// #2429: when a task was ticked off reads at the top of its history, which is
// where a late finish shows next to the plan it overran. It is not a reason
// for the badge to appear: a completed task that never moved still has none.
describe('PlanHistoryPanel: completion time', () => {
  const renderPanel = async (task, value = ctx) => renderToStaticMarkup(
    <I18nextProvider i18n={await i18n()}>
      <DayPlannerContext.Provider value={value}>
        <PlanHistoryPanel history={planHistory(task)} task={task} formatTime={(v) => v} />
      </DayPlannerContext.Provider>
    </I18nextProvider>,
  );
  const STRETCHED = { id: 't1', date: '2026-09-17', startTime: '15:32', duration: 65, originalPlan: { date: '2026-09-17', startTime: '15:32', duration: 20 } };

  it('shows when a completed task was completed, before the plan', async () => {
    const html = await renderPanel({ ...STRETCHED, completed: true, completedAt: '2026-09-17T16:51:00' });
    expect(html).toContain('data-plan-history-completed');
    expect(html).toContain('Completed');
    expect(html).toContain('16:51');
    expect(html.indexOf('16:51')).toBeLessThan(html.indexOf('Originally planned'));
  });

  it('shows nothing for an open task, or a completion with no stamp', async () => {
    expect(await renderPanel(STRETCHED)).not.toContain('data-plan-history-completed');
    expect(await renderPanel({ ...STRETCHED, completed: true })).not.toContain('data-plan-history-completed');
  });

  it("reads a recurring occurrence's completion from its series", async () => {
    const occurrence = { ...STRETCHED, id: 'recurring-r1-2026-09-17', isRecurring: true, recurringTemplateId: 'r1', completed: true, deferrals: 1 };
    const series = { id: 'r1', completedDatesTimestamps: { '2026-09-17': '2026-09-17T16:51:00' } };
    expect(await renderPanel(occurrence, { ...ctx, recurringTasks: [series] })).toContain('16:51');
  });

  it('does not make the badge appear on a completed task that never moved', async () => {
    const PLANNED_AT = { date: '2026-09-17', startTime: '15:32', duration: 20 };
    expect(await render({ id: 't1', ...PLANNED_AT, originalPlan: PLANNED_AT, completed: true, completedAt: '2026-09-17T16:51:00' })).toBe('');
  });
});
