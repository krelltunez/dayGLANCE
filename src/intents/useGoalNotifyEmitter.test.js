import { describe, it, expect } from 'vitest';
import { EVENTS } from '@glance-apps/intents';
import { planGoalNotifyEmits } from './useGoalNotifyEmitter.js';

// A goal linked to a source app (the only kind that notifies outbound).
const LINKED_GOAL = {
  id: 'goal-1',
  title: 'Run a marathon',
  status: 'active',
  source_app: 'app.lifeglance',
  source_entity_id: 'milestone_7',
};

describe('planGoalNotifyEmits — remote-apply echo guard', () => {
  it('emits DELETED when a linked goal is removed by a USER action (not remote)', () => {
    const { emits, advanceTo } = planGoalNotifyEmits([LINKED_GOAL], [], { isRemoteApply: false });
    expect(emits).toHaveLength(1);
    expect(emits[0].goal.id).toBe('goal-1');
    expect(emits[0].change.event).toBe(EVENTS.DELETED);
    // Not advanced yet — the snapshot advances only after a durable enqueue.
    expect(advanceTo).toBeNull();
  });

  it('does NOT emit when the same removal is driven by a sync/remote apply', () => {
    // This is the create→delete-loop fix: a merge that re-drops a just-created
    // goal (setGoals from applyEngineData) must not echo a spurious `deleted`.
    const { emits, advanceTo } = planGoalNotifyEmits([LINKED_GOAL], [], { isRemoteApply: true });
    expect(emits).toHaveLength(0);
    // Remote change is consumed into the baseline silently.
    expect(advanceTo).toEqual([]);
  });

  it('does NOT emit for a remote-driven completion/title change', () => {
    const changed = { ...LINKED_GOAL, status: 'completed' };
    const { emits, advanceTo } = planGoalNotifyEmits([LINKED_GOAL], [changed], { isRemoteApply: true });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([changed]);
  });

  it('emits COMPLETED for a user completion (guard does not suppress real actions)', () => {
    const changed = { ...LINKED_GOAL, status: 'completed' };
    const { emits } = planGoalNotifyEmits([LINKED_GOAL], [changed], { isRemoteApply: false });
    expect(emits).toHaveLength(1);
    expect(emits[0].change.event).toBe(EVENTS.COMPLETED);
  });

  it('never emits for a brand-new goal (an inbound create must not echo)', () => {
    const { emits, advanceTo } = planGoalNotifyEmits([], [LINKED_GOAL], { isRemoteApply: false });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([LINKED_GOAL]);
  });

  it('ignores goals without source linkage', () => {
    const local = { id: 'g-local', title: 'Personal goal', status: 'active' };
    const { emits } = planGoalNotifyEmits([local], [], { isRemoteApply: false });
    expect(emits).toHaveLength(0);
  });

  it('initial snapshot (prev === null) just seeds the baseline', () => {
    const { emits, advanceTo } = planGoalNotifyEmits(null, [LINKED_GOAL], { isRemoteApply: false });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([LINKED_GOAL]);
  });

  it('no enabled targets → consume the change without emitting', () => {
    const { emits, advanceTo } = planGoalNotifyEmits([LINKED_GOAL], [], { isRemoteApply: false, hasTargets: false });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toEqual([]);
  });

  it('in-flight → hold (no emit, no advance) until the running fire() completes', () => {
    const { emits, advanceTo } = planGoalNotifyEmits([LINKED_GOAL], [], { isRemoteApply: false, inFlight: true });
    expect(emits).toHaveLength(0);
    expect(advanceTo).toBeNull();
  });
});
