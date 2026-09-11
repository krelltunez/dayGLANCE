// Local moon position, phase and rise/set for the Day Dial's night sky.
//
// The companion to solar.js, and computed for the same reason: the dial pages
// to any date, and an ambient wall display should keep its sky when offline.
// Coordinates come from the same place — useWeather's persisted geocode.
//
// This is the truncated lunar series from Meeus' Astronomical Algorithms
// (ch. 47), carrying the largest handful of periodic terms. It is good to a
// few hundredths of a degree, which puts moonrise within a couple of minutes
// and the illuminated fraction within a percent. That is far below what a
// twenty-unit band on a 1000-unit dial can show, and vastly cheaper than an
// ephemeris.
//
// Two things this deliberately does NOT model: the moon's own libration (it
// changes the disc's appearance, not its light), and topocentric parallax in
// the phase calculation (worth under a percent of illuminated fraction).
// Parallax IS applied to altitude, where it moves the horizon crossing by
// nearly a degree and so shifts moonrise by minutes.

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Obliquity of the ecliptic, and the epoch everything is measured from.
const OBLIQUITY_DEG = 23.4397;
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const EARTH_RADIUS_KM = 6371;
const SUN_DISTANCE_KM = 149_598_000;

/**
 * The altitude at which the moon counts as risen: its centre a touch below
 * the true horizon, because refraction lifts the image. Parallax is already
 * removed by the time this threshold is applied, so unlike the solar zenith
 * constant this one does not fold in the moon's semi-diameter — rise is
 * reckoned from the centre, the convention almanacs use for the moon.
 */
const MOON_HORIZON_DEG = 0.125;

// The moon may not cross the horizon at all on a given local day, and the two
// ways that happens mean opposite things. Named rather than collapsed to
// null, the same lesson solar.js learned about polar day and polar night.
export const MOON_UP = 'up';     // above the horizon for the whole day
export const MOON_DOWN = 'down'; // below it for the whole day

const daysSinceJ2000 = (date) => (date.getTime() - J2000_MS) / 86_400_000;

/** Ecliptic longitude/latitude → right ascension/declination, in degrees. */
function toEquatorial(lonDeg, latDeg) {
  const e = rad(OBLIQUITY_DEG);
  const l = rad(lonDeg);
  const b = rad(latDeg);
  return {
    ra: deg(Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l))),
    dec: deg(Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l))),
  };
}

/** Greenwich mean sidereal time in degrees, plus the observer's longitude. */
const localSiderealDeg = (d, lon) => 280.16 + 360.985_623_5 * d + lon;

/**
 * The sun's equatorial position and distance. Needed here rather than taken
 * from solar.js because the phase calculation wants the sun and the moon in
 * the same frame, and solar.js works in local clock minutes instead.
 */
function sunPosition(d) {
  const M = rad(357.5291 + 0.985_600_28 * d);
  const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
  const lon = deg(M) + C + 102.9372 + 180;
  return { ...toEquatorial(lon, 0), dist: SUN_DISTANCE_KM };
}

/**
 * The moon's geocentric equatorial position and distance at an instant.
 *
 * @param date Any Date; only the absolute instant matters.
 * @returns {{ra: number, dec: number, dist: number}} degrees and km.
 */
export function getMoonPosition(date) {
  const d = daysSinceJ2000(date);

  const L = rad(218.316 + 13.176_396 * d);  // mean longitude
  const M = rad(134.963 + 13.064_993 * d);  // mean anomaly
  const F = rad(93.272 + 13.229_350 * d);   // argument of latitude
  const D = rad(297.850 + 12.190_749 * d);  // mean elongation from the sun
  const Ms = rad(357.529 + 0.985_600_28 * d); // the SUN's mean anomaly

  // Longitude: the equation of the centre, then evection, variation and the
  // annual equation — the terms big enough to matter at this scale.
  const lon = deg(L)
    + 6.289 * Math.sin(M)
    + 1.274 * Math.sin(2 * D - M)
    + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * M)
    - 0.186 * Math.sin(Ms)
    - 0.114 * Math.sin(2 * F);

  const lat = 5.128 * Math.sin(F)
    + 0.281 * Math.sin(M + F)
    - 0.278 * Math.sin(F - M);

  const dist = 385_001
    - 20_905 * Math.cos(M)
    - 3699 * Math.cos(2 * D - M)
    - 2956 * Math.cos(2 * D);

  return { ...toEquatorial(lon, lat), dist };
}

/**
 * How much of the moon's disc is lit, and which way it is heading.
 *
 * @param date Any Date; only the absolute instant matters.
 * @returns {{fraction: number, phase: number, waxing: boolean}}
 *          `fraction` is the lit portion of the disc, 0 (new) to 1 (full).
 *          `phase` runs 0 → 1 through the whole cycle: 0 new, 0.25 first
 *          quarter, 0.5 full, 0.75 last quarter. `waxing` is phase < 0.5.
 */
export function getMoonIllumination(date) {
  const d = daysSinceJ2000(date);
  const s = sunPosition(d);
  const m = getMoonPosition(date);

  // Elongation: the sun–earth–moon angle, from the two equatorial positions.
  const phi = Math.acos(Math.max(-1, Math.min(1,
    Math.sin(rad(s.dec)) * Math.sin(rad(m.dec))
    + Math.cos(rad(s.dec)) * Math.cos(rad(m.dec)) * Math.cos(rad(s.ra - m.ra)))));

  // Phase angle at the moon: the earth is not a point at this distance, so
  // this is not simply pi - phi.
  const inc = Math.atan2(s.dist * Math.sin(phi), m.dist - s.dist * Math.cos(phi));

  // Position angle of the bright limb — its sign is what distinguishes a
  // waxing crescent from a waning one, which the elongation alone cannot.
  const angle = Math.atan2(
    Math.cos(rad(s.dec)) * Math.sin(rad(s.ra - m.ra)),
    Math.sin(rad(s.dec)) * Math.cos(rad(m.dec))
    - Math.cos(rad(s.dec)) * Math.sin(rad(m.dec)) * Math.cos(rad(s.ra - m.ra)));

  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI;
  return { fraction: (1 + Math.cos(inc)) / 2, phase, waxing: phase < 0.5 };
}

/**
 * The moon's altitude above the horizon, corrected for parallax.
 *
 * Geocentric altitude is not what an observer sees: the moon is close enough
 * that standing on the surface rather than at the centre lowers it by nearly
 * a degree near the horizon, which is worth minutes of moonrise.
 *
 * @param date Any Date; only the absolute instant matters.
 * @param lat  Latitude in degrees (+N).
 * @param lon  Longitude in degrees (+E).
 * @returns Altitude in degrees, negative below the horizon.
 */
export function getMoonAltitude(date, lat, lon) {
  const m = getMoonPosition(date);
  const H = rad(localSiderealDeg(daysSinceJ2000(date), lon) - m.ra);
  const phi = rad(lat);
  const dec = rad(m.dec);

  const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
  return deg(alt - Math.asin((EARTH_RADIUS_KM / m.dist) * Math.cos(alt)));
}

/** Local-midnight Date for the calendar day `date` falls on. */
const startOfLocalDay = (date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

/** Altitude at `min` minutes past local midnight on `date`'s calendar day. */
const altitudeAtMinute = (date, lat, lon, min) =>
  getMoonAltitude(new Date(startOfLocalDay(date).getTime() + min * 60_000), lat, lon);

const SCAN_STEP_MIN = 20;
const DAY_MINUTES = 1440;

/**
 * Moonrise and moonset for one local calendar date, as minutes-of-day.
 *
 * Unlike the sun, the moon routinely does only one of the two within a single
 * day — it rises at 23:40 and sets tomorrow — so each field is independently
 * null. `always` covers the other case, where it never crosses at all.
 *
 * @param date Date whose local year/month/day identify the day.
 * @param lat  Latitude in degrees (+N).
 * @param lon  Longitude in degrees (+E).
 * @returns {{moonriseMin: number|null, moonsetMin: number|null,
 *            always: 'up'|'down'|null}}
 */
export function getMoonTimes(date, lat, lon) {
  const at = (min) => altitudeAtMinute(date, lat, lon, min) - MOON_HORIZON_DEG;

  let moonriseMin = null;
  let moonsetMin = null;
  let prev = at(0);
  const startedUp = prev > 0;

  for (let m = SCAN_STEP_MIN; m <= DAY_MINUTES; m += SCAN_STEP_MIN) {
    const cur = at(m);
    if ((prev > 0) !== (cur > 0)) {
      // Bisect the bracketing interval down to the minute the dial draws in.
      let lo = m - SCAN_STEP_MIN;
      let hi = m;
      let loVal = prev;
      while (hi - lo > 1) {
        const mid = (lo + hi) / 2;
        const midVal = at(mid);
        if ((loVal > 0) === (midVal > 0)) { lo = mid; loVal = midVal; } else { hi = mid; }
      }
      const crossing = Math.round(hi);
      if (cur > 0) moonriseMin ??= crossing; else moonsetMin ??= crossing;
    }
    prev = cur;
  }

  const always = moonriseMin == null && moonsetMin == null
    ? (startedUp ? MOON_UP : MOON_DOWN)
    : null;
  return { moonriseMin, moonsetMin, always };
}
