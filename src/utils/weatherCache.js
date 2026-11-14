// What the weather hook (hooks/useWeather.js) keeps across reloads and failed
// refreshes: the last good forecast and the last resolved location.
//
// Before this, the forecast lived only in React state. A reload started from
// nothing, and a refresh that failed (the machine waking before its network,
// a geocoder having a bad minute) replaced a good forecast with "--" until the
// next hourly attempt. Both are caches: losing either costs one request.

export const WEATHER_CACHE_KEY = 'day-planner-weather-cache';
export const WEATHER_GEOCODE_KEY = 'day-planner-weather-geocode';

// How long a forecast may stand in for a refresh that failed. The header shows
// a "current" temperature, so this is short: two missed hourly refreshes.
export const WEATHER_MAX_AGE_MS = 3 * 60 * 60 * 1000;

const sameLocalDate = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

/**
 * Is `weather` a real forecast for this location and unit that can still be
 * shown? Today's high and low and the "next five days" are relative to the
 * day it was fetched on, so a forecast from another local date is never fresh.
 */
export function isWeatherFresh(weather, { query, tempUnit, now = Date.now() }) {
  if (!weather || !Number.isFinite(weather.fetchedAt)) return false;
  if (weather.query !== query || weather.tempUnit !== tempUnit) return false;
  const age = now - weather.fetchedAt;
  return age >= 0 && age <= WEATHER_MAX_AGE_MS && sameLocalDate(weather.fetchedAt, now);
}

/** The stored forecast when it is still fresh for this location and unit, else null. */
export function readWeatherCache({ query, tempUnit, now = Date.now() }) {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return null;
    const weather = JSON.parse(raw);
    return isWeatherFresh(weather, { query, tempUnit, now }) ? weather : null;
  } catch {
    return null;
  }
}

/** Keep a forecast the hook just built (it carries fetchedAt, query and tempUnit). */
export function writeWeatherCache(weather) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(weather));
  } catch { /* storage unavailable or full: the next reload just starts without one */ }
}

export function clearWeatherCache() {
  try {
    localStorage.removeItem(WEATHER_CACHE_KEY);
  } catch { /* nothing to clear */ }
}

/** The location last resolved for exactly this query, or null. */
export function readGeocode(query) {
  try {
    const raw = localStorage.getItem(WEATHER_GEOCODE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw);
    if (stored?.query !== query || !Number.isFinite(stored.lat) || !Number.isFinite(stored.lon)) return null;
    return { lat: stored.lat, lon: stored.lon, tz: typeof stored.tz === 'string' ? stored.tz : undefined };
  } catch {
    return null;
  }
}

/** Remember where `query` resolved to, so a refresh needs one request, not two or three. */
export function writeGeocode(query, { lat, lon, tz }) {
  try {
    localStorage.setItem(WEATHER_GEOCODE_KEY, JSON.stringify({ query, lat, lon, tz }));
  } catch { /* storage unavailable: the next refresh geocodes again */ }
}
