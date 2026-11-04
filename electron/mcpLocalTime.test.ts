import { describe, it, expect } from 'vitest';
import { validateDurationMinutes } from './mcpLocalTime.js';

// The block-duration bound of dayGLANCE's write tools. The wall-clock and DST
// rules moved to @glance-apps/mcp-host (packages/mcp-host/test/localTime.test.js).

describe('validateDurationMinutes', () => {
  it('accepts 1..1440 integers', () => {
    expect(validateDurationMinutes(1)).toBeNull();
    expect(validateDurationMinutes(60)).toBeNull();
    expect(validateDurationMinutes(1440)).toBeNull();
  });
  it('rejects zero, negatives, fractions, overflows, and non-numbers', () => {
    for (const v of [0, -30, 2.5, 1441, '60', null, undefined, NaN]) {
      expect(validateDurationMinutes(v), String(v)).not.toBeNull();
    }
  });
});
