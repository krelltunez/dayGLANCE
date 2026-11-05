import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOvernightVectors, OVERNIGHT_VECTORS_PATH } from './overnightVectors.js';

// The committed fixture is what the GLANCElauncher's native port of the
// overnight carry rule is checked against (docs/launcher-integration.md,
// "Tasks that run past midnight"). It must always be what agenda-core's
// overnight.js produces NOW, or a change to the rule ships with the port
// still passing against yesterday's numbers.

const fixtureUrl = new URL(`../../${OVERNIGHT_VECTORS_PATH}`, import.meta.url);

describe('overnight vectors fixture', () => {
  it('matches what agenda-core produces now (refresh with `npm run ios:vectors`)', () => {
    expect(buildOvernightVectors()).toEqual(JSON.parse(readFileSync(fixtureUrl, 'utf8')));
  });

  it('pins the rule\'s edges: a piece past midnight, nothing at exactly 24:00, a whole day at most', () => {
    const { spill, continuations, frameSlots } = buildOvernightVectors();
    const by = (name) => spill.cases.find((c) => c.name.startsWith(name)).expected.spillMinutes;
    expect(by('crosses midnight')).toBe(60);
    expect(by('ends exactly at 24:00')).toBe(0);
    expect(by('an imported event longer than a day')).toBe(1440);
    expect(by('all-day')).toBe(0);
    expect(continuations.cases[0].expected.map((c) => c.id))
      .toEqual(['night', 'recurring-backup-2026-11-02', 'native-cal-7-2026-11-02']);
    expect(frameSlots.cases[0].expected).toEqual([{ start: '01:00', end: '03:00' }]);
  });
});
