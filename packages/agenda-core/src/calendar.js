// Calendar projections (companion spec 4.2, calendar events). Pure.
//
// dayGLANCE devices each publish a projection of the read-only calendar
// events they hold (the sync payload excludes those, so no mirror carries
// them). A reader may hold several — one per device — and they overlap:
// the same feed on two devices yields the same event ids. This merges them
// into one event list with per-day authority (see mergeCalendarProjections),
// ignores projections older than `maxAgeMs` (a device that stopped
// publishing must not pin stale events forever), and keeps only events
// inside [from, to].

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

const inWindow = (d, from, to) => typeof d === 'string' && d >= from && d <= to;

/**
 * @param {object[]} projections  payloads {deviceId, publishedAt, from, to, events:[…], days?:{date: iso}}
 * @param {{ from: string, to: string, nowMs?: number, maxAgeMs?: number }} opts
 * @returns {{ events: object[], freshestAt: number|null, dayAsOf: Record<string, number> }}
 *   events carry `imported: true` and `projected: true` so buildAgenda treats
 *   them as read-only calendar items; freshestAt is the newest publish stamp
 *   used (epoch ms) or null when nothing qualified; dayAsOf is, per date,
 *   the fetch stamp of the projection whose events were taken for it.
 *
 * PER-DAY AUTHORITY. A projection declares the days it knows: its `days`
 * map (the cache's per-day fetch stamps) when present, else every day of
 * its [from, to] at its publish time (payloads from before the cache). For
 * each date, the freshest declaring projection supplies ALL of that date's
 * events and the others supply none — so a device that re-fetched a day
 * and found an event gone removes it, instead of an older device's copy
 * lingering in a union.
 */
export function mergeCalendarProjections(projections, { from, to, nowMs = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const usable = [];
  let freshestAt = null;
  for (const p of projections || []) {
    if (!p || p.kind !== 'projection' || p.type !== 'calendar' || !Array.isArray(p.events)) continue;
    const at = ts(p.publishedAt);
    if (!at || nowMs - at > maxAgeMs) continue;
    if (freshestAt === null || at > freshestAt) freshestAt = at;
    usable.push({ p, at });
  }
  // date → { at, p } for the freshest declaring projection.
  const owner = new Map();
  const declare = (date, at, p) => {
    if (!inWindow(date, from, to)) return;
    const prev = owner.get(date);
    if (!prev || at > prev.at) owner.set(date, { at, p });
  };
  for (const { p, at } of usable) {
    if (p.days && typeof p.days === 'object') {
      for (const [date, iso] of Object.entries(p.days)) {
        const dayAt = ts(iso);
        if (dayAt) declare(date, dayAt, p);
      }
    } else {
      let d = typeof p.from === 'string' ? p.from : from;
      const end = typeof p.to === 'string' ? p.to : to;
      for (; d <= end; d = nextDay(d)) declare(d, at, p);
    }
  }
  const events = [];
  const dayAsOf = {};
  for (const [date, { at, p }] of owner) {
    dayAsOf[date] = at;
    for (const e of p.events) {
      if (!e || e.id == null || e.date !== date) continue;
      events.push({ ...e, id: String(e.id), imported: true, projected: true });
    }
  }
  return { events, freshestAt, dayAsOf };
}

function nextDay(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
