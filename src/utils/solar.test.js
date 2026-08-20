import { describe, it, expect, beforeEach } from 'vitest';
import { getSunTimes, getStoredWeatherCoords, storeWeatherCoords } from './solar.js';

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

  it('returns nulls through polar day and polar night', () => {
    // Tromsø, 69.65°N: midnight sun in June, polar night in December.
    expect(getSunTimes(new Date(2026, 5, 21), 69.65, 18.95))
      .toEqual({ sunriseMin: null, sunsetMin: null });
    expect(getSunTimes(new Date(2026, 11, 21), 69.65, 18.95))
      .toEqual({ sunriseMin: null, sunsetMin: null });
  });

  it('makes northern summer days longer than winter days', () => {
    const june = getSunTimes(new Date(2026, 5, 21), 41.85, 0);
    const dec = getSunTimes(new Date(2026, 11, 21), 41.85, 0);
    const len = ({ sunriseMin, sunsetMin }) => sunsetMin - sunriseMin;
    expect(len(june)).toBeGreaterThan(len(dec) + 4 * 60);
    expect(june.sunriseMin).toBeLessThan(dec.sunriseMin);
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
