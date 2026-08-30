import { describe, it, expect, vi } from 'vitest';

// Phase 7's pure half, pinned (the plugin's bridge.ts has no test infra, so
// every decision the transport makes lives here — the pure/wiring split that
// kept normalize-then-observe honest). The invariant under test throughout:
// ARMED BY PROOF, DISARMED BY REFUTATION — a de-paired or auth-refused
// plugin makes zero connection attempts until a drain succeeds again.

import {
  parseSseFrame,
  drainSseBuffer,
  sseBackoffMs,
  createSseArming,
  createSseNudgeGate,
  SSE_READ_TIMEOUT_MS,
} from './bridgeSse.js';

describe('the wire parsers (shared with dayGLANCE, one parser per wire format)', () => {
  it('parses activity frames, ignores heartbeat comments, tolerates unknown fields', () => {
    expect(parseSseFrame('event: activity\ndata: {"seq":42}')).toEqual({ seq: 42 });
    expect(parseSseFrame(': heartbeat')).toBe(null);
    expect(parseSseFrame('event: ready\ndata: {"seq":7,"app":"future-field"}')).toEqual({ seq: 7, app: 'future-field' });
    expect(parseSseFrame('data: not json')).toBe(null);
  });

  it('drainSseBuffer emits complete events and returns the partial remainder', () => {
    const seen = [];
    const rest = drainSseBuffer(
      'event: activity\ndata: {"seq":1}\n\n: heartbeat\n\nevent: activity\ndata: {"se',
      (e) => seen.push(e.seq),
    );
    expect(seen).toEqual([1]);
    expect(rest).toBe('event: activity\ndata: {"se');
  });
});

describe('sseBackoffMs (5s doubling to 60s)', () => {
  it('pins the schedule', () => {
    expect([1, 2, 3, 4, 5, 6, 99].map(sseBackoffMs)).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 60000]);
    expect(sseBackoffMs(0)).toBe(5000); // degenerate input clamps to the base
  });

  it('read timeout is three server heartbeats', () => {
    expect(SSE_READ_TIMEOUT_MS).toBe(60_000); // server heartbeat is ~20s
  });
});

describe('createSseArming — armed by proof, disarmed by refutation', () => {
  const desktopPaired = { desktop: true, paired: true };

  it('starts UNPROVEN: no connection before the first successful drain, whatever the platform says', () => {
    const a = createSseArming();
    expect(a.shouldConnect(desktopPaired)).toBe(false);
  });

  it('a successful drain is the proof; auth failure and unpairing are refutations, each holding until the NEXT proof', () => {
    const a = createSseArming();
    a.noteDrainSuccess();
    expect(a.shouldConnect(desktopPaired)).toBe(true);

    // The observed incident: plugin-settings sync stripped the credentials.
    a.noteUnpaired();
    expect(a.shouldConnect(desktopPaired)).toBe(false);
    // Zero attempts until proof returns — not "retry with backoff".
    expect(a.shouldConnect(desktopPaired)).toBe(false);
    a.noteDrainSuccess();
    expect(a.shouldConnect(desktopPaired)).toBe(true);

    a.noteAuthFailure(); // 401/403 at connect or from a drain
    expect(a.shouldConnect(desktopPaired)).toBe(false);
  });

  it('desktop and paired are gates re-read at every decision — mobile never connects, an unpaired input gates even while proven', () => {
    const a = createSseArming();
    a.noteDrainSuccess();
    expect(a.shouldConnect({ desktop: false, paired: true })).toBe(false); // iPad with a keyboard is still mobile
    expect(a.shouldConnect({ desktop: true, paired: false })).toBe(false);
    expect(a.shouldConnect({ desktop: true, paired: true })).toBe(true);
  });
});

describe('createSseNudgeGate — cursor, own-ack skip, debounce', () => {
  const make = (onDrain, opts = {}) => {
    vi.useFakeTimers();
    return createSseNudgeGate({ onDrain, debounceMs: 100, ...opts });
  };
  const done = () => vi.useRealTimers();

  it('a peer nudge drains after the debounce; a burst collapses into one drain', () => {
    const onDrain = vi.fn();
    const g = make(onDrain);
    g.handleEvent({ seq: 1 });
    g.handleEvent({ seq: 2 });
    g.handleEvent({ seq: 3 });
    vi.advanceTimersByTime(100);
    expect(onDrain).toHaveBeenCalledTimes(1);
    expect(g.getCursor()).toBe(3);
    done();
  });

  it('stale/coalesced seqs are ignored; malformed events are ignored', () => {
    const onDrain = vi.fn();
    const g = make(onDrain);
    expect(g.handleEvent({ seq: 5 })).toBe(true);
    expect(g.handleEvent({ seq: 5 })).toBe(false);
    expect(g.handleEvent({ seq: 4 })).toBe(false);
    expect(g.handleEvent(null)).toBe(false);
    expect(g.handleEvent({ seq: 'x' })).toBe(false);
    done();
  });

  it('OWN-ACK SKIP: the echo of our own write (exact ack seq) advances the cursor and drains nothing — an observation emit costs zero drains', () => {
    const onDrain = vi.fn();
    const g = make(onDrain);
    g.recordOwnSeq(10); // ack from our observation batch / soft-delete
    expect(g.handleEvent({ seq: 10 })).toBe(false);
    expect(g.getCursor()).toBe(10); // cursor still advances past our echo
    vi.advanceTimersByTime(500);
    expect(onDrain).not.toHaveBeenCalled();

    // A pending PEER drain keeps its timer when an own echo arrives after it.
    g.handleEvent({ seq: 11 });
    g.recordOwnSeq(12);
    g.handleEvent({ seq: 12 });
    vi.advanceTimersByTime(100);
    expect(onDrain).toHaveBeenCalledTimes(1);
    done();
  });

  it('the ack ring is bounded and tolerates garbage', () => {
    const g = make(vi.fn(), { ackCapacity: 2 });
    g.recordOwnSeq(1); g.recordOwnSeq(2); g.recordOwnSeq(3); // evicts 1
    g.recordOwnSeq(NaN); g.recordOwnSeq(-5); g.recordOwnSeq('7'); // all ignored
    expect(g.handleEvent({ seq: 1 })).toBe(true); // evicted → treated as peer
    expect(g.handleEvent({ seq: 2 })).toBe(false); // still a recorded own ack
    expect(g.handleEvent({ seq: 4 })).toBe(true); // never ours → peer
    done();
  });

  it('cancel clears a pending drain (unload path)', () => {
    const onDrain = vi.fn();
    const g = make(onDrain);
    g.handleEvent({ seq: 1 });
    g.cancel();
    vi.advanceTimersByTime(500);
    expect(onDrain).not.toHaveBeenCalled();
    done();
  });
});
