import { describe, it, expect, beforeEach } from 'vitest';
import {
  getPeakSunElevation, getStoredWeatherCoords, getSunElevation, getSunTimes,
  POLAR_DAY, POLAR_NIGHT, storeWeatherCoords,
} from './solar.js';

// Value assertions use longitude ≈ 0 so local (test env: UTC) equals solar
// UT and the expectations hold regardless of algorithm internals. Tolerance
// is generous (±25 min) — the layer draws hairlines, not an almanac.
const close = (actual, expectedMin, tol = 25) => {
  expect(actual).not.toBeNull();
  expect(Math.abs(actual - expectedMin)).toBeLessThanOrEqual(tol);
};

describe('getSunTimes', () => {
  it('matches the ephemeris for London at the June solstice', () => {
    // 2026-06-21, London (51.5074, -0.1278): sunrise 03:43 UT, sunset 20:21 UT.
    const { sunriseMin, sunsetMin } = getSunTimes(new Date(2026, 5, 21), 51.5074, -0.1278);
    close(sunriseMin, 3 * 60 + 43);
    close(sunsetMin, 20 * 60 + 21);
  });

  it('gives a near-12-hour day on the equator at the equinox', () => {
    const { sunriseMin, sunsetMin } = getSunTimes(new Date(2026, 2, 20), 0, 0);
    close(sunriseMin, 6 * 60);
    close(sunsetMin, 18 * 60);
    // Refraction + solar diameter make the day slightly longer than 12h.
    expect(sunsetMin - sunriseMin).toBeGreaterThan(12 * 60);
    expect(sunsetMin - sunriseMin).toBeLessThan(12 * 60 + 30);
  });

  it('tells polar day from polar night instead of collapsing both', () => {
    // Tromsø, 69.65°N: midnight sun in June, polar night in December. Both
    // have no rise or set to mark, but they are opposite days — a caller
    // drawing a lit SPAN has to fill one end to end and leave the other
    // empty, so the distinction cannot be thrown away.
    expect(getSunTimes(new Date(2026, 5, 21), 69.65, 18.95))
      .toEqual({ sunriseMin: null, sunsetMin: null, polar: POLAR_DAY });
    expect(getSunTimes(new Date(2026, 11, 21), 69.65, 18.95))
      .toEqual({ sunriseMin: null, sunsetMin: null, polar: POLAR_NIGHT });
  });

  it('leaves polar null on an ordinary day', () => {
    expect(getSunTimes(new Date(2026, 5, 21), 51.5074, -0.1278).polar).toBeNull();
  });

  it('makes northern summer days longer than winter days', () => {
    const june = getSunTimes(new Date(2026, 5, 21), 41.85, 0);
    const dec = getSunTimes(new Date(2026, 11, 21), 41.85, 0);
    const len = ({ sunriseMin, sunsetMin }) => sunsetMin - sunriseMin;
    expect(len(june)).toBeGreaterThan(len(dec) + 4 * 60);
    expect(june.sunriseMin).toBeLessThan(dec.sunriseMin);
  });
});

describe('getSunElevation', () => {
  // Longitude 0 in a UTC test env, so local clock ≈ solar time and noon is
  // noon. Tolerance is a degree — the band it feeds is a soft gradient.
  const near = (actual, expected, tol = 1) =>
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

  it('peaks at the geometric maximum for the latitude and season', () => {
    // At solar noon the sun stands at (90 - |lat| + declination) degrees.
    // London at the June solstice: 90 - 51.5 + 23.44 = 61.9.
    near(getSunElevation(new Date(2026, 5, 21), 51.5074, 0, 12 * 60), 61.9);
    // ...and at the December solstice, 23.44 below the equator: 15.1.
    near(getSunElevation(new Date(2026, 11, 21), 51.5074, 0, 12 * 60), 15.1);
    // The equinox drops the declination term entirely: 90 - 51.5 = 38.5.
    near(getSunElevation(new Date(2026, 2, 20), 51.5074, 0, 12 * 60), 38.5, 1.5);
  });

  it('puts the sun below the horizon at midnight and above it at noon', () => {
    const at = (min) => getSunElevation(new Date(2026, 5, 21), 51.5074, 0, min);
    expect(at(0)).toBeLessThan(0);
    expect(at(12 * 60)).toBeGreaterThan(0);
    // Monotonic through the morning — this is what shapes the band.
    expect(at(8 * 60)).toBeLessThan(at(10 * 60));
    expect(at(10 * 60)).toBeLessThan(at(12 * 60));
  });

  it('keeps the midnight sun above the horizon around the clock', () => {
    for (let m = 0; m < 1440; m += 60) {
      expect(getSunElevation(new Date(2026, 5, 21), 69.65, 18.95, m)).toBeGreaterThan(0);
    }
  });

  it('never leaves the real range', () => {
    for (const lat of [-89, -23, 0, 39.7, 69.65, 89]) {
      for (let m = 0; m < 1440; m += 97) {
        const e = getSunElevation(new Date(2026, 7, 3), lat, 12, m);
        expect(e).toBeGreaterThanOrEqual(-90);
        expect(e).toBeLessThanOrEqual(90);
      }
    }
  });
});

describe('getPeakSunElevation', () => {
  it('is the best noon of the year for the latitude', () => {
    expect(getPeakSunElevation(39.7392)).toBeCloseTo(73.7, 1);
    expect(getPeakSunElevation(-39.7392)).toBeCloseTo(73.7, 1); // symmetric
    expect(getPeakSunElevation(51.5074)).toBeCloseTo(61.93, 1);
  });

  it('caps inside the tropics, where the sun does pass overhead', () => {
    expect(getPeakSunElevation(0)).toBe(90);
    expect(getPeakSunElevation(15)).toBe(90);
    expect(getPeakSunElevation(23.44)).toBe(90);
    expect(getPeakSunElevation(30)).toBeLessThan(90);
  });
});

describe('weather coords storage', () => {
  // Minimal localStorage stand-in (node test env has none) — the util only
  // needs get/set/remove.
  beforeEach(() => {
    const map = new Map();
    globalThis.localStorage = {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => map.set(k, String(v)),
      removeItem: (k) => map.delete(k),
    };
  });

  it('round-trips coordinates and clears on null', () => {
    expect(getStoredWeatherCoords()).toBeNull();
    storeWeatherCoords({ lat: 41.85, lon: -87.65 });
    expect(getStoredWeatherCoords()).toEqual({ lat: 41.85, lon: -87.65 });
    storeWeatherCoords(null);
    expect(getStoredWeatherCoords()).toBeNull();
  });

  it('rejects malformed stored values', () => {
    localStorage.setItem('day-planner-weather-coords', 'not json');
    expect(getStoredWeatherCoords()).toBeNull();
    localStorage.setItem('day-planner-weather-coords', JSON.stringify({ lat: 'x', lon: 2 }));
    expect(getStoredWeatherCoords()).toBeNull();
  });
});
