// A time typed into the clock picker (#2249): the picker's face offers
// 5-minute steps, so any other minute ("4:53 PM") is typed or dragged to.
// Pure, so the forms it takes are tested without the picker.

/**
 * A typed time as "HH:MM" (24-hour), or null when it is not one.
 *
 * Takes "16:53", "4:53 pm", "4:53p", "4.53 PM", "4h53", "453p", "1653", "4 pm",
 * and the language's own day periods when given (`dayPeriods`, e.g.
 * { am: '上午', pm: '下午' }). Without a day period, an hour from 13 is read
 * as 24-hour, and an hour up to 12 takes `defaultPm` (the picker's current
 * AM/PM) on a 12-hour clock, or is read as written on a 24-hour one.
 *
 * @param {string} text
 * @param {{ use24HourClock?: boolean, defaultPm?: boolean, dayPeriods?: { am?: string, pm?: string } }} [options]
 */
export function parseTimeInput(text, { use24HourClock = false, defaultPm = false, dayPeriods = {} } = {}) {
  let s = String(text ?? '').trim().toLowerCase();
  if (!s) return null;

  // The day period, at either end: English a/am/a.m./p/pm/p.m., or the language's.
  let period = null;
  const own = [['am', dayPeriods.am], ['pm', dayPeriods.pm]].filter(([, word]) => word);
  for (const [which, word] of own) {
    const w = word.toLowerCase();
    if (s.startsWith(w)) { period = which; s = s.slice(w.length).trim(); break; }
    if (s.endsWith(w)) { period = which; s = s.slice(0, -w.length).trim(); break; }
  }
  if (!period) {
    const m = /^(.*?)\s*([ap])\.?(?:m\.?)?$/.exec(s);
    if (m && /\d$/.test(m[1])) { period = m[2] === 'a' ? 'am' : 'pm'; s = m[1]; }
  }

  let hour;
  let minute;
  let m;
  if ((m = /^(\d{1,2})\s*[:.h]\s*(\d{2})$/.exec(s))) { hour = +m[1]; minute = +m[2]; }
  else if ((m = /^(\d{1,2})(\d{2})$/.exec(s))) { hour = +m[1]; minute = +m[2]; }
  else if ((m = /^(\d{1,2})$/.exec(s))) { hour = +m[1]; minute = 0; }
  else return null;
  if (minute > 59) return null;

  if (period) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (period === 'pm' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  } else if (!use24HourClock && hour >= 1 && hour <= 12) {
    hour = (hour % 12) + (defaultPm ? 12 : 0);
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** The minute (0-59) a point on the clock face points at, from its centre. */
export function minuteAtPoint(dx, dy) {
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return Math.round(degrees / 6) % 60;
}
