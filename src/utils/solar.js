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

// Earth's axial tilt — the swing of the sun's declination across the year,
// and so the difference between a site's best and worst noon.
const AXIAL_TILT_DEG = 23.44;

// The sunrise equation has no solution on two opposite kinds of day, and
// they mean opposite things: name them rather than collapsing both to null.
export const POLAR_DAY = 'day';     // the sun never sets
export const POLAR_NIGHT = 'night'; // the sun never rises

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const mod = (n, m) => ((n % m) + m) % m;

const dayOfYear = (year, month, day) => {
  const n1 = Math.floor((275 * month) / 9);
  const n2 = Math.floor((month + 9) / 12);
  const n3 = 1 + Math.floor((year - 4 * Math.floor(year / 4) + 2) / 3);
  return n1 - n2 * n3 + day - 30;
};

// UT hours of the event, or POLAR_DAY / POLAR_NIGHT when the sun never
// crosses the zenith that day at this latitude.
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
  // Out of range means no crossing — but which one matters. Above the
  // range the sun stays below the horizon all day; below it, above.
  if (cosH > 1) return POLAR_NIGHT;
  if (cosH < -1) return POLAR_DAY;

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
 * @returns {{sunriseMin: number|null, sunsetMin: number|null,
 *            polar: 'day'|'night'|null}} The minute fields are null when
 *          there is no event to mark; `polar` then says which kind of day
 *          it is, so a caller drawing a span (rather than two marks) can
 *          tell "lit all day" from "dark all day".
 */
export function getSunTimes(date, lat, lon) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();

  const toLocalMin = (ut) => {
    if (typeof ut !== 'number') return null;
    const local = new Date(Date.UTC(y, m - 1, d) + ut * 3_600_000);
    return local.getHours() * 60 + local.getMinutes();
  };

  const rise = eventUT(y, m, d, lat, lon, true);
  return {
    sunriseMin: toLocalMin(rise),
    sunsetMin: toLocalMin(eventUT(y, m, d, lat, lon, false)),
    polar: typeof rise === 'string' ? rise : null,
  };
}

/**
 * The sun's angle above the horizon at one minute of one local day.
 *
 * Same ingredients as the rise/set equation — declination, the equation of
 * time, the hour angle — evaluated at an arbitrary time instead of solved
 * for a crossing. Negative below the horizon.
 *
 * This is the sun's angle in the sky, which is a different quantity from the
 * observer's height above sea level: altitude does not enter it. What
 * altitude changes is how much atmosphere the light crosses on the way down,
 * which is why the dial takes that from the UV feed instead.
 *
 * @param date     Date whose local year/month/day identify the day (and whose
 *                 UTC offset, DST included, places the local clock).
 * @param lat      Latitude in degrees (+N).
 * @param lon      Longitude in degrees (+E).
 * @param minOfDay Minutes past local midnight.
 * @returns Elevation in degrees, in [-90, 90].
 */
export function getSunElevation(date, lat, lon, minOfDay) {
  const N = dayOfYear(date.getFullYear(), date.getMonth() + 1, date.getDate());

  // Declination: the sun's own latitude today, swinging ±23.44° about the
  // equator and crossing it at the equinoxes (N ≈ 80 and 264).
  const dec = -AXIAL_TILT_DEG * Math.cos(rad((360 / 365) * (N + 10)));

  // The equation of time — the sundial's disagreement with the clock, from
  // Earth's elliptical orbit and its tilt. Worth carrying: it reaches ±15
  // minutes, which is visible on a dial whose smallest tick is 15.
  const B = rad((360 / 365) * (N - 81));
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  // Local clock → local solar time. getTimezoneOffset is minutes BEHIND UTC
  // and is read off this date, so a DST day gets that day's offset.
  const standardMeridian = 15 * (-date.getTimezoneOffset() / 60);
  const solarMin = minOfDay + 4 * (lon - standardMeridian) + eot;

  // Hour angle: 15° per hour away from local solar noon.
  const H = 15 * (solarMin / 60 - 12);

  const sinAlt = Math.sin(rad(dec)) * Math.sin(rad(lat))
    + Math.cos(rad(dec)) * Math.cos(rad(lat)) * Math.cos(rad(H));
  return deg(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
}

/**
 * The highest the sun ever gets at this latitude, on its best day of the
 * year — the reference a single day is judged against, so that a December
 * noon reads as a December noon rather than being renormalised into looking
 * like June. Inside the tropics the sun does pass overhead, hence the cap.
 *
 * @param lat Latitude in degrees.
 * @returns Elevation in degrees, in (0, 90].
 */
export function getPeakSunElevation(lat) {
  return Math.min(90, 90 - Math.abs(lat) + AXIAL_TILT_DEG);
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
