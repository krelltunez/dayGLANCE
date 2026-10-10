// A work phase's raw capture. This module has no clock, React or storage.
// The caller supplies an event instant and freezes task context before work.
// Persistence conversion is deliberately separate from timer transitions.

import { planSnapshotOf } from './detector.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const validId = (value) => (typeof value === 'string' && value.trim().length > 0)
  || (typeof value === 'number' && Number.isSafeInteger(value));

function instant(value) {
  if (!Number.isSafeInteger(value) || !Number.isFinite(new Date(value).getTime())) {
    throw new TypeError('Focus capture requires an epoch millisecond instant');
  }
  return value;
}

/** A native action id and a ledger link are distinct for recurring tasks. */
export function captureFocusCandidates(tasks = []) {
  const seen = new Set();
  return tasks.filter((task) => task && validId(task.id)).flatMap((task) => {
    const key = String(task.id);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{
      actionId: task.id,
      taskId: task.recurringTemplateId ?? task.id,
      occurrenceDate: task.recurringTemplateId != null ? task.date ?? null : null,
      title: String(task.title ?? '').trim() || 'Untitled',
      planSnapshot: copy(planSnapshotOf(task)),
    }];
  });
}

export function beginFocusCapture({ id, tasks = [] } = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new TypeError('Focus capture requires a stable phase id');
  return {
    id,
    candidates: captureFocusCandidates(tasks),
    segments: [],
    active: null,
    nextSegment: 0,
    sealed: false,
  };
}

/** Repeated resume events cannot move the start or mint another identity. */
export function resumeFocusCapture(capture, at) {
  if (capture.sealed || capture.active) return capture;
  const startedAt = instant(at);
  return {
    ...capture,
    active: { id: `${capture.id}:${capture.nextSegment}`, startedAt, startOffset: new Date(startedAt).getTimezoneOffset() },
    nextSegment: capture.nextSegment + 1,
  };
}

/** A pause closes work but never asks for attribution or seals the phase. */
export function pauseFocusCapture(capture, at) {
  if (capture.sealed || !capture.active) return capture;
  const endedAt = instant(at);
  if (endedAt < capture.active.startedAt) throw new RangeError('Focus capture clock moved backwards');
  const segment = { ...capture.active, endedAt, endOffset: new Date(endedAt).getTimezoneOffset() };
  return {
    ...capture,
    active: null,
    segments: endedAt > segment.startedAt ? [...capture.segments, segment] : capture.segments,
  };
}

/** Phase end, skip and exit share this idempotent close boundary. */
export function sealFocusCapture(capture, at) {
  if (capture.sealed) return capture;
  return { ...pauseFocusCapture(capture, at), sealed: true };
}

/** Attribution chooses one captured candidate for the whole work phase. */
export function attributeFocusCapture(capture, actionId) {
  if (!capture.sealed) throw new TypeError('A running work phase cannot be attributed');
  const candidate = capture.candidates.find((item) => String(item.actionId) === String(actionId));
  if (!candidate) throw new TypeError('Focus attribution must name a task in the captured block');
  return { captureId: capture.id, candidate: copy(candidate), segments: copy(capture.segments) };
}
