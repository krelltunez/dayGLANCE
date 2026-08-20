// Local sunrise/sunset computation for the Day Dial's solar hairlines.
//
// Computed, not fetched: the weather API's daily feed only covers the next
// few days, while the dial pages to any date — and an ambient wall display
// should not lose its sun marks when offline. This is the classic
// "Almanac for Computers" sunrise equation (the one NOAA's calculators are
// built on), accurate to a minute or two — more than enough for a hairline.
//
// Coordinates come from the weather feature: useWeather persists the
// geocoded lat/lon whenever a forecast is fetched, and the dial reads them
// back here. No weather location configured → no coordinates → the layer
// honestly doesn't render (same pattern as sleep without a day window).

const COORDS_STORAGE_KEY = 'day-planner-weather-coords';

// Solar zenith for rise/set: 90° + refraction (34') + solar semi-diameter (16').
const ZENITH_DEG = 90.833;

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mod = (n, m) => ((n % m) + m) % m;

const dayOfYear = (year, month, day) => {
  const n1 = Math.floor((275 * month) / 9);
  const n2 = Math.floor((month + 9) / 12);
  const n3 = 1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3);
  return n1 - n2 * n3 + day - 30;
};

// UT hours of the event, or null when the sun never crosses the zenith that
// day at this latitude (polar day/night).
function eventUT(year, month, day, lat, lon, isSunrise) {
  const N = dayOfYear(year, month, day);
  const lngHour = lon / 15;
  const t = N + (((isSunrise ? 6 : 18) - lngHour) / 24);

  // Sun's mean anomaly → true longitude → right ascension (same quadrant).
  const M = 0.9856 * t - 3.289;
  const L = mod(M + 1.916 * Math.sin(rad(M)) + 0.02 * Math.sin(rad(2 * M)) + 282.634, 360);
  let RA = mod(deg(Math.atan(0.91764 * Math.tan(rad(L)))), 360);
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;

  const sinDec = 0.39782 * Math.sin(rad(L));
  const cosDec = Math.cos(Math.asin(sinDec));

  const cosH =
    (Math.cos(rad(ZENITH_DEG)) - sinDec * Math.sin(rad(lat))) / (cosDec * Math.cos(rad(lat)));
  if (cosH > 1 || cosH < -1) return null; // never rises / never sets

  let H = isSunrise ? 360 - deg(Math.acos(cosH)) : deg(Math.acos(cosH));
  H /= 15;

  const T = H + RA - 0.06571 * t - 6.622;
  return mod(T - lngHour, 24);
}

/**
 * Sunrise/sunset for one local calendar date, as minutes-of-day in the
 * device's timezone — the dial's native coordinate.
 *
 * @param date Date whose local year/month/day identify the day.
 * @param lat  Latitude in degrees (+N).
 * @param lon  Longitude in degrees (+E).
 * @returns {{sunriseMin: number|null, sunsetMin: number|null}} null fields
 *          during polar day/night, when there is no event to mark.
 */
export function getSunTimes(date, lat, lon) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  const toLocalMin = (ut) => {
    if (ut === null) return null;
    const local = new Date(Date.UTC(y, m - 1, d) + ut * 3_600_000);
    return local.getHours() * 60 + local.getMinutes();
  };

  return {
    sunriseMin: toLocalMin(eventUT(y, m, d, lat, lon, true)),
    sunsetMin: toLocalMin(eventUT(y, m, d, lat, lon, false)),
  };
}

/** Coordinates persisted by useWeather's geocode, or null when never resolved. */
export function getStoredWeatherCoords() {
  try {
    const raw = localStorage.getItem(COORDS_STORAGE_KEY);
    if (!raw) return null;
    const { lat, lon } = JSON.parse(raw);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

/** Persist (or clear, with null) the weather geocode's resolved coordinates. */
export function storeWeatherCoords(coords) {
  try {
    if (coords && Number.isFinite(coords.lat) && Number.isFinite(coords.lon)) {
      localStorage.setItem(COORDS_STORAGE_KEY, JSON.stringify({ lat: coords.lat, lon: coords.lon }));
    } else {
      localStorage.removeItem(COORDS_STORAGE_KEY);
    }
  } catch { /* storage unavailable — the dial just skips the layer */ }
}
