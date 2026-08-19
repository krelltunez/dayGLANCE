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
