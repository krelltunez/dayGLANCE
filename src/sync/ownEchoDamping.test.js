import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordOwnWriteSeq, isOwnWriteSeq, __resetOwnWritesForTests } from './ownWrites.js';
import { createNudgeCoalescer } from './vaultEventStream.js';

// OWN-ECHO SSE DAMPING (#1455). The server emits each nudge with THE WRITING
// OPERATION'S OWN resulting seq, so "is this our echo?" is exact set
// membership over our writers' acked seqs — identity, not a freshness
// comparison. The load-bearing pin here is the #1450 trap NOT applying: a
// peer write that lands between our pull and our push carries the PEER's
// acked seq (lower than our ack, but never IN our set) and must drain.

beforeEach(() => __resetOwnWritesForTests());
afterEach(() => { __resetOwnWritesForTests(); vi.useRealTimers(); });

describe('own-write ack registry', () => {
  it('records acked seqs and answers by exact identity', () => {
    recordOwnWriteSeq(42);
    expect(isOwnWriteSeq(42)).toBe(true);
    expect(isOwnWriteSeq(41)).toBe(false); // lower ≠ ours — identity, not comparison
    expect(isOwnWriteSeq(43)).toBe(false);
  });

  it('ignores garbage: non-numbers, NaN, zero, negatives never poison the set', () => {
    recordOwnWriteSeq(undefined);
    recordOwnWriteSeq(NaN);
    recordOwnWriteSeq(0);
    recordOwnWriteSeq(-5);
    recordOwnWriteSeq('7');
    expect(isOwnWriteSeq(NaN)).toBe(false);
    expect(isOwnWriteSeq(0)).toBe(false);
    expect(isOwnWriteSeq(7)).toBe(false);
  });

  it('is bounded: old acks age out of the ring, recent ones stay', () => {
    for (let i = 1; i <= 70; i++) recordOwnWriteSeq(i);
    expect(isOwnWriteSeq(1)).toBe(false);   // evicted (capacity 64)
    expect(isOwnWriteSeq(6)).toBe(false);   // evicted
    expect(isOwnWriteSeq(7)).toBe(true);    // oldest survivor
    expect(isOwnWriteSeq(70)).toBe(true);
  });

  it('dedupes a re-recorded ack without burning capacity', () => {
    recordOwnWriteSeq(5);
    recordOwnWriteSeq(5);
    for (let i = 100; i < 163; i++) recordOwnWriteSeq(i); // 63 more — exactly fills
    expect(isOwnWriteSeq(5)).toBe(true);
  });
});

describe('coalescer own-echo suppression', () => {
  beforeEach(() => vi.useFakeTimers());

  it('our own echo advances the cursor but drains NOTHING', () => {
    const onDrain = vi.fn();
    const onOwnEcho = vi.fn();
    recordOwnWriteSeq(10); // our push was acked with maxSeq 10
    const c = createNudgeCoalescer({ onDrain, isOwnSeq: isOwnWriteSeq, onOwnEcho, debounceMs: 100 });

    expect(c.handleEvent({ seq: 10 })).toBe(false);
    expect(onOwnEcho).toHaveBeenCalledWith(10);
    vi.advanceTimersByTime(500);
    expect(onDrain).not.toHaveBeenCalled();
    // Cursor advanced: the suppressed echo can't be replayed as "new" later.
    expect(c.getCursor()).toBe(10);
    expect(c.handleEvent({ seq: 10 })).toBe(false);
  });

  it('THE #1450 TRAP PIN: a peer write between our pull and our push drains — only the exact echo is swallowed', () => {
    const onDrain = vi.fn();
    // The race: we pulled at seq 8, the peer's write landed (its ack: 9),
    // then our push landed (our ack: 10). We know only our own ack.
    recordOwnWriteSeq(10);
    const c = createNudgeCoalescer({ onDrain, isOwnSeq: isOwnWriteSeq, debounceMs: 100 });

    // The peer's nudge arrives: seq 9 is NOT in our ack set → drains, even
    // though it is lower than our latest ack. (A `seq <= lastAck` freshness
    // heuristic would have swallowed exactly this write.)
    expect(c.handleEvent({ seq: 9 })).toBe(true);
    vi.advanceTimersByTime(100);
    expect(onDrain.mock.calls.map((a) => a[0])).toEqual(['sync', 'intents']);

    // Our own echo right behind it: suppressed.
    onDrain.mockClear();
    expect(c.handleEvent({ seq: 10 })).toBe(false);
    vi.advanceTimersByTime(500);
    expect(onDrain).not.toHaveBeenCalled();
  });

  it('an own echo does not cancel a pending drain armed by an earlier peer nudge', () => {
    const onDrain = vi.fn();
    recordOwnWriteSeq(10);
    const c = createNudgeCoalescer({ onDrain, isOwnSeq: isOwnWriteSeq, debounceMs: 100 });

    c.handleEvent({ seq: 9 });         // peer — debounce armed
    vi.advanceTimersByTime(50);
    c.handleEvent({ seq: 10 });        // our echo mid-debounce
    vi.advanceTimersByTime(50);        // original timer expires
    expect(onDrain.mock.calls.map((a) => a[0])).toEqual(['sync', 'intents']);
  });

  it('a later peer nudge after our echo still drains (the cursor kept moving)', () => {
    const onDrain = vi.fn();
    recordOwnWriteSeq(10);
    const c = createNudgeCoalescer({ onDrain, isOwnSeq: isOwnWriteSeq, debounceMs: 100 });

    expect(c.handleEvent({ seq: 10 })).toBe(false); // our echo
    expect(c.handleEvent({ seq: 11 })).toBe(true);  // peer's next write
    vi.advanceTimersByTime(100);
    expect(onDrain).toHaveBeenCalledTimes(2);
  });

  it('without isOwnSeq wired, behavior is exactly the old coalescer (damping is additive)', () => {
    const onDrain = vi.fn();
    recordOwnWriteSeq(10);
    const c = createNudgeCoalescer({ onDrain, debounceMs: 100 });
    expect(c.handleEvent({ seq: 10 })).toBe(true);
    vi.advanceTimersByTime(100);
    expect(onDrain).toHaveBeenCalledTimes(2);
  });
});
