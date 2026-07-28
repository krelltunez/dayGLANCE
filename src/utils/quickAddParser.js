// Natural-language quick-add parser — deterministic, offline, no AI.
//
// Parses Todoist/Fantastical-style phrases out of free task text:
//
//   "dentist tomorrow 3pm every 2 weeks"
//     → date span (tomorrow), time span (3pm), recurrence span (biweekly)
//
// Design rules (load-bearing — see quickAddParser.test.js):
//
// - PURE + DETERMINISTIC. Same text + same `now` → same result. `now` is
//   injectable for tests. English vocabulary only, matching the existing
//   @/~ sigil parser (suggestionParser.js).
// - SPAN-BASED. Every detection carries [start, end) indices into the ORIGINAL
//   text so the UI can render chips, dismiss individual parses, and strip the
//   matched text at save (stripSpans). Text is never rewritten while typing —
//   same convention as the sigil system (cleanTitle strips at save).
// - COEXISTS WITH SIGILS. Regions claimed by the explicit shortcut characters
//   (@date ~time $deadline %duration !priority) are masked out first, so
//   "@tomorrow" is never double-parsed by the NL layer.
// - HONEST ABOUT THE ENGINE. recurrenceEngine.js supports daily / weekly /
//   biweekly / monthly / yearly (+ daysOfWeek / monthDay / monthWeekday).
//   Phrases it cannot represent ("every 3 days") are deliberately NOT parsed —
//   the text stays in the title rather than silently mis-scheduling.
// - ONE ENTITY PER TYPE, LAST MATCH WINS. People write the title first and
//   qualifiers last ("standup friday 9am"), so the right-most date/time/etc.
//   is applied. Within a stage, earlier matchers are more specific and claim
//   their text first (overlap dedupe), THEN last-match-wins runs.
//
// Stage order matters: tags → recurrence → time-range → time → date →
// duration. Each stage masks the text it claims so "every monday" is a
// recurrence, not a date; "3-4pm" is a range, not the time "4pm".

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Abbreviation → day index. Multiple spellings per day (thu/thur/thurs, tue/tues).
const DAY_ABBREVS = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBREVS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Day-part → default start time. Values mirror suggestionParser's naturalTimes.
const DAYPARTS = { morning: '09:00', afternoon: '14:00', evening: '18:00', night: '21:00' };

const DAY_ALT = `${DAY_NAMES.join('|')}|${Object.keys(DAY_ABBREVS).join('|')}`;
const DAYPART_ALT = Object.keys(DAYPARTS).join('|');
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };

const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const toTimeStr = (h, m = 0) => `${pad2(h)}:${pad2(m)}`;

const display12h = (timeStr) => {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const dh = h % 12 === 0 ? 12 : h % 12;
  return `${dh}:${pad2(m)} ${ampm}`;
};

const ordinalSuffix = (n) =>
  n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';

const dayIndexOf = (word) => {
  const w = word.toLowerCase();
  const full = DAY_NAMES.indexOf(w);
  if (full !== -1) return full;
  return w in DAY_ABBREVS ? DAY_ABBREVS[w] : -1;
};

// Next occurrence of weekday `idx`; matches the sigil parser's semantics:
// if today IS that weekday, jump a full week.
const nextWeekday = (now, idx) => {
  const d = new Date(now);
  let add = idx - d.getDay();
  if (add <= 0) add += 7;
  d.setDate(d.getDate() + add);
  return d;
};

// Bare-hour meridiem rule for "at 3" / "from 3 to 5" (no am/pm given):
// working-hours assumption — 8..11 → AM, 12 → noon, 1..7 → PM, 13..23 → 24h.
// Deterministic; the chip shows the resolved time so surprises are visible.
const bareHourTo24 = (h) => {
  if (h >= 13 && h <= 23) return h;
  if (h >= 8 && h <= 12) return h;
  return h + 12; // 1..7 → 13..19
};

const meridiemTo24 = (h, ap) => {
  if (ap === 'pm') return h === 12 ? 12 : h + 12;
  return h === 12 ? 0 : h; // am
};

// ---------------------------------------------------------------------------
// Masking helpers
// ---------------------------------------------------------------------------

// Blank a [start,end) region with spaces, preserving all other indices.
const maskRange = (chars, start, end) => {
  for (let i = start; i < end; i++) chars[i] = ' ';
};

// Mask every sigil-claimed region so the NL layer never double-parses them.
// Patterns mirror cleanTitle() in suggestionParser.js.
const SIGIL_PATTERNS = [
  /@[\w\s/\-,]*/g,
  /~[\w\s:]*/g,
  /\$[\w\s/\-,]*/g,
  /%\d+/g,
  /!{1,3}(?=\s|$)/g,
];
const maskSigils = (chars, text) => {
  for (const pat of SIGIL_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      if (m[0].length === 0) { pat.lastIndex++; continue; }
      maskRange(chars, m.index, m.index + m[0].length);
    }
  }
};

// ---------------------------------------------------------------------------
// Stage: tags (#tag) — chips only; the text stays in the title (app convention:
// tags live inline and are extracted at save by extractTags).
// ---------------------------------------------------------------------------

const matchTags = (masked, spans) => {
  const re = /(^|\s)#([a-zA-Z]\w*)/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const start = m.index + m[1].length;
    spans.push({
      type: 'tag',
      start,
      end: start + 1 + m[2].length,
      value: m[2].toLowerCase(),
      display: `#${m[2].toLowerCase()}`,
    });
  }
};

// ---------------------------------------------------------------------------
// Stage: recurrence
// ---------------------------------------------------------------------------

// Parse "mon, wed and fri" / "tuesday/thursday" into sorted unique day indices.
const parseDayList = (listText) => {
  const days = [];
  const re = new RegExp(`\\b(${DAY_ALT})\\b`, 'gi');
  let m;
  while ((m = re.exec(listText)) !== null) {
    const idx = dayIndexOf(m[1]);
    if (idx !== -1 && !days.includes(idx)) days.push(idx);
  }
  return days.sort((a, b) => a - b);
};

const describeDays = (days) =>
  days.length === 1 ? DAY_LABELS[days[0]] : days.map((d) => DAY_SHORT[d]).join('/');

const DAY_LIST_RE = `(?:${DAY_ALT})(?:\\s*(?:,|and|&|\\/)\\s*(?:${DAY_ALT}))*`;

// Ordered most-specific-first; the first rule family that matches wins.
const RECURRENCE_RULES = [
  // every 2 weeks [on <days>] / every other week / biweekly / fortnightly
  {
    re: new RegExp(`\\b(?:every\\s+(?:2|two)\\s+weeks|every\\s+other\\s+week|bi-?weekly|fortnightly)(?:\\s+on\\s+(${DAY_LIST_RE}))?\\b`, 'gi'),
    build: (m) => {
      const days = m[1] ? parseDayList(m[1]) : [];
      return {
        value: days.length ? { type: 'biweekly', daysOfWeek: days } : { type: 'biweekly' },
        display: days.length ? `Every 2 weeks on ${describeDays(days)}` : 'Every 2 weeks',
      };
    },
  },
  // every other <weekday>
  {
    re: new RegExp(`\\bevery\\s+other\\s+(${DAY_ALT})\\b`, 'gi'),
    build: (m) => {
      const idx = dayIndexOf(m[1]);
      if (idx === -1) return null;
      return { value: { type: 'biweekly', daysOfWeek: [idx] }, display: `Every 2 weeks on ${DAY_LABELS[idx]}` };
    },
  },
  // every Nth [of the month] → monthly on day N ("rent every 1st")
  {
    re: /\bevery\s+(\d{1,2})(?:st|nd|rd|th)(?:\s+of\s+(?:the|each|every)\s+month)?\b/gi,
    build: (m) => {
      const day = parseInt(m[1], 10);
      if (day < 1 || day > 31) return null;
      return {
        value: { type: 'monthly', monthDay: day, monthWeekday: null },
        display: `Monthly on the ${day}${ordinalSuffix(day)}`,
      };
    },
  },
  // every first|1st..fifth|5th <weekday> [of the month] → monthly monthWeekday
  {
    re: new RegExp(`\\bevery\\s+(first|second|third|fourth|fifth|[1-5](?:st|nd|rd|th))\\s+(${DAY_ALT})(?:\\s+of\\s+(?:the|each|every)\\s+month)?\\b`, 'gi'),
    build: (m) => {
      const week = ORDINALS[m[1].toLowerCase()];
      const idx = dayIndexOf(m[2]);
      if (!week || idx === -1) return null;
      const ordLabels = ['', '1st', '2nd', '3rd', '4th', '5th'];
      return {
        value: { type: 'monthly', monthDay: null, monthWeekday: { week, day: idx } },
        display: `Monthly on the ${ordLabels[week]} ${DAY_LABELS[idx]}`,
      };
    },
  },
  // every week [on <days>] / weekly [on <days>]
  {
    re: new RegExp(`\\b(?:every\\s+week|weekly)(?:\\s+on\\s+(${DAY_LIST_RE}))?\\b`, 'gi'),
    build: (m) => {
      const days = m[1] ? parseDayList(m[1]) : [];
      return {
        value: days.length ? { type: 'weekly', daysOfWeek: days } : { type: 'weekly' },
        display: days.length ? `Every week on ${describeDays(days)}` : 'Every week',
      };
    },
  },
  // every weekday / every weekend
  {
    re: /\bevery\s+weekdays?\b/gi,
    build: () => ({ value: { type: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] }, display: 'Every weekday (Mon-Fri)' }),
  },
  {
    re: /\bevery\s+weekends?\b/gi,
    build: () => ({ value: { type: 'weekly', daysOfWeek: [0, 6] }, display: 'Every weekend (Sat-Sun)' }),
  },
  // every <day list> ("every monday", "every mon and wed")
  {
    re: new RegExp(`\\bevery\\s+(${DAY_LIST_RE})\\b`, 'gi'),
    build: (m) => {
      const days = parseDayList(m[1]);
      if (!days.length) return null;
      return { value: { type: 'weekly', daysOfWeek: days }, display: `Every week on ${describeDays(days)}` };
    },
  },
  // every day / daily; every morning|afternoon|evening|night → daily + implied time
  {
    re: new RegExp(`\\bevery\\s+(day|${DAYPART_ALT})\\b|\\bdaily\\b`, 'gi'),
    build: (m) => {
      const part = m[1]?.toLowerCase();
      if (part && part !== 'day') {
        return {
          value: { type: 'daily' },
          display: `Every ${part} (${display12h(DAYPARTS[part])})`,
          impliedTime: DAYPARTS[part],
        };
      }
      return { value: { type: 'daily' }, display: 'Every day' };
    },
  },
  // every month / monthly (bare)
  {
    re: /\b(?:every\s+month|monthly)\b/gi,
    build: () => ({ value: { type: 'monthly' }, display: 'Every month' }),
  },
  // every year / yearly / annually
  {
    re: /\b(?:every\s+year|yearly|annually)\b/gi,
    build: () => ({ value: { type: 'yearly' }, display: 'Every year' }),
  },
  // NOTE deliberately absent: "every N days/weeks/months" for arbitrary N —
  // recurrenceEngine.js cannot represent those, so we leave the text alone.
];

const matchRecurrence = (masked, spans) => {
  for (const rule of RECURRENCE_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(masked)) !== null) {
      const built = rule.build(m);
      if (!built) continue;
      spans.push({ type: 'recurrence', start: m.index, end: m.index + m[0].length, ...built });
    }
    if (spans.length) break; // first (most specific) matching rule family wins
  }
};

// ---------------------------------------------------------------------------
// Stage: time range → startTime + duration
// ---------------------------------------------------------------------------

const TIME_PART = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?';

const resolveRangeSide = (h, ap, fallbackAp) => {
  if (ap) return meridiemTo24(h, ap);
  if (h >= 13 && h <= 23) return h;
  if (fallbackAp) return meridiemTo24(h, fallbackAp);
  return bareHourTo24(h);
};

const matchTimeRange = (masked, spans) => {
  // "from 3 to 4:30" | "3-4pm" | "3pm - 5pm" | "9am to noonish" (no).
  // Guard: bare "N-N" (no meridiem, no :MM anywhere, no from/at prefix) is
  // NOT a range — could be "sections 3-4". One anchor required.
  const re = new RegExp(`\\b(from\\s+|at\\s+)?${TIME_PART}\\s*(?:-|–|to)\\s*${TIME_PART}\\b`, 'gi');
  let m;
  while ((m = re.exec(masked)) !== null) {
    const [, prefix, h1s, m1s, ap1, h2s, m2s, ap2] = m;
    const anchored = !!(prefix || ap1 || ap2 || m1s || m2s);
    if (!anchored) continue;
    const h1 = parseInt(h1s, 10);
    const h2 = parseInt(h2s, 10);
    if (h1 > 23 || h2 > 23) continue;
    const min1 = m1s ? parseInt(m1s, 10) : 0;
    const min2 = m2s ? parseInt(m2s, 10) : 0;
    if (min1 > 59 || min2 > 59) continue;

    // Resolve the end first (its meridiem back-propagates to the start).
    const end24 = resolveRangeSide(h2, ap2, ap1);
    let start24 = resolveRangeSide(h1, ap1, ap2);
    let startMins = start24 * 60 + min1;
    let endMins = end24 * 60 + min2;
    // "11-1pm": pm-propagated start (23:00) overshoots the end → try AM start.
    if (startMins >= endMins && !ap1 && h1 >= 1 && h1 <= 12) {
      const alt = meridiemTo24(h1, 'am') * 60 + min1;
      if (alt < endMins) { start24 = meridiemTo24(h1, 'am'); startMins = alt; }
    }
    // Explicit overnight ("11pm to 1am") — wrap past midnight.
    if (startMins >= endMins) endMins += 24 * 60;
    const duration = endMins - startMins;
    if (duration <= 0 || duration > 24 * 60) continue;

    const endDisplay = display12h(toTimeStr(Math.floor((endMins % (24 * 60)) / 60), endMins % 60));
    spans.push({
      type: 'timerange',
      start: m.index,
      end: m.index + m[0].length,
      value: { startTime: toTimeStr(start24, min1), duration },
      display: `${display12h(toTimeStr(start24, min1))} – ${endDisplay}`,
    });
  }
};

// ---------------------------------------------------------------------------
// Stage: time (single)
// ---------------------------------------------------------------------------

const matchTime = (masked, spans) => {
  const push = (m, timeStr) => {
    spans.push({ type: 'time', start: m.index, end: m.index + m[0].length, value: timeStr, display: display12h(timeStr) });
  };
  let m;

  // noon / midnight, optionally prefixed with "at "
  let re = /\b(?:at\s+)?(noon|midnight)\b/gi;
  while ((m = re.exec(masked)) !== null) {
    push(m, m[1].toLowerCase() === 'noon' ? '12:00' : '00:00');
  }

  // H[:MM] am/pm — "3pm", "3:30 pm"
  re = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi;
  while ((m = re.exec(masked)) !== null) {
    const h = parseInt(m[1], 10);
    const mins = m[2] ? parseInt(m[2], 10) : 0;
    if (h < 1 || h > 12 || mins > 59) continue;
    push(m, toTimeStr(meridiemTo24(h, m[3].toLowerCase()), mins));
  }

  // 24h / bare-colon HH:MM — "15:00", "9:30" (taken literally: 09:30)
  re = /\b(?:at\s+)?(\d{1,2}):(\d{2})\b(?!\s*(?:am|pm))/gi;
  while ((m = re.exec(masked)) !== null) {
    const h = parseInt(m[1], 10);
    const mins = parseInt(m[2], 10);
    if (h > 23 || mins > 59) continue;
    push(m, toTimeStr(h, mins));
  }

  // "at H" bare hour — requires the "at" anchor; working-hours meridiem rule.
  re = /\bat\s+(\d{1,2})\b(?!\s*(?::|am|pm))/gi;
  while ((m = re.exec(masked)) !== null) {
    const h = parseInt(m[1], 10);
    if (h < 1 || h > 23) continue;
    push(m, toTimeStr(bareHourTo24(h), 0));
  }
};

// ---------------------------------------------------------------------------
// Stage: date
// ---------------------------------------------------------------------------

const matchDate = (masked, spans, now) => {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const push = (m, date, display, impliedTime) => {
    spans.push({
      type: 'date',
      start: m.index,
      end: m.index + m[0].length,
      value: toDateStr(date),
      display,
      ...(impliedTime ? { impliedTime } : {}),
    });
  };
  let m;

  // tonight → today + 21:00
  let re = /\btonight\b/gi;
  while ((m = re.exec(masked)) !== null) push(m, today, 'Tonight', '21:00');

  // today/tomorrow/yesterday (+abbrevs) with optional day-part suffix
  re = new RegExp(`\\b(?:on\\s+)?(today|tod|tomorrow|tmrw|tmr|tom|yesterday)(?:\\s+(${DAYPART_ALT}))?\\b`, 'gi');
  while ((m = re.exec(masked)) !== null) {
    const kw = m[1].toLowerCase();
    const d = new Date(today);
    let label;
    if (kw === 'yesterday') { d.setDate(d.getDate() - 1); label = 'Yesterday'; }
    else if (kw === 'today' || kw === 'tod') { label = 'Today'; }
    else { d.setDate(d.getDate() + 1); label = 'Tomorrow'; }
    const part = m[2]?.toLowerCase();
    push(m, d, part ? `${label} ${part}` : label, part ? DAYPARTS[part] : undefined);
  }

  // "this morning/afternoon/evening/night" → today + implied time
  re = new RegExp(`\\bthis\\s+(${DAYPART_ALT})\\b`, 'gi');
  while ((m = re.exec(masked)) !== null) {
    const part = m[1].toLowerCase();
    push(m, today, `Today ${part}`, DAYPARTS[part]);
  }

  // next week → +7 days
  re = /\b(?:on\s+)?next\s+week\b/gi;
  while ((m = re.exec(masked)) !== null) {
    const d = new Date(today);
    d.setDate(d.getDate() + 7);
    push(m, d, 'Next week');
  }

  // [on|next] <weekday> [daypart] — same semantics as the sigil parser:
  // both "friday" and "next friday" mean the next future Friday.
  re = new RegExp(`\\b(?:(on|next)\\s+)?(${DAY_ALT})(?:\\s+(${DAYPART_ALT}))?\\b`, 'gi');
  while ((m = re.exec(masked)) !== null) {
    const idx = dayIndexOf(m[2]);
    if (idx === -1) continue;
    const d = nextWeekday(today, idx);
    const part = m[3]?.toLowerCase();
    const label = (m[1]?.toLowerCase() === 'next' ? `Next ${DAY_LABELS[idx]}` : DAY_LABELS[idx]) + (part ? ` ${part}` : '');
    push(m, d, label, part ? DAYPARTS[part] : undefined);
  }

  // in N days/weeks/months  ("in a week" too)
  re = /\bin\s+(\d{1,3}|an?)\s+(day|week|month)s?\b/gi;
  while ((m = re.exec(masked)) !== null) {
    const n = m[1] === 'a' || m[1] === 'an' ? 1 : parseInt(m[1], 10);
    if (!n || n > 365) continue;
    const unit = m[2].toLowerCase();
    const d = new Date(today);
    if (unit === 'day') d.setDate(d.getDate() + n);
    else if (unit === 'week') d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    push(m, d, `In ${n} ${unit}${n === 1 ? '' : 's'}`);
  }

  // Month D[st|nd|rd|th][, YYYY] — "june 3", "Jun 3rd 2027". No year → roll
  // forward to next year if the date has already passed (quick-add intent).
  // Bare month names ("May") deliberately do NOT parse — too title-collision-prone.
  const monthAlt = `${MONTH_NAMES.join('|')}|${MONTH_ABBREVS.join('|')}`;
  re = new RegExp(`\\b(?:on\\s+)?(${monthAlt})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:[,\\s]\\s*(\\d{4}))?\\b`, 'gi');
  while ((m = re.exec(masked)) !== null) {
    const mw = m[1].toLowerCase();
    let mi = MONTH_NAMES.indexOf(mw);
    if (mi === -1) mi = MONTH_ABBREVS.indexOf(mw);
    if (mi === -1) continue;
    const day = parseInt(m[2], 10);
    if (day < 1 || day > 31) continue;
    let year = m[3] ? parseInt(m[3], 10) : today.getFullYear();
    let d = new Date(year, mi, day, 12, 0, 0);
    if (d.getDate() !== day) continue; // e.g. Feb 30
    if (!m[3] && d < today) { year += 1; d = new Date(year, mi, day, 12, 0, 0); }
    const yearSuffix = year !== today.getFullYear() ? `, ${year}` : '';
    push(m, d, `${MONTH_LABELS[mi]} ${day}${yearSuffix}`);
  }

  // M/D[/YYYY] — slash dates. (Dash form deliberately omitted: bare "3-4" is
  // a range or section number, not a date.)
  re = /\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g;
  while ((m = re.exec(masked)) !== null) {
    const mo = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (mo < 1 || mo > 12 || day < 1 || day > 31) continue;
    let year = m[3] ? parseInt(m[3], 10) : today.getFullYear();
    let d = new Date(year, mo - 1, day, 12, 0, 0);
    if (d.getDate() !== day) continue;
    if (!m[3] && d < today) { year += 1; d = new Date(year, mo - 1, day, 12, 0, 0); }
    const yearSuffix = year !== today.getFullYear() ? `, ${year}` : '';
    push(m, d, `${MONTH_LABELS[mo - 1]} ${day}${yearSuffix}`);
  }
};

// ---------------------------------------------------------------------------
// Stage: duration — "for 30 min", "for 1h", "for 1.5 hours", "for an hour",
// plus glued compact forms "1h30m" / "90m" / "2h" without "for".
// ---------------------------------------------------------------------------

const fmtDuration = (mins) => {
  const h = Math.floor(mins / 60);
  const r = mins % 60;
  return h > 0 ? `${h}h${r ? ` ${r}m` : ''}` : `${mins}m`;
};

const matchDuration = (masked, spans) => {
  const push = (m, mins) => {
    if (mins < 1 || mins > 24 * 60) return;
    spans.push({ type: 'duration', start: m.index, end: m.index + m[0].length, value: mins, display: `For ${fmtDuration(mins)}` });
  };
  let m;

  let re = /\bfor\s+(?:(an?)\s+hour|(half)\s+an?\s+hour|(\d+(?:\.\d+)?)\s*(h(?:ou)?rs?|h|m(?:in(?:ute)?s?)?)(?:\s*(\d{1,2})\s*m(?:in(?:ute)?s?)?)?)\b/gi;
  while ((m = re.exec(masked)) !== null) {
    let mins;
    if (m[1]) mins = 60; // "for an hour"
    else if (m[2]) mins = 30; // "for half an hour"
    else {
      const n = parseFloat(m[3]);
      const unit = m[4].toLowerCase();
      mins = unit.startsWith('h') ? Math.round(n * 60) : Math.round(n);
      if (m[5]) mins += parseInt(m[5], 10); // "for 1h 30m"
    }
    push(m, mins);
  }

  // Compact glued forms only (no space between number and unit) — avoids
  // stealing legitimate text like "100 m sprint".
  re = /\b(\d{1,2})h(?:(\d{1,2})m)?\b|\b(\d{1,3})m\b/gi;
  while ((m = re.exec(masked)) !== null) {
    let mins;
    if (m[3]) mins = parseInt(m[3], 10);
    else mins = parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
    if (mins < 5) continue; // "3m" almost certainly isn't a duration
    push(m, mins);
  }
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse natural-language entities out of quick-add text.
 *
 * @param {string} text  Raw input text.
 * @param {object} [opts]
 * @param {Date}   [opts.now]  Clock injection for tests.
 * @returns {{ spans: Array<{type, start, end, text, value, display, impliedTime?}> }}
 *   At most one span per type (last match wins), except 'tag' (all tags kept).
 *   Types: 'tag' | 'recurrence' | 'timerange' | 'time' | 'date' | 'duration'.
 */
export const parseQuickAdd = (text, { now = new Date() } = {}) => {
  if (!text || !text.trim()) return { spans: [] };

  const chars = text.split('');
  maskSigils(chars, text);

  const all = [];
  const runStage = (fn, ...extra) => {
    const masked = chars.join('');
    const candidates = [];
    fn(masked, candidates, ...extra);
    if (!candidates.length) return;

    // 1. Overlap dedupe in push order: matchers within a stage run
    //    most-specific-first, so the first span claiming a region wins
    //    ("3:30 pm" beats the bare "3:30" 24h reading).
    const claimed = [];
    for (const s of candidates) {
      if (claimed.some((c) => s.start < c.end && c.start < s.end)) continue;
      claimed.push(s);
    }

    // 2. Last match wins (right-most span) — except tags, which all survive.
    let kept = claimed;
    if (claimed[0].type !== 'tag') {
      kept = [claimed.reduce((a, b) => (b.start >= a.start ? b : a))];
    }

    for (const s of kept) {
      s.text = text.slice(s.start, s.end);
      all.push(s);
      maskRange(chars, s.start, s.end);
    }
  };

  runStage(matchTags);
  runStage(matchRecurrence);
  runStage(matchTimeRange);
  runStage(matchTime);
  runStage(matchDate, now);
  runStage(matchDuration);

  return { spans: all.sort((a, b) => a.start - b.start) };
};

/**
 * Remove accepted NL spans from a title (called at save, before cleanTitle).
 * Tag spans are kept by default — tags live inline in the title by app
 * convention. The voice pipeline passes includeTags: true because it carries
 * tags as a separate array and re-appends them on apply.
 */
export const stripSpans = (title, spans, { includeTags = false } = {}) => {
  if (!spans || !spans.length) return title;
  const remove = spans
    .filter((s) => includeTags || s.type !== 'tag')
    .sort((a, b) => b.start - a.start);
  let out = title;
  for (const s of remove) {
    out = out.slice(0, s.start) + out.slice(s.end);
  }
  return out.replace(/\s+/g, ' ').trim();
};

/** Stable identity for a span so dismissals survive re-parsing while typing. */
export const spanSignature = (span) => `${span.type}:${span.text.toLowerCase()}`;
