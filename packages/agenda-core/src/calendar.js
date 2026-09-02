// Calendar projections (companion spec 4.2, calendar events). Pure.
//
// dayGLANCE devices each publish a projection of the read-only calendar
// events they hold (the sync payload excludes those, so no mirror carries
// them). A reader may hold several — one per device — and they overlap:
// the same feed on two devices yields the same event ids. This merges them
// into one event list: freshest projection wins per event id, projections
// older than `maxAgeMs` are ignored (a device that stopped publishing must
// not pin stale events forever), and only events inside [from, to] survive.

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : 0; };

/**
 * @param {object[]} projections  payloads {deviceId, publishedAt, events:[…]}
 * @param {{ from: string, to: string, nowMs?: number, maxAgeMs?: number }} opts
 * @returns {{ events: object[], freshestAt: number|null }}
 *   events carry `imported: true` and `projected: true` so buildAgenda treats
 *   them as read-only calendar items; freshestAt is the newest publish stamp
 *   used (epoch ms) or null when nothing qualified.
 */
export function mergeCalendarProjections(projections, { from, to, nowMs = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const byId = new Map();
  let freshestAt = null;
  for (const p of projections || []) {
    if (!p || p.kind !== 'projection' || p.type !== 'calendar' || !Array.isArray(p.events)) continue;
    const at = ts(p.publishedAt);
    if (!at || nowMs - at > maxAgeMs) continue;
    if (freshestAt === null || at > freshestAt) freshestAt = at;
    for (const e of p.events) {
      if (!e || e.id == null || typeof e.date !== 'string') continue;
      if (e.date < from || e.date > to) continue;
      const prev = byId.get(String(e.id));
      if (prev && prev.at > at) continue;
      byId.set(String(e.id), { at, event: { ...e, id: String(e.id), imported: true, projected: true } });
    }
  }
  return { events: [...byId.values()].map((x) => x.event), freshestAt };
}
