import { describe, it, expect } from 'vitest';
import { EVENTS } from '@glance-apps/intents';
import { buildNotifyPayload, planTaskNotifyEmits } from './useNotifyEmitter.js';

const BASE_TASK = {
  id: 'task-1',
  title: 'Water plants',
  source_app: 'app.lastglance',
  source_entity_id: 'chore_42',
};

const COMPLETED_CHANGE = {
  event: EVENTS.COMPLETED,
  completed_at: '2026-05-30T10:00:00.000Z',
};

const NOW = '2026-05-30T10:00:00.000Z';

describe('buildNotifyPayload', () => {
  it('uses transitionId as payload event_id when the task carries one', () => {
    const knownId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
    const task = { ...BASE_TASK, transitionId: knownId };
    const payload = buildNotifyPayload(task, COMPLETED_CHANGE, NOW);
    expect(payload.event_id).toBe(knownId);
  });

  it('falls back to a generated id when the task has no transitionId', () => {
    const task = { ...BASE_TASK };
    const payload = buildNotifyPayload(task, COMPLETED_CHANGE, NOW);
    expect(typeof payload.event_id).toBe('string');
    expect(payload.event_id.length).toBeGreaterThan(0);
    expect(payload.event_id).not.toBe('f47ac10b-58cc-4372-a567-0e02b2c3d479');
  });

  it('carries source_app, source_entity_id, event, task_id, title, timestamp', () => {
    const task = { ...BASE_TASK, transitionId: 'some-uuid' };
    const payload = buildNotifyPayload(task, COMPLETED_CHANGE, NOW);
    expect(payload.source_app).toBe('app.lastglance');
    expect(payload.source_entity_id).toBe('chore_42');
    expect(payload.event).toBe(EVENTS.COMPLETED);
    expect(payload.task_id).toBe('task-1');
    expect(payload.title).toBe('Water plants');
    expect(payload.timestamp).toBe(NOW);
  });

  it('includes completed_at when provided in the change', () => {
    const task = { ...BASE_TASK, transitionId: 'some-uuid' };
    const payload = buildNotifyPayload(task, COMPLETED_CHANGE, NOW);
    expect(payload.completed_at).toBe('2026-05-30T10:00:00.000Z');
  });

  it('omits completed_at when not in the change', () => {
    const task = { ...BASE_TASK, transitionId: 'some-uuid' };
    const change = { event: EVENTS.UPDATED, due: '2026-06-01' };
    const payload = buildNotifyPayload(task, change, NOW);
    expect('completed_at' in payload).toBe(false);
  });

  it('includes completed_by_user_id when meUserSyncId provided and change has completed_at', () => {
    const task = { ...BASE_TASK, transitionId: 'some-uuid' };
    const payload = buildNotifyPayload(task, COMPLETED_CHANGE, NOW, 'user-sync-id-abc');
    expect(payload.completed_by_user_id).toBe('user-sync-id-abc');
  });

  it('omits completed_by_user_id when meUserSyncId is null', () => {
    const task = { ...BASE_TASK, transitionId: 'some-uuid' };
    const payload = buildNotifyPayload(task, COMPLETED_CHANGE, NOW, null);
    expect('completed_by_user_id' in payload).toBe(false);
  });

  it('omits completed_by_user_id for non-completion events even when meUserSyncId provided', () => {
    const task = { ...BASE_TASK, transitionId: 'some-uuid' };
    const change = { event: EVENTS.UPDATED, due: '2026-06-01' };
    const payload = buildNotifyPayload(task, change, NOW, 'user-sync-id-abc');
    expect('completed_by_user_id' in payload).toBe(false);
  });
});

describe('planTaskNotifyEmits — remote-apply echo guard', () => {
  const linked = { ...BASE_TASK }; // carries source_app + source_entity_id

  it('emits DELETED when a linked task is removed by a USER action (not remote)', () => {
    const { emits, advanceTo } = planTaskNotifyEmits([linked], [], { isRemoteApply: false });
    expect(emits).toHaveLength(1);
    expect(emits[0].task.id).toBe('task-1');
    expect(emits[0].change.event).toBe(EVENTS.DELETED);
    // Not advanced yet — the snapshot advances only after a durable enqueue.
    expect(advanceTo).toBeNull();
  });

  it('does NOT emit when the same removal is driven by a sync/remote apply', () => {
    const { emits, advanceTo } = planTaskNotifyEmits([linked], [], { isRemoteApply: true });
    expect(emits).toHaveLength(0);
    // Remote change is consumed into the baseline silently.
    expect(advanceTo).toEqual([]);
  });

  it('does NOT emit for a remote-driven field change either', () => {
    const changed = { ...linked, title: 'Renamed remotely' };
    const { emits, advanceTo } = planTaskNotifyEmits([linked], [changed], { isRemoteApply: true });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([changed]);
  });

  it('emits UPDATED for a user field change (guard does not suppress real actions)', () => {
    const changed = { ...linked, title: 'Renamed by user' };
    const { emits } = planTaskNotifyEmits([linked], [changed], { isRemoteApply: false });
    expect(emits).toHaveLength(1);
    expect(emits[0].change.event).toBe(EVENTS.UPDATED);
  });

  it('never emits for a brand-new task (creation is not a notify)', () => {
    const { emits, advanceTo } = planTaskNotifyEmits([], [linked], { isRemoteApply: false });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([linked]);
  });

  it('ignores tasks without source linkage', () => {
    const local = { id: 'local-1', title: 'Local only' };
    const { emits } = planTaskNotifyEmits([local], [], { isRemoteApply: false });
    expect(emits).toHaveLength(0);
  });

  it('initial snapshot (prev === null) just seeds the baseline', () => {
    const { emits, advanceTo } = planTaskNotifyEmits(null, [linked], { isRemoteApply: false });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([linked]);
  });

  it('no enabled targets → consume the change without emitting', () => {
    const { emits, advanceTo } = planTaskNotifyEmits([linked], [], { isRemoteApply: false, hasTargets: false });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([]);
  });

  it('in-flight → hold (no emit, no advance) until the running fire() completes', () => {
    const { emits, advanceTo } = planTaskNotifyEmits([linked], [], { isRemoteApply: false, inFlight: true });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toBeNull();
  });
});
