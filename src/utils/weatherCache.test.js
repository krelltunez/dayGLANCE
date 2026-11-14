import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  isWeatherFresh, readWeatherCache, writeWeatherCache, clearWeatherCache, readGeocode, writeGeocode,
  WEATHER_CACHE_KEY, WEATHER_GEOCODE_KEY, WEATHER_MAX_AGE_MS,
} from './weatherCache.js';

const at = (h, m = 0, day = 21) => new Date(2026, 8, day, h, m, 0).getTime();
const forecast = (over = {}) => ({ temp: 61, high: 70, low: 50, forecast: [], fetchedAt: at(9), query: '80202', tempUnit: 'fahrenheit', ...over });
const want = { query: '80202', tempUnit: 'fahrenheit' };

describe('isWeatherFresh', () => {
  it('a forecast for this location and unit is fresh for three hours', () => {
    expect(isWeatherFresh(forecast(), { ...want, now: at(9) })).toBe(true);
    expect(isWeatherFresh(forecast(), { ...want, now: at(9) + WEATHER_MAX_AGE_MS })).toBe(true);
    expect(isWeatherFresh(forecast(), { ...want, now: at(9) + WEATHER_MAX_AGE_MS + 1 })).toBe(false);
  });

  it('never across midnight: its "today" and "tomorrow" have moved', () => {
    expect(isWeatherFresh(forecast({ fetchedAt: at(23, 30) }), { ...want, now: at(0, 30, 22) })).toBe(false);
  });

  it('not for another location or unit', () => {
    expect(isWeatherFresh(forecast(), { query: '10001', tempUnit: 'fahrenheit', now: at(9) })).toBe(false);
    expect(isWeatherFresh(forecast(), { query: '80202', tempUnit: 'celsius', now: at(9) })).toBe(false);
  });

  it('not the "--" placeholders, nothing, or a forecast from the future', () => {
    expect(isWeatherFresh({ temp: '--', forecast: [] }, { ...want, now: at(9) })).toBe(false);
    expect(isWeatherFresh(null, { ...want, now: at(9) })).toBe(false);
    expect(isWeatherFresh(forecast({ fetchedAt: at(10) }), { ...want, now: at(9) })).toBe(false);
  });
});

describe('the stored forecast and location', () => {
  let store;

  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });

  afterEach(() => { delete globalThis.localStorage; });

  it('round-trips a forecast, and reads nothing once it is stale or cleared', () => {
    writeWeatherCache(forecast());
    expect(readWeatherCache({ ...want, now: at(10) })).toEqual(forecast());
    expect(readWeatherCache({ ...want, now: at(13) })).toBeNull();
    clearWeatherCache();
    expect(readWeatherCache({ ...want, now: at(10) })).toBeNull();
  });

  it('unreadable storage reads as nothing', () => {
    store.set(WEATHER_CACHE_KEY, 'not json');
    store.set(WEATHER_GEOCODE_KEY, '{');
    expect(readWeatherCache({ ...want, now: at(9) })).toBeNull();
    expect(readGeocode('80202')).toBeNull();
  });

  it('a location is read back only for the query it resolved', () => {
    writeGeocode('Berlin', { lat: 52.52, lon: 13.41, tz: 'Europe/Berlin' });
    expect(readGeocode('Berlin')).toEqual({ lat: 52.52, lon: 13.41, tz: 'Europe/Berlin' });
    expect(readGeocode('Bern')).toBeNull();
  });

  it('a stored location without usable coordinates reads as nothing', () => {
    store.set(WEATHER_GEOCODE_KEY, JSON.stringify({ query: '80202', lat: 'x', lon: 2 }));
    expect(readGeocode('80202')).toBeNull();
  });

  it('a write that storage refuses does not throw', () => {
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    expect(() => writeWeatherCache(forecast())).not.toThrow();
    expect(() => writeGeocode('80202', { lat: 1, lon: 2 })).not.toThrow();
  });
});
