// Helpers for syncing subscribed ICS/CalDAV event feeds ("calendar URL" sync).
// Pure logic extracted from App.jsx so it can be unit-tested and reused across
// multiple configured feeds.

// Feed id for the original single "Calendar URL" setting. Events from this feed
// keep their legacy unprefixed task ids; events that predate feed tagging carry
// no feedId at all and are treated as belonging to this feed.
export const PRIMARY_FEED_ID = 'primary';

export const isIcsContent = (text) =>
  typeof text === 'string' && text.includes('BEGIN:VCALENDAR');

export const withExportParam = (url) =>
  url.includes('?') ? `${url}&export` : `${url}?export`;

/**
 * Fetch an ICS feed, auto-retrying once with ?export appended — CalDAV
 * collection URLs (Baikal, Nextcloud, etc.) return HTML or WebDAV XML unless
 * ?export is appended.
 *
 * @param {string} url
 * @param {string|null} authValue - value for the Authorization header, or null
 * @param {(url: string, authValue: string|null) => Promise<Response>} fetchFn
 * @param {(...args: unknown[]) => void} [debug] - optional dev logger
 * @returns {Promise<{icsContent: string, effectiveUrl: string}>}
 * @throws {Error} message 'fetch-failed' (HTTP error) or 'not-ical' (response
 *   is not an ICS document even after the ?export retry)
 */
export const fetchIcsFeed = async (url, authValue, fetchFn, debug) => {
  const response = await fetchFn(url, authValue);
  if (!response.ok) throw new Error('fetch-failed');

  let icsContent = await response.text();
  let effectiveUrl = url;

  if (!isIcsContent(icsContent) && !url.includes('export')) {
    debug?.('Response is not ICS. Content-Type:', response.headers.get('content-type'), '— First 300 chars:', icsContent.slice(0, 300));
    const exportUrl = withExportParam(url);
    debug?.('Retrying with ?export');
    try {
      const exportResponse = await fetchFn(exportUrl, authValue);
      if (exportResponse.ok) {
        const exportContent = await exportResponse.text();
        if (isIcsContent(exportContent)) {
          icsContent = exportContent;
          effectiveUrl = exportUrl;
        } else {
          debug?.('?export retry also returned non-ICS. Content-Type:', exportResponse.headers.get('content-type'));
        }
      }
    } catch { /* fall through to the not-ical check below */ }
  }

  if (!isIcsContent(icsContent)) throw new Error('not-ical');
  return { icsContent, effectiveUrl };
};

// A subscription-derived calendar event: re-fetched on every sync, so it is
// disposable. Task-calendar items and .ics file imports are first-class user
// data and are never touched by feed replacement.
export const isFeedEvent = (t) =>
  !!(t && t.imported && !t.isTaskCalendar && t.importSource !== 'file');

/**
 * Replace subscription-derived events in a task list with freshly fetched ones.
 *
 * With no keepFeedIds, every feed event is replaced (single-feed behavior).
 * With keepFeedIds (multi-feed), events belonging to those feeds are preserved
 * — used to keep the previous events of a feed whose fetch failed this round,
 * while events of removed feeds (configured no longer) still drop out because
 * their id is in neither freshEvents nor keepFeedIds.
 *
 * @param {Array<object>} prevTasks
 * @param {Array<object>} freshEvents - already expanded + date-window filtered
 * @param {{keepFeedIds?: Set<string>|null}} [options]
 */
export const replaceFeedEvents = (prevTasks, freshEvents, { keepFeedIds = null } = {}) => {
  const kept = prevTasks.filter(t =>
    !isFeedEvent(t) || (keepFeedIds != null && keepFeedIds.has(t.feedId ?? PRIMARY_FEED_ID))
  );
  return [...kept, ...freshEvents];
};

// ── Additional-calendar (multi-feed) config helpers ─────────────────────────
// The primary feed stays in the legacy day-planner-sync-url /
// day-planner-calendar-url-auth keys so older builds sharing a cloud payload
// keep working; additional calendars live in day-planner-ics-calendars as
// [{id, name, url, username, password, color, enabled}].

export const ICS_CALENDARS_KEY = 'day-planner-ics-calendars';

export const newFeedId = () =>
  `ics-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const loadIcsCalendars = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ICS_CALENDARS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// A calendar entry that should actually be fetched.
export const isActiveIcsCalendar = (c) =>
  !!(c && c.enabled !== false && typeof c.url === 'string' && c.url.trim());

export const hasActiveIcsCalendars = (cals) => (cals || []).some(isActiveIcsCalendar);

// Strip credentials before the list leaves the device in a payload that is not
// per-user-encrypted (mirrors taskCalendarAuth, which never rides top-level).
export const stripIcsCalendarCredentials = (cals) =>
  (cals || []).map(({ username: _u, password: _p, ...rest }) => rest);

/**
 * Apply a remote additional-calendars list over the local one, restoring
 * locally stored credentials for entries the remote copy carries none for
 * (the shared cloud payload strips them). A remote entry that DOES carry
 * credentials (per-user encrypted config with creds opted in) wins.
 */
export const applyRemoteIcsCalendars = (remote, local) => {
  const localById = new Map((local || []).map(c => [c.id, c]));
  return (remote || []).map(c => {
    const mine = localById.get(c.id);
    return {
      ...c,
      username: c.username ?? mine?.username ?? '',
      password: c.password ?? mine?.password ?? '',
    };
  });
};

// ── Unified calendar list (primary + extras in one UI) ──────────────────────
// The UI shows one list, but persistence keeps the Phase-1 split so older
// builds sharing localStorage, backups, or a cloud payload stay correct:
// the primary's URL/credentials live in the legacy keys, extras in
// day-planner-ics-calendars, and the primary's display meta (name/color/
// enabled) in its own key below.

export const PRIMARY_CAL_META_KEY = 'day-planner-primary-cal-meta';

export const defaultPrimaryCalendarMeta = () => ({ name: '', color: 'bg-gray-600', enabled: true });

export const loadPrimaryCalendarMeta = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRIMARY_CAL_META_KEY) || 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...defaultPrimaryCalendarMeta(), ...parsed }
      : defaultPrimaryCalendarMeta();
  } catch {
    return defaultPrimaryCalendarMeta();
  }
};

/**
 * Compose the synced icsCalendars payload field from the extras list and the
 * primary's meta. The primary rides as a URL-less, credential-less stub: a
 * build that predates the unified list skips it when fetching (no url) but
 * echoes it back unchanged, and reconstruct-on-apply restores the url from
 * the sibling syncUrl payload field — so a mixed fleet never fetches the
 * primary feed twice and never loses its display meta.
 */
export const injectPrimaryStub = (extras, meta, hasPrimaryUrl) => [
  ...(hasPrimaryUrl ? [{
    id: PRIMARY_FEED_ID,
    name: meta?.name || '',
    color: meta?.color || 'bg-gray-600',
    enabled: meta?.enabled !== false,
  }] : []),
  ...(extras || []).filter(c => c?.id !== PRIMARY_FEED_ID),
];

/**
 * Split a remote icsCalendars field back into { meta, extras }. meta is null
 * when the list carries no primary stub (an older client's payload, or the
 * primary was removed) — callers keep their local meta in that case.
 */
export const splitPrimaryStub = (remote) => {
  const list = Array.isArray(remote) ? remote : [];
  const stub = list.find(c => c?.id === PRIMARY_FEED_ID) || null;
  return {
    meta: stub
      ? { name: stub.name || '', color: stub.color || 'bg-gray-600', enabled: stub.enabled !== false }
      : null,
    extras: list.filter(c => c?.id !== PRIMARY_FEED_ID),
  };
};
