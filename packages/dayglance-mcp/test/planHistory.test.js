// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { wirePlanHistory } from '../src/planHistory.js';
import { handleMcpRequest, toBlock, inboxItem, buildMcpReadState } from '../src/model.js';

// A task's plan history on the wire: original_plan, deferrals, plan_trail and
// plan_trail_omitted, each omitted when it has nothing to say. The suite runs
// with TZ=UTC (vitest.config.js), so "this machine's clock" is UTC here.

const MON = '2026-10-05';
const WED = '2026-10-07';
const THU = '2026-10-08';
const FRI = '2026-10-09';
const at = (iso) => Date.parse(iso);

/** Planned Monday 09:00, slipped to Wednesday, Thursday, then Friday 14:00. */
const slipped = (over = {}) => ({
  id: 't1', title: 'Write the report', date: FRI, startTime: '14:00', duration: 60, completed: false,
  originalPlan: { date: MON, startTime: '09:00', duration: 60 },
  deferrals: 4,
  planTrail: [
    { at: at('2026-10-05T10:15:00Z'), date: WED, startTime: '09:00' },
    { at: at('2026-10-07T11:00:00Z'), date: THU, startTime: '16:00' },
    { at: at('2026-10-08T17:30:00Z'), date: FRI, startTime: '14:00' },
  ],
  ...over,
});

const HISTORY_KEYS = ['original_plan', 'deferrals', 'plan_trail', 'plan_trail_omitted'];

describe('wirePlanHistory', () => {
  it('tells the whole story in wire form: first plan, count, trail oldest first, the slips it does not list', () => {
    expect(wirePlanHistory(slipped())).toEqual({
      original_plan: { date: MON, start_time: '09:00', duration_minutes: 60 },
      deferrals: 4,
      plan_trail: [
        { moved_at: { date: MON, time: '10:15' }, date: WED, start_time: '09:00' },
        { moved_at: { date: WED, time: '11:00' }, date: THU, start_time: '16:00' },
        { moved_at: { date: THU, time: '17:30' }, date: FRI, start_time: '14:00' },
      ],
      plan_trail_omitted: 1,
    });
  });

  it('says nothing for a task with no history', () => {
    expect(wirePlanHistory({ id: 'x', date: FRI, startTime: '09:00', duration: 30 })).toEqual({});
    expect(wirePlanHistory(null)).toEqual({});
    expect(wirePlanHistory('task')).toEqual({});
  });

  describe('original_plan', () => {
    it('is omitted while the task still sits where it was first planned', () => {
      const task = { date: MON, startTime: '09:00', duration: 60, originalPlan: { date: MON, startTime: '09:00', duration: 60 } };
      expect(wirePlanHistory(task)).not.toHaveProperty('original_plan');
    });

    it('appears for any part that moved: the date, the time, or the duration it recorded', () => {
      const base = { date: MON, startTime: '09:00', duration: 60 };
      expect(wirePlanHistory({ ...base, startTime: '10:00', originalPlan: base }).original_plan).toEqual({ date: MON, start_time: '09:00', duration_minutes: 60 });
      expect(wirePlanHistory({ ...base, duration: 90, originalPlan: base }).original_plan).toEqual({ date: MON, start_time: '09:00', duration_minutes: 60 });
    });

    it('does not count a duration the baseline never recorded as a change, and leaves it off', () => {
      const plan = { date: MON, startTime: '09:00' };
      expect(wirePlanHistory({ date: MON, startTime: '09:00', duration: 45, originalPlan: plan })).toEqual({});
      expect(wirePlanHistory({ date: FRI, startTime: '09:00', duration: 45, originalPlan: plan }).original_plan).toEqual({ date: MON, start_time: '09:00' });
    });

    it('appears on an inbox task that was once scheduled: it has no plan now', () => {
      const task = { date: null, startTime: null, originalPlan: { date: MON, startTime: '09:00', duration: 30 } };
      expect(wirePlanHistory(task).original_plan).toEqual({ date: MON, start_time: '09:00', duration_minutes: 30 });
    });

    it('is omitted, never thrown on, when the recorded plan is malformed', () => {
      for (const originalPlan of ['Monday', 7, { date: 'Monday', startTime: '09:00' }, { date: MON }, { date: MON, startTime: 900 }, { date: MON, startTime: 'nine' }]) {
        expect(wirePlanHistory({ date: FRI, startTime: '14:00', originalPlan }), JSON.stringify(originalPlan)).not.toHaveProperty('original_plan');
      }
      expect(wirePlanHistory({ date: FRI, startTime: '14:00', originalPlan: { date: MON, startTime: '09:00', duration: 'long' } }).original_plan)
        .toEqual({ date: MON, start_time: '09:00' });
    });
  });

  describe('deferrals', () => {
    it('appears only when the task slipped at least once', () => {
      expect(wirePlanHistory({ deferrals: 0 })).not.toHaveProperty('deferrals');
      expect(wirePlanHistory({ deferrals: 1 })).toEqual({ deferrals: 1 });
    });

    it('stands alone for a task that slipped before the trail was recorded, with no omitted count', () => {
      expect(wirePlanHistory({ date: FRI, startTime: '14:00', deferrals: 3 })).toEqual({ deferrals: 3 });
    });

    it('is omitted when the stored count is not a number', () => {
      for (const deferrals of ['3', -2, NaN, Infinity, true, null, {}]) {
        expect(wirePlanHistory({ deferrals }), String(deferrals)).not.toHaveProperty('deferrals');
      }
    });
  });

  describe('plan_trail', () => {
    it('is oldest first whatever order the row stored it in', () => {
      const task = slipped({ planTrail: [...slipped().planTrail].reverse() });
      expect(wirePlanHistory(task).plan_trail.map((s) => s.date)).toEqual([WED, THU, FRI]);
    });

    it('carries a stop\'s duration when the stop recorded one', () => {
      const task = { deferrals: 1, planTrail: [{ at: at('2026-10-05T10:15:00Z'), date: WED, startTime: '09:00', duration: 45 }] };
      expect(wirePlanHistory(task).plan_trail).toEqual([{ moved_at: { date: MON, time: '10:15' }, date: WED, start_time: '09:00', duration_minutes: 45 }]);
    });

    it('reads moved_at in the user\'s zone when one is given, as created_at is', () => {
      const task = { deferrals: 1, planTrail: [{ at: at('2026-10-05T23:30:00Z'), date: WED, startTime: '09:00' }] };
      expect(wirePlanHistory(task).plan_trail[0].moved_at).toEqual({ date: MON, time: '23:30' });
      expect(wirePlanHistory(task, 'Pacific/Auckland').plan_trail[0].moved_at).toEqual({ date: '2026-10-06', time: '12:30' });
    });

    it('accepts an at stored as a numeric string, as the merge does', () => {
      const task = { deferrals: 1, planTrail: [{ at: String(at('2026-10-05T10:15:00Z')), date: WED, startTime: '09:00' }] };
      expect(wirePlanHistory(task).plan_trail[0].moved_at).toEqual({ date: MON, time: '10:15' });
    });

    it('drops malformed stops, counting them among the slips it does not list', () => {
      const good = { at: at('2026-10-05T10:15:00Z'), date: WED, startTime: '09:00' };
      const task = {
        deferrals: 4,
        planTrail: [null, 'stop', { at: 'soon', date: WED, startTime: '09:00' }, { at: 1, date: 'Wed', startTime: '09:00' }, { at: 2, date: WED }, good],
      };
      expect(wirePlanHistory(task)).toEqual({
        deferrals: 4,
        plan_trail: [{ moved_at: { date: MON, time: '10:15' }, date: WED, start_time: '09:00' }],
        plan_trail_omitted: 3,
      });
      expect(wirePlanHistory({ planTrail: 'not a trail' })).toEqual({});
    });

    it('says null for a moved_at that is not a real instant, rather than dropping the stop', () => {
      const task = { deferrals: 1, planTrail: [{ at: 1e20, date: WED, startTime: '09:00' }] };
      expect(wirePlanHistory(task).plan_trail).toEqual([{ moved_at: null, date: WED, start_time: '09:00' }]);
    });
  });

  describe('plan_trail_omitted', () => {
    it('is the count minus the stops listed, as the panel\'s "+N earlier"', () => {
      const six = Array.from({ length: 6 }, (_, i) => ({ at: at(`2026-10-0${i + 1}T08:00:00Z`), date: `2026-10-0${i + 2}`, startTime: '09:00' }));
      expect(wirePlanHistory({ deferrals: 10, planTrail: six }).plan_trail_omitted).toBe(4);
      expect(wirePlanHistory({ deferrals: 6, planTrail: six })).not.toHaveProperty('plan_trail_omitted');
    });

    it('is never negative: a trail merged ahead of its count lists every stop and omits none', () => {
      expect(wirePlanHistory(slipped({ deferrals: 2 }))).not.toHaveProperty('plan_trail_omitted');
    });
  });
});

describe('plan history rides the task output the read tools return', () => {
  it('on a task block and an inbox item, beside created_at, and on neither when there is none', () => {
    const block = toBlock(slipped());
    expect(block).toMatchObject({ type: 'task', deferrals: 4, plan_trail_omitted: 1 });
    expect(block.original_plan).toEqual({ date: MON, start_time: '09:00', duration_minutes: 60 });
    const inbox = inboxItem({ ...slipped(), date: null, startTime: null });
    expect(inbox).toMatchObject({ deferrals: 4, original_plan: { date: MON, start_time: '09:00', duration_minutes: 60 } });
    expect(inbox.plan_trail).toHaveLength(3);
    const plain = { id: 'p', title: 'Plain', date: FRI, startTime: '09:00', duration: 30 };
    for (const item of [toBlock(plain), inboxItem(plain)]) {
      for (const key of HISTORY_KEYS) expect(item).not.toHaveProperty(key);
    }
  });

  it('never on a calendar event or a device event, even when the row carries the fields', () => {
    const history = { originalPlan: { date: MON, startTime: '09:00' }, deferrals: 2, planTrail: slipped().planTrail };
    const feedEvent = toBlock({ id: 'e1', title: 'Standup', date: FRI, startTime: '10:00', imported: true, ...history });
    const deviceEvent = toBlock({ id: 'n1', title: 'Dentist', date: FRI, startTime: '11:00', _native: true, ...history });
    expect(feedEvent.type).toBe('calendar_event');
    expect(deviceEvent.type).toBe('device_calendar_event');
    for (const block of [feedEvent, deviceEvent]) {
      for (const key of HISTORY_KEYS) expect(block).not.toHaveProperty(key);
    }
  });

  it('on a CalDAV task-calendar task, which is a task the app shows the history for', () => {
    const block = toBlock({ ...slipped(), imported: true, isTaskCalendar: true });
    expect(block).toMatchObject({ type: 'task', source: 'caldav_tasks', deferrals: 4 });
  });

  it('get_day: the slipped task carries it, a recurring occurrence does not (the series records none)', () => {
    const state = buildMcpReadState({
      tasks: [slipped(), { id: 't2', title: 'Fresh', date: FRI, startTime: '09:00', duration: 30, completed: false }],
      recurringTasks: [{
        id: 's1', title: 'Standup', startTime: '08:00', duration: 15, isAllDay: false,
        recurrence: { type: 'daily', startDate: '2026-09-01' },
        // Fields a series never carries in the app; even so, an occurrence does not inherit them.
        originalPlan: { date: MON, startTime: '07:00' }, deferrals: 3, planTrail: slipped().planTrail,
      }],
    }, { now: Date.parse(`${FRI}T07:00:00Z`) });
    const r = handleMcpRequest(state, { method: 'get_day', params: { date: FRI } });
    const byId = Object.fromEntries(r.data.blocks.map((b) => [b.id, b]));
    expect(byId.t1).toMatchObject({ deferrals: 4, plan_trail_omitted: 1 });
    for (const id of ['t2', `recurring-s1-${FRI}`]) {
      for (const key of HISTORY_KEYS) expect(byId[id], `${id} ${key}`).not.toHaveProperty(key);
    }
  });

  it('a host reports moved_at in the user\'s zone, through the state it builds', () => {
    const task = { ...slipped(), planTrail: [{ at: at('2026-10-08T23:30:00Z'), date: FRI, startTime: '14:00' }] };
    const state = buildMcpReadState({ tasks: [task] }, { now: Date.parse(`${FRI}T07:00:00Z`), timeZone: 'Pacific/Auckland' });
    const r = handleMcpRequest(state, { method: 'get_day', params: { date: FRI } });
    expect(r.data.blocks[0].plan_trail[0].moved_at).toEqual({ date: FRI, time: '12:30' });
  });

  it('list_unscheduled and list_bucket_list items carry it too', () => {
    const inboxTask = { ...slipped(), id: 'i1', date: null, startTime: null };
    const bucketTask = { ...slipped(), id: 'k1', date: null, startTime: null, bucketId: 'b1' };
    const state = buildMcpReadState({ unscheduledTasks: [inboxTask, bucketTask] }, { now: Date.parse(`${FRI}T07:00:00Z`) });
    const inbox = handleMcpRequest(state, { method: 'list_unscheduled', params: {} }).data.items;
    expect(inbox.map((i) => [i.id, i.deferrals])).toEqual([['i1', 4]]);
    const bucket = handleMcpRequest(state, { method: 'list_bucket_list', params: {} }).data.lists.flatMap((l) => l.items);
    expect(bucket.map((i) => [i.id, i.deferrals, i.original_plan?.date])).toEqual([['k1', 4, MON]]);
  });
});
