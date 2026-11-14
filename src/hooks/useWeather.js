import { useState, useEffect, useCallback, useRef } from 'react';

import { isTrayMode } from '../utils/trayMode.js';
import { isNativeApp } from '../native.js';
import { storeWeatherCoords } from '../utils/solar.js';
import { formatLocalizedDate } from '../utils/localeFormatting.js';
import { writeItem } from '../utils/storageWrites.js';
import { readWeatherZip, readWeatherTempUnit } from '../utils/storedSlices.js';
import { forecastUrl, hourlyByDateFrom } from '../utils/weatherForecast.js';
import {
  readWeatherCache, writeWeatherCache, clearWeatherCache, readGeocode, writeGeocode,
} from '../utils/weatherCache.js';
import { startWeatherRefresh } from '../utils/weatherRefresh.js';

const getWeatherCondition = (code) => {
  if (code === 0) return 'Clear';
  if ([1, 2, 3].includes(code)) return 'Partly Cloudy';
  if ([45, 48].includes(code)) return 'Foggy';
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return 'Rainy';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snowy';
  if ([95, 96, 99].includes(code)) return 'Stormy';
  return 'Cloudy';
};

const getWeatherIcon = (code) => {
  // WMO Weather interpretation codes
  if (code === 0) return '☀️'; // Clear sky
  if (code === 1) return '🌤️'; // Mainly clear
  if (code === 2) return '⛅'; // Partly cloudy
  if (code === 3) return '☁️'; // Overcast
  if ([45, 48].includes(code)) return '🌁'; // Fog
  if ([51, 53, 55].includes(code)) return '🌦️'; // Drizzle
  if ([56, 57].includes(code)) return '🌧️'; // Freezing drizzle
  if ([61, 63, 65].includes(code)) return '🌧️'; // Rain
  if ([66, 67].includes(code)) return '🌧️'; // Freezing rain
  if ([71, 73, 75].includes(code)) return '🌨️'; // Snow fall
  if (code === 77) return '🌨️'; // Snow grains
  if ([80, 81, 82].includes(code)) return '🌧️'; // Rain showers
  if ([85, 86].includes(code)) return '🌨️'; // Snow showers
  if (code === 95) return '⛈️'; // Thunderstorm
  if ([96, 99].includes(code)) return '⛈️'; // Thunderstorm with hail

  console.warn('Unknown weather code:', code);
  return '☁️'; // Default fallback
};

// A request that hangs must not leave the header empty for as long as the
// socket takes to give up: every request here is bounded.
const REQUEST_TIMEOUT_MS = 15000;

const fetchJson = async (url) => {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    let data = null;
    try { data = await response.json(); } catch { /* not JSON: the caller sees no data */ }
    return { ok: !!response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
};

// "Show weather in header" governs the FORECAST, not the location. The Day
// Dial's sunrise, sunset and moon, and the home-screen widget's sky ring, come
// from the geocoded coords (utils/solar.js), and a phone has no header to show
// weather in at all. So the geocode runs whenever a location is set; only the
// forecast call is skipped when the header weather is off.
//
// On the native apps the forecast is fetched whenever a location is set,
// whatever that switch says: a phone's settings do not show the switch (only
// the location), so a stored "off" from an earlier version could never be
// turned back on there, and the dial's weather ring, the widget and the
// GLANCElauncher all read this forecast. The switch still decides the header
// on desktop and tablet.
const forecastWanted = () => {
  if (isNativeApp()) return true;
  const enabled = localStorage.getItem('day-planner-weather-enabled');
  try {
    return enabled === null || !!JSON.parse(enabled);
  } catch {
    return true;
  }
};

const LOCATION_NOT_FOUND = { temp: '--', condition: 'Location not found', icon: '📍', high: '--', low: '--', forecast: [] };
const UNABLE_TO_LOAD = { temp: '--', condition: 'Unable to load', icon: '🌡️', high: '--', low: '--', forecast: [] };

/**
 * Where `query` is: { lat, lon, tz, durable }, or null when the geocoder
 * answered that it knows no such place. Throws when no geocoder could be
 * asked, which is a failed request and not an unknown location: the two used
 * to share "Location not found", so a machine that was briefly offline told
 * the user their ZIP did not exist.
 *
 * `durable` is false for a US ZIP resolved by the fallback while the ZIP
 * service could not be reached: a name search for five digits can land
 * anywhere, so that answer is used once and not remembered.
 */
const geocode = async (query) => {
  const isUsZip = /^\d{5}(-\d{4})?$/.test(query);
  let zipServiceAnswered = false;

  // Try US ZIP code via zippopotam.us (free, no key needed)
  if (isUsZip) {
    try {
      const { ok, status, data } = await fetchJson(`https://api.zippopotam.us/us/${query.slice(0, 5)}`);
      zipServiceAnswered = ok || status === 404;
      if (ok && data?.places?.length > 0) {
        const lat = parseFloat(data.places[0].latitude);
        const lon = parseFloat(data.places[0].longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, tz: undefined, durable: true };
      }
    } catch { /* fall through to city name search */ }
  }

  // Fall back to Open-Meteo geocoding for city/place names
  const { ok, status, data } = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`);
  if (!ok || !data) throw new Error(`geocoding answered ${status}`);
  const place = data.results?.[0];
  if (!place) {
    // The fallback rarely knows a US ZIP by name, so its "no results" only
    // means the ZIP is unknown when the ZIP service said so too.
    if (isUsZip && !zipServiceAnswered) throw new Error('the ZIP lookup could not be reached');
    return null;
  }
  return { lat: place.latitude, lon: place.longitude, tz: place.timezone, durable: !isUsZip || zipServiceAnswered };
};

const useWeather = () => {
  const [weatherZip, setWeatherZip] = useState(readWeatherZip);
  const [weatherTempUnit, setWeatherTempUnit] = useState(readWeatherTempUnit);
  // Starts from the last good forecast when it is still fresh, so a reload
  // shows the weather at once and a failed first request has something to keep.
  const [weather, setWeather] = useState(() => (
    isTrayMode || !forecastWanted()
      ? null
      : readWeatherCache({ query: readWeatherZip().trim(), tempUnit: readWeatherTempUnit() })
  ));
  // Only the latest call writes state: the settings panel can start one while
  // the hourly one is still out, and the older answer must not land last.
  const callSeq = useRef(0);

  // Persist weather settings to localStorage
  useEffect(() => {
    writeItem('day-planner-weather-zip', weatherZip);
  }, [weatherZip]);

  useEffect(() => {
    writeItem('day-planner-weather-temp-unit', weatherTempUnit);
  }, [weatherTempUnit]);

  // Resolves to 'ok', 'idle' (nothing to fetch, or the place is unknown),
  // 'failed' (a request did not get through; utils/weatherRefresh.js retries
  // sooner) or 'superseded' (a later call took over).
  const fetchWeather = useCallback(async () => {
    const seq = ++callSeq.current;
    const superseded = () => seq !== callSeq.current;

    // Read settings from localStorage to avoid stale closures.
    const showWeather = forecastWanted();
    const query = (localStorage.getItem('day-planner-weather-zip') || '').trim();
    const tempUnit = localStorage.getItem('day-planner-weather-temp-unit') || 'fahrenheit';

    if (!query) {
      setWeather(null);
      storeWeatherCoords(null); // location cleared → the dial's sun marks go too
      clearWeatherCache();
      return 'idle';
    }

    try {
      // A place does not move: once a query has resolved, a refresh is the
      // forecast request alone, and no geocoder's bad minute can blank it.
      let place = readGeocode(query);
      if (!place) {
        place = await geocode(query);
        if (superseded()) return 'superseded';
        if (!place) {
          setWeather(LOCATION_NOT_FOUND);
          return 'idle';
        }
        if (place.durable) writeGeocode(query, place);
      }
      const { lat: latitude, lon: longitude } = place;

      // Persist the resolved coordinates: the Day Dial computes sunrise/
      // sunset locally from them (utils/solar.js), for any date and offline —
      // the forecast API's few-day window can't serve a pageable dial.
      storeWeatherCoords({ lat: latitude, lon: longitude });

      if (!showWeather) {
        // Location resolved and kept; no forecast wanted.
        setWeather(null);
        return 'idle';
      }

      const tz = place.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;

      const { ok, status, data } = await fetchJson(forecastUrl({ lat: latitude, lon: longitude, tempUnit, timezone: tz }));
      if (superseded()) return 'superseded';
      // An error answer (a rate limit, a rejected parameter) is JSON with a
      // `reason` and no forecast. It used to be dropped without a word, which
      // after a reload left the header with no weather and nothing logged.
      if (!ok || !data?.current || !data?.daily) {
        throw new Error(`forecast answered ${status}: ${data?.reason ?? 'no forecast in the response'}`);
      }

      // The dial's weather ring reads this (utils/weatherForecast.js).
      const hourlyByDate = hourlyByDateFrom(data);

      // Build forecast array for next 5 days (starting from tomorrow)
      const forecast = [];
      for (let i = 1; i <= 5; i++) {
        // Append T12:00:00 to avoid timezone issues (date-only strings are parsed as UTC midnight)
        const date = new Date(data.daily.time[i] + 'T12:00:00');
        forecast.push({
          day: formatLocalizedDate(date, { weekday: 'short' }),
          high: Math.round(data.daily.temperature_2m_max[i]),
          low: Math.round(data.daily.temperature_2m_min[i]),
          icon: getWeatherIcon(data.daily.weather_code[i]),
          code: data.daily.weather_code[i] // For debugging
        });
      }

      const next = {
        temp: Math.round(data.current.temperature_2m),
        condition: getWeatherCondition(data.current.weather_code),
        icon: getWeatherIcon(data.current.weather_code),
        high: Math.round(data.daily.temperature_2m_max[0]),
        low: Math.round(data.daily.temperature_2m_min[0]),
        forecast: forecast,
        hourlyByDate,
        // What utils/weatherCache.js checks before this stands in for a
        // refresh that failed.
        fetchedAt: Date.now(),
        query,
        tempUnit,
      };
      setWeather(next);
      writeWeatherCache(next);
      return 'ok';
    } catch (error) {
      if (superseded()) return 'superseded';
      console.error('Failed to fetch weather:', error);
      if (!showWeather) {
        setWeather(null);
        return 'failed';
      }
      // A failed refresh keeps the forecast it could not replace while that
      // is still fresh. Only with nothing fresh does the header say so.
      const kept = readWeatherCache({ query, tempUnit });
      setWeather((prev) => {
        if (!kept) return UNABLE_TO_LOAD;
        return prev?.fetchedAt === kept.fetchedAt ? prev : kept;
      });
      return 'failed';
    }
  }, []);

  // Fetch on mount, hourly, sooner after a failure, and on coming back to the app
  useEffect(() => {
    if (isTrayMode) return;
    return startWeatherRefresh({ fetchWeather });
  }, [fetchWeather]);

  return { weather, setWeather, weatherZip, setWeatherZip, weatherTempUnit, setWeatherTempUnit, fetchWeather };
};

export default useWeather;
