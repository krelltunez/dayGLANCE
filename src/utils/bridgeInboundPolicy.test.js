import { describe, it, expect } from 'vitest';
import { inboundFailureNotice } from './bridgeInboundPolicy.js';

describe('inboundFailureNotice — the dead-stream toast policy', () => {
  it('key-pending is a hold: not counted, nothing shown', () => {
    expect(inboundFailureNotice('key-pending', 0)).toEqual({ hold: true, count: 0, notice: null });
    expect(inboundFailureNotice('key-pending', 3)).toEqual({ hold: true, count: 3, notice: null });
  });
  it('a single failure warns only; the second consecutive failure shows the dead-stream error', () => {
    expect(inboundFailureNotice('unreachable', 0)).toEqual({ hold: false, count: 1, notice: null });
    expect(inboundFailureNotice('unreachable', 1)).toEqual({ hold: false, count: 2, notice: 'unavailable' });
    expect(inboundFailureNotice('unpaired', 5)).toEqual({ hold: false, count: 6, notice: 'unavailable' });
    expect(inboundFailureNotice(null, 1).notice).toBe('unavailable');
  });
  it('rate-limited shows at once (its own brake is already wall-clock damped) and still counts', () => {
    expect(inboundFailureNotice('rate-limited', 0)).toEqual({ hold: false, count: 1, notice: 'rate-limited' });
  });
});
