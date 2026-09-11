import { describe, it, expect } from 'vitest';

import {
  MOON_DOWN,
  MOON_UP,
  getMoonAltitude,
  getMoonIllumination,
  getMoonPosition,
  getMoonTimes,
} from './lunar.js';

// Denver, the coordinates the README capture uses.
const DEN = { lat: 39.7392, lon: -104.9903 };

// Eclipses are the one kind of phase anchor that needs no almanac: a solar
// eclipse IS new moon and a lunar eclipse IS full moon, by definition. Four of
// them, spread over eight years, pin both the phase and its rate.
const SOLAR_ECLIPSES = ['2024-04-08T18:17:00Z', '2017-08-21T18:26:00Z'];
const LUNAR_ECLIPSES = ['2022-11-08T10:59:00Z', '2025-03-14T06:59:00Z'];

describe('getMoonIllumination', () => {
  it('reads new moon at a total solar eclipse', () => {
    for (const iso of SOLAR_ECLIPSES) {
      const { fraction, phase } = getMoonIllumination(new Date(iso));
      expect(fraction).toBeLessThan(0.001);
      // Phase wraps at new, so either end of the range counts.
      expect(Math.min(phase, 1 - phase)).toBeLessThan(0.01);
    }
  });

  it('reads full moon at a total lunar eclipse', () => {
    for (const iso of LUNAR_ECLIPSES) {
      const { fraction, phase } = getMoonIllumination(new Date(iso));
      expect(fraction).toBeGreaterThan(0.999);
      expect(phase).toBeCloseTo(0.5, 2);
    }
  });

  it('waxes for the half cycle after new and wanes for the half before', () => {
    const newMoon = new Date('2024-04-08T18:17:00Z').getTime();
    const day = 86_400_000;
    expect(getMoonIllumination(new Date(newMoon + 5 * day)).waxing).toBe(true);
    expect(getMoonIllumination(new Date(newMoon - 5 * day)).waxing).toBe(false);
  });

  it('completes a cycle in a synodic month', () => {
    const from = new Date('2026-01-01T00:00:00Z').getTime();
    const news = [];
    for (let d = 0; d < 400; d++) {
      const a = getMoonIllumination(new Date(from + d * 86_400_000)).phase;
      const b = getMoonIllumination(new Date(from + (d + 1) * 86_400_000)).phase;
      if (a > 0.9 && b < 0.1) news.push(d);
    }
    const gaps = news.slice(1).map((d, i) => d - news[i]);
    const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    expect(mean).toBeCloseTo(29.53, 1);
  });
});

describe('getMoonPosition', () => {
  it('keeps the moon within its orbital inclination of the ecliptic', () => {
    // Declination can reach roughly the obliquity plus the moon's 5.1°
    // inclination, and never more.
    for (let d = 0; d < 60; d++) {
      const { dec } = getMoonPosition(new Date(Date.UTC(2026, 0, 1) + d * 86_400_000));
      expect(Math.abs(dec)).toBeLessThan(29);
    }
  });

  it('stays inside the real perigee/apogee envelope', () => {
    for (let d = 0; d < 60; d++) {
      const { dist } = getMoonPosition(new Date(Date.UTC(2026, 0, 1) + d * 86_400_000));
      expect(dist).toBeGreaterThan(355_000);
      expect(dist).toBeLessThan(407_000);
    }
  });
});

describe('getMoonAltitude', () => {
  it('puts the moon above the horizon during a lunar eclipse that was visible', () => {
    // The March 2025 totality was seen across the Americas, so from Denver the
    // moon has to have been up: an eclipsed moon below the horizon is a
    // contradiction, which makes this a sign check on the whole chain.
    expect(getMoonAltitude(new Date('2025-03-14T06:59:00Z'), DEN.lat, DEN.lon))
      .toBeGreaterThan(0);
  });

  it('sits lower than the geocentric angle, because parallax lowers it', () => {
    // Not a value check — a direction check. The correction only ever
    // subtracts, and vanishes overhead.
    const lows = [];
    for (let h = 0; h < 24; h++) {
      lows.push(getMoonAltitude(new Date(Date.UTC(2026, 6, 2, h)), DEN.lat, DEN.lon));
    }
    expect(Math.min(...lows)).toBeGreaterThan(-90);
    expect(Math.max(...lows)).toBeLessThan(90);
  });
});

describe('getMoonTimes', () => {
  it('slips later day over day, by roughly the lunar retardation', () => {
    const rises = [];
    for (let d = 1; d <= 12; d++) {
      const { moonriseMin } = getMoonTimes(new Date(2026, 6, d, 12), DEN.lat, DEN.lon);
      if (moonriseMin != null) rises.push(moonriseMin);
    }
    // Across a run of consecutive days each rise is later than the last,
    // except where the slip carries it past midnight into the next day.
    const slips = rises.slice(1)
      .map((m, i) => m - rises[i])
      .filter((s) => s > 0);
    expect(slips.length).toBeGreaterThan(4);
    const mean = slips.reduce((s, g) => s + g, 0) / slips.length;
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(80);
  });

  it('reports a day with only one of the two events rather than neither', () => {
    // The moon rises about fifty minutes later each day, so roughly once a
    // month a rise falls off the end of a local day. The pair must be
    // independently nullable or that day reads as no moon at all.
    let onlyOne = 0;
    for (let d = 1; d <= 31; d++) {
      const { moonriseMin, moonsetMin, always } =
        getMoonTimes(new Date(2026, 6, d, 12), DEN.lat, DEN.lon);
      if (always) continue;
      if ((moonriseMin == null) !== (moonsetMin == null)) onlyOne++;
    }
    expect(onlyOne).toBeGreaterThan(0);
  });

  it('tells never-rises from never-sets in the arctic', () => {
    const seen = new Set();
    for (let d = 1; d <= 28; d++) {
      // Longyearbyen: far enough north that the moon does both in a month.
      const { always } = getMoonTimes(new Date(2026, 0, d, 12), 78.22, 15.63);
      if (always) seen.add(always);
    }
    expect(seen).toEqual(new Set([MOON_UP, MOON_DOWN]));
  });

  it('agrees with the altitude it is derived from', () => {
    const date = new Date(2026, 6, 2, 12);
    const { moonriseMin } = getMoonTimes(date, DEN.lat, DEN.lon);
    if (moonriseMin == null) return;
    const at = (min) => getMoonAltitude(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, min), DEN.lat, DEN.lon);
    // Below ten minutes before the crossing, above ten minutes after.
    expect(at(moonriseMin - 10)).toBeLessThan(at(moonriseMin + 10));
    expect(at(moonriseMin + 10)).toBeGreaterThan(0);
  });
});
