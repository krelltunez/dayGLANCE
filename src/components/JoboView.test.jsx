import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createDoRecord } from '../jobo/core.js';

// JOBO's Plan side is DAY's own timeline column and its Do side is drawn to
// the same grid. These tests pin that structure (the Plan column is the app's
// column over the whole day, not a copy of it), the Do cards, and the source
// boundary: the view reads committed records and never the working set.

const fixture = vi.hoisted(() => ({ ctx: {}, features: {}, planColumns: [] }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => fixture.ctx }));
vi.mock('../context/FeaturesContext.jsx', () => ({ useFeaturesCtx: () => fixture.features }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('./DayView.jsx', () => ({
  DayViewColumn: ({ col, hourHeight, planOnly, zoom }) => {
    fixture.planColumns.push({ ...col, hourHeight, planOnly, zoom });
    return <div data-plan-column={`${col.dateStr} ${col.startHour}-${col.endHour}`} />;
  },
}));
import JoboView from './JoboView.jsx';
import { SCROLLING_HOUR_PX } from '../utils/timelineZoom.js';

const task = { id: 't1', title: 'Native Plan', date: '2026-09-24', startTime: '09:00', duration: 30, color: 'bg-emerald-500', completed: true };
const stamp = '2026-09-24T09:30:00-05:00';
const point = (over = {}) => createDoRecord({
  id: 'do:t1:x', taskId: 't1', title: 'Captured work', source: 'completion', progress: 'completed',
  timing: 'untimed', date: '2026-09-24', startTime: null, endDate: null, endTime: null, planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});
const timed = (over = {}) => createDoRecord({
  id: 'manual:1', taskId: 't1', title: 'Deep work', source: 'manual', progress: 'started',
  timing: 'timed', date: '2026-09-24', startTime: '10:00', endDate: '2026-09-24', endTime: '11:00', planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});

// The notes sidebar's width test: the calendar's three-column layout, which
// App publishes as canShowViewCycler (utils/desktopColumns.js).
let wideCalendar = false;

function render(extra = {}, ctxExtra = {}) {
  fixture.planColumns = [];
  fixture.ctx = {
    selectedDate: new Date(2026, 8, 24, 12), currentTime: new Date(2026, 8, 24, 12),
    tasks: [task], unscheduledTasks: [], expandedRecurringTasks: [], recurringTasks: [],
    getTasksForDate: () => [task], formatTime: (value) => value,
    textPrimary: '', textSecondary: '', cardBg: '', borderClass: '', darkMode: false,
    calendarRef: { current: null }, stickyHeaderRef: { current: null },
    canShowViewCycler: wideCalendar,
    ...ctxExtra,
  };
  fixture.features = { joboRecords: [], joboLoaded: true, joboWritable: true, joboError: null, recordJobo: vi.fn(), reloadJobo: vi.fn(), ...extra };
  return renderToStaticMarkup(<JoboView />);
}

describe('JOBO view', () => {
  // MUTATION: render a hand-built Plan lane instead and this fails; that lane
  // is what lost drag and drop, the hover line and the real cards.
  it('the Plan side is DAY\'s own column over the whole selected day', () => {
    const html = render();
    expect(fixture.planColumns).toHaveLength(1);
    expect(fixture.planColumns[0]).toMatchObject({ dateStr: '2026-09-24', startHour: 0, endHour: 24, hourHeight: 160 });
    expect(html).toContain('data-plan-column="2026-09-24 0-24"');
    expect(html).not.toContain('data-jobo-plan');
  });

  it('draws the Do side on the same grid: 24 hour rows and the now line on today', () => {
    const html = render();
    expect(html.match(/border-b border-dashed/g)).toHaveLength(24);
    expect(html).toContain('bg-red-500');
    expect(html).toContain('jobo.view.emptyDo');
  });

  it('draws a completion as a card at its completion time, in the task\'s colour, with a rule marking the moment', () => {
    const html = render({ joboRecords: [point()] });
    expect(html).toContain('data-jobo-point="true"');
    expect(html).toContain('Captured work');
    expect(html).toContain('top:1520px'); // 09:30 at 160px an hour
    expect(html).toContain('bg-emerald-500');
    expect(html).toContain('common.edit: Captured work');
    expect(html).not.toContain('jobo.view.untimed');
  });

  it('draws a timed Do as a card spanning its interval, with the resize handle a task card has', () => {
    const html = render({ joboRecords: [timed()] });
    expect(html).toContain('data-jobo-record="manual:1"');
    expect(html).toContain('top:1600px');    // 10:00
    expect(html).toContain('height:158px');  // 60 minutes, less the 2px gap
    expect(html).toContain('10:00–11:00');
    expect(html).toContain('w-12 h-1 bg-white rounded-full');
  });

  it('a read-only ledger offers no edit, add or resize', () => {
    const html = render({ joboRecords: [timed()], joboWritable: false });
    expect(html).not.toContain('common.edit: Deep work');
    expect(html).not.toContain('w-12 h-1 bg-white rounded-full');
    expect(html).toContain('jobo.view.readOnly');
    expect(html).toMatch(/disabled=""[^>]*>.*jobo\.view\.addDo/s);
  });

  it('surfaces a read failure rather than an empty day', () => {
    const html = render({ joboLoaded: false, joboRecords: undefined, joboError: 'storageRead' });
    expect(html).toContain('jobo.view.loadError');
    expect(html).not.toContain('jobo.view.emptyDo');
  });

  it('keeps the source boundary explicit', () => {
    const view = readFileSync(new URL('./JoboView.jsx', import.meta.url), 'utf8');
    const column = readFileSync(new URL('./jobo/DoColumn.jsx', import.meta.url), 'utf8');
    const editor = readFileSync(new URL('./jobo/DoEditor.jsx', import.meta.url), 'utf8');
    for (const source of [view, column]) {
      expect(source).not.toMatch(/readJoboWorkingSet|workingSet\(|setTasks|localStorage|indexedDB/);
    }
    expect(editor).toContain('useState(() => record?.id || `manual:${crypto.randomUUID()}`)');
    expect(editor).not.toMatch(/toggleComplete|setTasks|localStorage|indexedDB/);
  });

  // MUTATION: go back to <input type="date|time"> and this fails; the browser's
  // own pickers match nothing else in dayGLANCE.
  it('the Do editor uses the app\'s own date and time pickers, never the browser\'s', () => {
    const editor = readFileSync(new URL('./jobo/DoEditor.jsx', import.meta.url), 'utf8');
    expect(editor).toContain("from '../ClockTimePicker.jsx'");
    expect(editor).toContain("from '../DatePicker.jsx'");
    expect(editor).not.toMatch(/type="(date|time)"/);
  });
});

describe('Do column gestures snap like the rest of the app', () => {
  it('snaps to 15 minutes and clamps to the day', async () => {
    const { snapMinute } = await import('./jobo/DoColumn.jsx');
    expect(snapMinute(7)).toBe(0);
    expect(snapMinute(8)).toBe(15);
    expect(snapMinute(611)).toBe(615);
    expect(snapMinute(-20)).toBe(0);
    expect(snapMinute(1500)).toBe(1440);
  });
});

describe('the Do editor reads an end before the start as the next day', () => {
  it('rolls over only when the end is earlier than the start', async () => {
    const { endDateFor } = await import('./jobo/DoEditor.jsx');
    expect(endDateFor('2026-09-24', '09:00', '10:30')).toBe('2026-09-24');
    expect(endDateFor('2026-09-24', '23:00', '01:00')).toBe('2026-09-25');
    expect(endDateFor('2026-12-31', '23:30', '00:15')).toBe('2027-01-01');
    // Equal stays put, so core refuses an empty interval instead of 24 hours.
    expect(endDateFor('2026-09-24', '09:00', '09:00')).toBe('2026-09-24');
  });
});

describe('a completion with a planned duration is drawn as a dashed estimate', () => {
  const planned = () => point({ planSnapshot: { date: '2026-09-24', startTime: '08:30', duration: 60 } });

  // MUTATION: go back to "planned length ending at the completion" and a task
  // finished late reads as started late instead of running long.
  it('runs from the planned start to the completion, and stays a marker without a plan', async () => {
    const { estimateCompletion } = await import('./jobo/DoColumn.jsx');
    const item = { id: 'x', point: true, startMinute: 592, endMinute: 592, time: '09:52', date: '2026-09-24', record: planned() };
    // Planned 08:30 for 60 minutes, completed 09:52: started as planned, ran 22 minutes long.
    expect(estimateCompletion(item)).toMatchObject({ estimate: true, startMinute: 510, endMinute: 592, markerMinute: 592 });
    expect(estimateCompletion({ ...item, record: point() })).toEqual({ ...item, record: point() });
    expect(estimateCompletion({ ...item, point: false })).toMatchObject({ point: false });
    expect(estimateCompletion({ ...item, startMinute: 20, endMinute: 20 })).toMatchObject({ startMinute: 0, endMinute: 20 });
  });

  it('falls back to the planned length when the planned start says little', async () => {
    const { estimateCompletion } = await import('./jobo/DoColumn.jsx');
    const at = (minute, date = '2026-09-24') => estimateCompletion({ id: 'x', point: true, startMinute: minute, endMinute: minute, date, record: planned() });
    expect(at(540)).toMatchObject({ startMinute: 510, endMinute: 540 });   // finished early: ran short
    expect(at(690)).toMatchObject({ startMinute: 510, endMinute: 690 });   // three planned hours after 08:30: still within reach
    expect(at(691)).toMatchObject({ startMinute: 631, endMinute: 691 });   // beyond reach: the planned hour, ending at the completion
    expect(at(480)).toMatchObject({ startMinute: 420, endMinute: 480 });   // before the planned start
    expect(at(592, '2026-09-25')).toMatchObject({ startMinute: 532 });     // another day
  });

  // MUTATION: drop estimateCompletion from the view and the card is a marker
  // again; store the estimate and recordJobo is called on render.
  it('renders dashed and labelled, and drawing it writes nothing to the ledger', () => {
    const recordJobo = vi.fn();
    const html = render({ joboRecords: [planned()], recordJobo });
    expect(html).toContain('data-jobo-estimate="true"');
    expect(html).toContain('border-dashed border-white/80');
    expect(html).toContain('top:1360px');  // completed 09:30, planned 60 min: from 08:30, at 160px an hour
    expect(html).toContain('jobo.view.estimatedShort');
    expect(html).toContain('~08:30–09:30');
    expect(recordJobo).not.toHaveBeenCalled();
  });
});

describe('a Partial attempt finished by a later completion', () => {
  const plan = { date: '2026-09-24', startTime: '09:00', duration: 30 };
  const partial = (over = {}) => timed({ progress: 'partial', planSnapshot: plan, startTime: '09:00', endTime: '09:15', ...over });
  const done = (over = {}) => point({ planSnapshot: plan, ...over });   // completed 09:30

  // MUTATION: drop the earlier-attempt trim and the estimate runs from the
  // planned start, beside the partial, as a second copy of the same work.
  it('starts the estimate where the recorded work that day ended', async () => {
    const { estimateCompletion } = await import('./jobo/DoColumn.jsx');
    const item = (attempts) => ({ id: 'x', point: true, startMinute: 570, endMinute: 570, time: '09:30', date: '2026-09-24', record: done(), attempts });
    expect(estimateCompletion(item([partial()]))).toMatchObject({ estimate: true, startMinute: 555, endMinute: 570 });
    // Work that ended before the planned start, on another day, or after the completion changes nothing.
    expect(estimateCompletion(item([partial({ startTime: '08:00', endTime: '08:30' })]))).toMatchObject({ startMinute: 540 });
    expect(estimateCompletion(item([partial({ date: '2026-09-23', endDate: '2026-09-23' })]))).toMatchObject({ startMinute: 540 });
    expect(estimateCompletion(item([partial({ endTime: '09:45' })]))).toMatchObject({ startMinute: 540 });
    // Recorded right up to the completion: the completion is only the check, a marker.
    expect(estimateCompletion(item([partial({ endTime: '09:30' })]))).toMatchObject({ point: true, startMinute: 570, endMinute: 570 });
    expect(estimateCompletion(item([partial({ endTime: '09:30' })])).estimate).toBeUndefined();
  });

  // MUTATION: compare against the completion's time the wrong way round, or
  // skip the progress check, and the wrong cards gain the note.
  it('notes a Partial whose task a later attempt completed, and nothing else', async () => {
    const { finishedLater } = await import('./jobo/DoColumn.jsx');
    const at = (record, attempts) => finishedLater({ record, attempts });
    expect(at(partial(), [partial(), done()])).toBe(true);
    expect(at(partial({ startTime: '10:00', endTime: '10:30' }), [done()])).toBe(false);   // completed before it
    expect(at(partial(), [partial()])).toBe(false);                                       // never completed
    expect(at(done(), [done()])).toBe(false);                                             // itself the completion
    expect(at(partial({ progress: 'completed' }), [done()])).toBe(false);                 // already Completed itself
    expect(at(partial(), [done({ deleted: true, progress: 'partial' })])).toBe(false);
  });

  // A card too short for a status line (under 40px) shows neither its
  // progress nor the note, so this partial runs 45 minutes.
  it('draws both on the Do side: the partial with its note, the finish after it', () => {
    const recordJobo = vi.fn();
    const html = render({ joboRecords: [partial({ startTime: '08:30' }), done()], recordJobo });
    expect(html).toContain('data-jobo-finished-later');
    expect(html).toContain('jobo.view.finishedLater');
    expect(html).toContain('~09:15–09:30');
    expect(render({ joboRecords: [partial()] })).not.toContain('data-jobo-finished-later');
    expect(recordJobo).not.toHaveBeenCalled();
  });
});

describe('an unfinished Do can be continued', () => {
  const plan = { date: '2026-09-24', startTime: '09:00', duration: 30 };

  it('offers Continue on an unfinished linked attempt, and not on a completed, unlinked or estimated one', () => {
    expect(render({ joboRecords: [timed({ progress: 'partial', planSnapshot: plan })] })).toContain('data-jobo-continue');
    expect(render({ joboRecords: [timed({ progress: 'completed', planSnapshot: plan })] })).not.toContain('data-jobo-continue');
    expect(render({ joboRecords: [timed({ taskId: null })] })).not.toContain('data-jobo-continue');
    expect(render({ joboRecords: [point({ planSnapshot: plan })] })).not.toContain('data-jobo-continue');
    expect(render({ joboRecords: [timed({ progress: 'partial' })], joboWritable: false })).not.toContain('data-jobo-continue');
  });

  // MUTATION: drop the task or the plan from continueInitial and the
  // follow-up is a separate "Unplanned" execution instead of a second session.
  it('the follow-up shares the task and captured plan, so it groups with the original', async () => {
    const { continueInitial } = await import('./JoboView.jsx');
    const { createManualDo } = await import('../jobo/viewActions.js');
    const { buildJoboDayModel } = await import('../jobo/viewModel.js');
    const first = timed({ progress: 'partial', planSnapshot: plan });
    const initial = continueInitial(first, '2026-09-24', 11 * 60);
    expect(initial).toMatchObject({ title: 'Deep work', continuing: true, planSnapshot: plan });
    const next = createManualDo({ id: 'manual:2', title: initial.title, task: initial.task, planSnapshot: initial.planSnapshot,
      date: initial.date, startMinute: initial.startMinute, duration: initial.duration, now: Date.parse('2026-09-24T16:00:00Z') });
    expect(next).toMatchObject({ taskId: 't1', planSnapshot: plan, progress: 'started', startTime: '11:00' });
    const model = buildJoboDayModel({ date: '2026-09-24', tasks: [task], records: [first, next] });
    expect(model.timedRecords).toHaveLength(2);
    const [a, b] = model.timedRecords;
    expect(a.groupKey).toBe(b.groupKey);
    expect(a.attempts.map((attempt) => attempt.id ?? attempt.record?.id).sort()).toEqual(['manual:1', 'manual:2']);
  });
});

describe('a single timing status reads on the status line', () => {
  it('"Unplanned" sits beside the progress rather than on a line of its own', async () => {
    const { cardSignals } = await import('./jobo/DoColumn.jsx');
    const t = (key) => key;
    expect(cardSignals({ planContext: 'noPlan', metrics: {} }, t)).toEqual({ inline: { key: 'unplanned', text: 'jobo.view.summary.unplanned' }, rows: [] });
    expect(cardSignals({ metrics: { untimedAttemptCount: 1 } }, t).inline).toMatchObject({ text: 'jobo.view.timeIncompleteShort', title: 'jobo.view.timeIncomplete' });
    expect(cardSignals(null, t)).toEqual({ inline: null, rows: [] });
    const html = render({ joboRecords: [timed({ taskId: null, progress: 'partial' })] });
    expect(html).toMatch(/10:00–11:00 · jobo\.view\.progress\.partial<span data-jobo-axis="unplanned"> · jobo\.view\.summary\.unplanned<\/span>/);
  });
});

describe('a Do card opens its task\'s notes and pairs with its Plan card', () => {
  it('offers Notes on a Do linked to a task, and not on an unlinked one', () => {
    expect(render({ joboRecords: [timed()] })).toContain('data-jobo-notes-toggle');
    expect(render({ joboRecords: [timed({ taskId: null })] })).not.toContain('data-jobo-notes-toggle');
  });

  // MUTATION: render DayViewColumn outside the wrapper and hovering a Plan
  // card no longer finds its Do cards.
  it('wraps DAY\'s column in the hover listener without changing the grid', () => {
    const html = render();
    expect(html).toMatch(/<div class="contents" data-jobo-pairing="true"><div data-plan-column/);
  });
});

describe('START to END only', () => {
  it('windowRange widens the window to whole hours and falls back to the whole day', async () => {
    const { windowRange } = await import('./jobo/DoColumn.jsx');
    expect(windowRange({ start: '07:30', stop: '18:15' })).toEqual({ startHour: 7, endHour: 19 });
    expect(windowRange({ start: '06:00', stop: null })).toEqual({ startHour: 6, endHour: 24 });
    expect(windowRange({ start: null, stop: '22:00' })).toEqual({ startHour: 0, endHour: 22 });
    expect(windowRange({ start: '22:00', stop: '06:00' })).toEqual({ startHour: 0, endHour: 24 });
    expect(windowRange(null)).toEqual({ startHour: 0, endHour: 24 });
  });

  it('offers the toggle only on a day with a window', () => {
    expect(render()).not.toContain('data-jobo-window-toggle');
    expect(render({ getDayWindow: () => ({ start: '08:00', stop: '18:00' }) })).toContain('data-jobo-window-toggle');
  });

  // MUTATION: leave the Do side at 24 hours, or drop windowStart from a card's
  // top, and the two sides no longer line up.
  it('with the toggle on, both sides draw START to END and cards sit relative to START', () => {
    vi.stubGlobal('localStorage', { getItem: () => '1', setItem: () => {} });
    try {
      const html = render({ getDayWindow: () => ({ start: '08:00', stop: '18:00' }), joboRecords: [timed()] });
      expect(fixture.planColumns[0]).toMatchObject({ startHour: 8, endHour: 18 });
      expect(html.match(/border-b border-dashed/g)).toHaveLength(10);
      expect(html).toContain('top:320px'); // 10:00 is two hours after 08:00, at 160px an hour
      expect(html).toContain('aria-pressed="true"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('the notes sidebar', () => {
  afterEach(() => { wideCalendar = false; });
  const wideScreen = (matches) => {
    wideCalendar = matches;
    vi.stubGlobal('localStorage', { getItem: (key) => (key === 'dg-jobo-notes-sidebar' ? '1' : null), setItem: () => {} });
  };

  it('opens on a wide screen when chosen, with the Daily Note on top', () => {
    wideScreen(true);
    try {
      const html = render({}, { dailyNotes: { '2026-09-24': { text: 'Standup moved to 10' } } });
      expect(html).toContain('data-jobo-notes-sidebar');
      expect(html).toContain('data-jobo-notes-sidebar-toggle');
      expect(html).toContain('Standup moved to 10');
      expect(html).toContain('jobo.view.selectForNotes');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // MUTATION: go back to a fixed width and Plan, Do and Notes stop matching.
  it('is one third of the view, the same width as Plan and as Do', () => {
    wideScreen(true);
    try {
      expect(render()).toMatch(/data-jobo-notes-sidebar[^>]*class="w-\[calc\(\(100%-4rem\)\/3\)\] min-w-80 /);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The button stays at the top right: the end of the Do header while the
  // sidebar is closed, the end of the sidebar's header row once it opens.
  it('keeps its labelled blue button at the top right, open or closed', () => {
    const button = /<button[^>]*data-jobo-notes-sidebar-toggle[^>]*class="h-7 px-2\.5[^"]*bg-blue-600[^"]*"[^>]*>.*?task\.notes<\/span><\/button>/s;
    wideScreen(true);
    try {
      const open = render();
      expect(open).toMatch(button);
      expect(open).toMatch(/data-jobo-sidebar-header[^>]*>\s*<button[^>]*data-jobo-notes-sidebar-toggle/);
      expect(open.match(/data-jobo-notes-sidebar-toggle/g)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
    wideCalendar = true;
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    try {
      const closed = render();
      expect(closed).not.toContain('data-jobo-notes-sidebar"');
      expect(closed).toMatch(button);
      expect(closed).toMatch(/jobo\.view\.addDo<\/span><\/button><button[^>]*data-jobo-notes-sidebar-toggle/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is not offered below the three-column calendar width, whatever was chosen', () => {
    wideScreen(false);
    try {
      const html = render();
      expect(html).not.toContain('data-jobo-notes-sidebar');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // The Daily Note edits in place, but only through useDailyNoteDraft, the
  // Daily Notes modal's own read-fresh and write-back rules, fed the app's
  // vault reader. MUTATION: write the note directly, or drop the reader, and
  // the sidebar could overwrite a vault note with its older copy.
  it('edits the Daily Note only through the modal\'s rules', () => {
    const sidebar = readFileSync(new URL('./jobo/JoboNotesSidebar.jsx', import.meta.url), 'utf8');
    expect(sidebar).not.toMatch(/setDailyNotes\(|saveDailyNote|readDailyNote/);
    expect(sidebar).toContain('useDailyNoteDraft(');
    expect(sidebar).toMatch(/loadFresh=\{loadDailyNoteFresh\}/);
    const modal = readFileSync(new URL('./DailyNotesModal.jsx', import.meta.url), 'utf8');
    expect(modal).toContain('useDailyNoteDraft(');
  });
});

// Multi-user: the Do side shows only this member's completions. The filter
// lives in the features context; the planner context has none, which is how
// the view once looked in the wrong place and filtered nothing.
// Slice 6: other views show a past day's Do; JOBO's Plan side stays on the
// plan (its Do side already shows the Do), and a recorded Do is striped in
// every view, JOBO included.
describe('past days and the Do look', () => {
  // MUTATION: drop planOnly and a past day's Plan side fills with Do.
  it('keeps the Plan side on the plan', () => {
    render();
    expect(fixture.planColumns[0].planOnly).toBe(true);
  });

  it('stripes a recorded Do, and not an estimate or a completion marker', () => {
    const striped = (html, id) => new RegExp(`data-jobo-record="${id}"[^>]*style="[^"]*repeating-linear-gradient`).test(html);
    expect(striped(render({ joboRecords: [timed()] }), 'manual:1')).toBe(true);
    expect(striped(render({ joboRecords: [point({ planSnapshot: { date: '2026-09-24', startTime: '08:30', duration: 60 } })] }), 'do:t1:x')).toBe(false);
    expect(striped(render({ joboRecords: [point()] }), 'do:t1:x')).toBe(false);
  });
});

describe('a short card still says its status', () => {
  // MUTATION: drop the tooltip and a 15-minute Do shows no progress at all.
  it('puts the status line in the tooltip when there is no room to show it', () => {
    const html = render({ joboRecords: [timed({ startTime: '10:00', endTime: '10:15', progress: 'partial' })] });
    expect(html).toMatch(/data-jobo-record="manual:1"[^>]*title="10:00–10:15 · jobo\.view\.progress\.partial/);
    const tall = render({ joboRecords: [timed({ progress: 'partial' })] });
    expect(tall).not.toMatch(/data-jobo-record="manual:1"[^>]*title=/);
  });
});

describe('a card\'s details close on a second click', () => {
  // MUTATION: always open (the old behaviour) and a second click on the card
  // leaves the details up, with only Esc to close them.
  it('toggles on the same card, and moves to another card', async () => {
    const { toggleDetails } = await import('./JoboView.jsx');
    const a = { id: 'a' }, b = { id: 'b' };
    const open = toggleDetails(null, a, 'anchor-a');
    expect(open).toEqual({ item: a, anchor: 'anchor-a' });
    expect(toggleDetails(open, a, 'anchor-a')).toBeNull();
    expect(toggleDetails(open, b, 'anchor-b')).toEqual({ item: b, anchor: 'anchor-b' });
  });
});

describe('a household member sees only their own Do', () => {
  const partner = { ...task, id: 't2', title: 'Partner task', assignedUserSyncIds: ['partner'] };
  const mine = (candidate) => { const ids = candidate.assignedUserSyncIds ?? []; return ids.length === 0 || ids.includes('me'); };
  const theirs = point({ id: 'do:t2:x', taskId: 't2', title: 'Partner task' });

  // MUTATION: read isVisibleForUser from the planner context again and the
  // partner's completion is drawn.
  it('hides completions of tasks assigned to someone else, and keeps shared ones', () => {
    const html = render({ joboRecords: [point(), theirs], isVisibleForUser: mine }, { tasks: [task, partner] });
    expect(html).toContain('data-jobo-record="do:t1:x"');
    expect(html).not.toContain('data-jobo-record="do:t2:x"');
  });

  it('shows everything with multi-user off', () => {
    const html = render({ joboRecords: [point(), theirs], isVisibleForUser: () => true }, { tasks: [task, partner] });
    expect(html).toContain('data-jobo-record="do:t2:x"');
  });
});

describe('an estimate can be kept in one click', () => {
  const planned = () => point({ planSnapshot: { date: '2026-09-24', startTime: '08:30', duration: 60 } });

  it('offers Keep on an estimate, and not on a timed Do or a read-only ledger', () => {
    expect(render({ joboRecords: [planned()] })).toContain('data-jobo-keep');
    expect(render({ joboRecords: [timed()] })).not.toContain('data-jobo-keep');
    expect(render({ joboRecords: [planned()], joboWritable: false })).not.toContain('data-jobo-keep');
  });
});

describe('the Do card\'s notes icon follows the timeline card', () => {
  it('shows the Obsidian book, lit, for a task whose note is in the vault', () => {
    const html = render({ joboRecords: [timed()] }, { tasks: [{ ...task, title: '[[Native Plan]]' }], getTasksForDate: () => [{ ...task, title: '[[Native Plan]]' }] });
    const button = html.match(/<button[^>]*data-jobo-notes-toggle[^>]*>.*?<\/button>/s)[0];
    expect(button).toContain('lucide-book-open');
    expect(button).not.toMatch(/class="[^"]*opacity-40/);
  });

  it('is faded with the document icon when there is nothing to open', () => {
    const button = render({ joboRecords: [timed()] }).match(/<button[^>]*data-jobo-notes-toggle[^>]*>.*?<\/button>/s)[0];
    expect(button).toContain('opacity-40');
    expect(button).toContain('lucide-file-text');
  });
});

// Timeline magnification (utils/timelineZoom.js): JOBO's level multiplies
// the hour height both sides draw at, and the Do cards' contents draw at it
// while keeping the tier they have at 100%.
describe('JOBO at a magnified timeline', () => {
  const at = (zoom, records) => render({ joboRecords: records }, { timelineZooms: { jobo: zoom }, setTimelineZoom: vi.fn() });

  it('draws both sides at the zoomed hour height', () => {
    at(1.5, []);
    expect(fixture.planColumns[0]).toMatchObject({ hourHeight: 240, zoom: 1.5 });
  });

  // MUTATION: decide the tier on the zoomed height and a 15-minute card at
  // 150% loses its compact layout, with its text drawn half as large again.
  it('keeps a short card short, drawing its contents larger', () => {
    const html = at(1.5, [timed({ endTime: '10:15', progress: 'partial' })]);
    expect(html).toMatch(/data-jobo-record="manual:1"[^>]*title="10:00–10:15 · jobo\.view\.progress\.partial/);
    expect(html).toMatch(/data-jobo-record="manual:1"[^]*?style="zoom:1\.5"/);
  });

  // MUTATION: go back to DAY's hour, which fits eight hours in the window,
  // and on an ordinary screen a 15-minute card is too short for its own
  // contents: the Plan card's tag line is cut off below its title.
  it('draws at MULTI\'s hour, so a 15-minute card on either side is 40px', () => {
    const html = render({ joboRecords: [timed({ endTime: '10:15', progress: 'partial' })] });
    expect(fixture.planColumns[0].hourHeight).toBe(SCROLLING_HOUR_PX);
    expect(SCROLLING_HOUR_PX / 4).toBe(40);
    expect(html).toMatch(/data-jobo-record="manual:1"[^>]*style="top:1600px;height:38px;/);
  });

  it('draws at 100% where no level is stored', () => {
    const html = render({ joboRecords: [timed()] });
    expect(fixture.planColumns[0]).toMatchObject({ hourHeight: 160 });
    expect(html).not.toContain('zoom:');
  });
});

