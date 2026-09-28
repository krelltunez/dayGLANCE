import { describe, it, expect } from 'vitest';
import { buildJoboDayModel } from './viewModel.js';

const T0 = '2026-09-24T09:00:00.000Z';
const rec = (over = {}) => ({
  id: 'do:t1:a',
  taskId: 't1',
  title: 'Draft report',
  source: 'manual',
  progress: 'completed',
  deleted: false,
  createdAt: T0,
  updatedAt: T0,
  observedAt: T0,
  timing: 'timed',
  date: '2026-09-24',
  startTime: '09:20',
  endDate: '2026-09-24',
  endTime: '09:50',
  planSnapshot: { date: '2026-09-24', startTime: '09:00', duration: 60 },
  ...over,
});

describe('current task resolution for an editor opened from cross-day history', () => {
  it('resolves an off-day attempt even when it has no visible slice', () => {
    const earlier = rec({ id: 'do:t1:earlier', source: 'completion', progress: 'partial' });
    const later = rec({ id: 'do:t1:later', date: '2026-09-25', endDate: '2026-09-25' });
    const task = { id: 't1', title: 'Draft report', completed: true, date: '2026-09-26', startTime: '14:00', duration: 60 };
    const model = buildJoboDayModel({ date: '2026-09-25', tasks: [], taskLookup: [task], records: [earlier, later] });
    expect(model.timedRecords.map(item => item.id)).toEqual([later.id]);
    expect(model.timedRecords[0].attempts.map(item => item.id)).toContain(earlier.id);
    expect(model.resolveRecordTask(earlier)).toBe(task);
    expect(model.resolveRecordTask(earlier).completed).toBe(true);
    const reopened = buildJoboDayModel({ date: '2026-09-25', taskLookup: [{ ...task, completed: false }], records: [earlier, later] });
    expect(reopened.resolveRecordTask(earlier).completed).toBe(false);
    const deleted = buildJoboDayModel({ date: '2026-09-25', records: [earlier, later] });
    expect(deleted.resolveRecordTask(earlier)).toBeNull();
  });

  it('resolves the captured recurring occurrence, not the displayed date or corrected Do date', () => {
    const record = rec({ id: 'do:r1:2026-09-24:2026-09-24T09:30:00+08:00', taskId: 'r1', source: 'completion',
      date: '2026-09-25', endDate: '2026-09-25' });
    const template = { id: 'r1', title: 'Routine', startTime: '09:00', duration: 60, completedDates: ['2026-09-24'] };
    const model = buildJoboDayModel({ date: '2026-09-26', recurringTasks: [template], records: [record] });
    expect(model.timedRecords).toEqual([]);
    expect(model.resolveRecordTask(record)).toMatchObject({ recurringTemplateId: 'r1', date: '2026-09-24', completed: true });
    const otherDate = buildJoboDayModel({ date: '2026-09-26', recurringTasks: [{ ...template, completedDates: ['2026-09-25'] }], records: [record] });
    expect(otherDate.resolveRecordTask(record).completed).toBe(false);
    const allDay = { ...record, planSnapshot: null };
    const noPlan = buildJoboDayModel({ date: '2026-09-26', recurringTasks: [template], records: [allDay] });
    expect(noPlan.resolveRecordTask(allDay)).toMatchObject({ date: '2026-09-24', completed: true });
  });
});
