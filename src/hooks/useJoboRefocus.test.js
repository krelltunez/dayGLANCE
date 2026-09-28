import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { nowLineOutOfView } from './useJoboRefocus.js';

// JOBO's Refocus timeline follows MULTI's: the toast shows once the now line
// is wholly out of view. JOBO's lanes sit under a sticky header, so the
// visible bottom is the scroll area less that header.
describe('nowLineOutOfView', () => {
  const view = { scrollTop: 800, clientHeight: 600, headerHeight: 40 };

  it('is in view anywhere between the top and the header-shortened bottom', () => {
    expect(nowLineOutOfView({ ...view, nowOffset: 800 })).toBe(false);
    expect(nowLineOutOfView({ ...view, nowOffset: 1360 })).toBe(false);
  });

  // MUTATION: drop the header from the bottom edge and a now line hidden
  // under the last 40px reads as visible.
  it('is out of view above the top or below the visible bottom', () => {
    expect(nowLineOutOfView({ ...view, nowOffset: 799 })).toBe(true);
    expect(nowLineOutOfView({ ...view, nowOffset: 1361 })).toBe(true);
  });
});

describe('one Refocus timeline toast for MULTI and JOBO', () => {
  it('both views render the shared component', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
    const jobo = readFileSync(new URL('../components/JoboView.jsx', import.meta.url), 'utf8');
    expect(app).toContain('<RefocusTimelineToast');
    expect(jobo).toContain('{refocus.scrolledAway && <RefocusTimelineToast onRefocus={refocus.refocus}');
  });

  it('JOBO refocuses only on today, once loaded, with now inside the hours on show', () => {
    const jobo = readFileSync(new URL('../components/JoboView.jsx', import.meta.url), 'utf8');
    expect(jobo).toContain('enabled: joboLoaded && date === nowDate && nowMinute >= windowStart && nowMinute <= endHour * 60');
  });
});
