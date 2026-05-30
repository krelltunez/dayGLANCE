import { describe, it, expect } from 'vitest';
import { EVENTS } from '@glance-apps/intents';
import { buildNotifyPayload } from './useNotifyEmitter.js';

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

  it('falls back to a generated id (not a transitionId) when the task has none', () => {
    const task = { ...BASE_TASK }; // no transitionId
    const payload = buildNotifyPayload(task, COMPLETED_CHANGE, NOW);
    expect(payload.event_id).toBeTruthy();
    expect(payload.event_id).not.toBe(undefined);
    // The fallback value is makeEventId() output — it will not equal any transitionId
    // on the task because there is none. Confirm it's a non-empty string distinct from
    // the fixed UUID used in the other test case.
    expect(typeof payload.event_id).toBe('string');
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
});
