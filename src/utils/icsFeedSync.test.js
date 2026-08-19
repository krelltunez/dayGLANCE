import { describe, it, expect, vi } from 'vitest';
import {
  PRIMARY_FEED_ID,
  isIcsContent,
  withExportParam,
  fetchIcsFeed,
  isFeedEvent,
  replaceFeedEvents,
  isActiveIcsCalendar,
  hasActiveIcsCalendars,
  stripIcsCalendarCredentials,
  applyRemoteIcsCalendars,
  injectPrimaryStub,
  splitPrimaryStub,
} from './icsFeedSync.js';

const ICS = 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nEND:VEVENT\nEND:VCALENDAR';
const HTML = '<!doctype html><html><body>login</body></html>';

const mockResponse = (body, { ok = true, contentType = 'text/calendar' } = {}) => ({
  ok,
  headers: { get: () => contentType },
  text: async () => body,
});

describe('isIcsContent', () => {
  it('detects ICS documents', () => {
    expect(isIcsContent(ICS)).toBe(true);
    expect(isIcsContent(HTML)).toBe(false);
    expect(isIcsContent(null)).toBe(false);
  });
});

describe('withExportParam', () => {
  it('appends ?export to a bare URL', () => {
    expect(withExportParam('https://x.test/cal/')).toBe('https://x.test/cal/?export');
  });

  it('appends &export when the URL already has a query', () => {
    expect(withExportParam('https://x.test/cal/?a=1')).toBe('https://x.test/cal/?a=1&export');
  });
});

describe('fetchIcsFeed', () => {
  it('returns the content and original URL when the response is ICS', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(ICS));
    const result = await fetchIcsFeed('https://x.test/cal.ics', null, fetchFn);
    expect(result).toEqual({ icsContent: ICS, effectiveUrl: 'https://x.test/cal.ics' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('https://x.test/cal.ics', null);
  });

  it('passes the auth value through to the fetch function', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(ICS));
    await fetchIcsFeed('https://x.test/cal.ics', 'Basic abc', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('https://x.test/cal.ics', 'Basic abc');
  });

  it('throws fetch-failed on an HTTP error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse('', { ok: false }));
    await expect(fetchIcsFeed('https://x.test/cal.ics', null, fetchFn)).rejects.toThrow('fetch-failed');
  });

  it('retries with ?export when the response is not ICS and reports the corrected URL', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockResponse(HTML, { contentType: 'text/html' }))
      .mockResolvedValueOnce(mockResponse(ICS));
    const result = await fetchIcsFeed('https://x.test/cal/', null, fetchFn);
    expect(result).toEqual({ icsContent: ICS, effectiveUrl: 'https://x.test/cal/?export' });
    expect(fetchFn).toHaveBeenNthCalledWith(2, 'https://x.test/cal/?export', null);
  });

  it('does not retry when the URL already contains export', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(HTML, { contentType: 'text/html' }));
    await expect(fetchIcsFeed('https://x.test/cal/?export', null, fetchFn)).rejects.toThrow('not-ical');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws not-ical when the retry also returns non-ICS', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse(HTML, { contentType: 'text/html' }));
    await expect(fetchIcsFeed('https://x.test/cal/', null, fetchFn)).rejects.toThrow('not-ical');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws not-ical when the retry request itself fails', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(mockResponse(HTML, { contentType: 'text/html' }))
      .mockRejectedValueOnce(new Error('network'));
    await expect(fetchIcsFeed('https://x.test/cal/', null, fetchFn)).rejects.toThrow('not-ical');
  });
});

describe('isFeedEvent', () => {
  it('matches subscription-derived events only', () => {
    expect(isFeedEvent({ imported: true, isTaskCalendar: false, importSource: 'sync' })).toBe(true);
    expect(isFeedEvent({ imported: true, isTaskCalendar: true, importSource: 'sync' })).toBe(false);
    expect(isFeedEvent({ imported: true, isTaskCalendar: false, importSource: 'file' })).toBe(false);
    expect(isFeedEvent({ imported: false })).toBe(false);
    expect(isFeedEvent(null)).toBe(false);
  });
});

describe('replaceFeedEvents', () => {
  const userTask = { id: 'u1', title: 'mine' };
  const fileImport = { id: 'f1', imported: true, isTaskCalendar: false, importSource: 'file' };
  const taskCalItem = { id: 'tc1', imported: true, isTaskCalendar: true, importSource: 'sync' };
  const oldPrimary = { id: 'p1', imported: true, isTaskCalendar: false, importSource: 'sync' };
  const oldFeedA = { id: 'a1', imported: true, isTaskCalendar: false, importSource: 'sync', feedId: 'feed-a' };
  const oldFeedB = { id: 'b1', imported: true, isTaskCalendar: false, importSource: 'sync', feedId: 'feed-b' };

  it('replaces all feed events by default, preserving user tasks, file imports, and task-calendar items', () => {
    const fresh = [{ id: 'n1', imported: true, isTaskCalendar: false, importSource: 'sync' }];
    const result = replaceFeedEvents([userTask, fileImport, taskCalItem, oldPrimary, oldFeedA], fresh);
    expect(result).toEqual([userTask, fileImport, taskCalItem, ...fresh]);
  });

  it('keeps events of feeds listed in keepFeedIds (failed fetches) and drops the rest', () => {
    const fresh = [{ id: 'a2', imported: true, isTaskCalendar: false, importSource: 'sync', feedId: 'feed-a' }];
    const result = replaceFeedEvents(
      [userTask, oldFeedA, oldFeedB, oldPrimary],
      fresh,
      { keepFeedIds: new Set(['feed-b']) }
    );
    expect(result).toEqual([userTask, oldFeedB, ...fresh]);
  });

  it('treats events without a feedId as belonging to the primary feed', () => {
    const result = replaceFeedEvents(
      [oldPrimary, oldFeedA],
      [],
      { keepFeedIds: new Set([PRIMARY_FEED_ID]) }
    );
    expect(result).toEqual([oldPrimary]);
  });
});

describe('isActiveIcsCalendar / hasActiveIcsCalendars', () => {
  it('requires a non-blank URL and not-disabled', () => {
    expect(isActiveIcsCalendar({ url: 'https://x.test/c/' })).toBe(true);
    expect(isActiveIcsCalendar({ url: 'https://x.test/c/', enabled: true })).toBe(true);
    expect(isActiveIcsCalendar({ url: 'https://x.test/c/', enabled: false })).toBe(false);
    expect(isActiveIcsCalendar({ url: '   ' })).toBe(false);
    expect(isActiveIcsCalendar({})).toBe(false);
    expect(isActiveIcsCalendar(null)).toBe(false);
    expect(hasActiveIcsCalendars([{ url: '' }, { url: 'https://x.test/c/' }])).toBe(true);
    expect(hasActiveIcsCalendars([])).toBe(false);
    expect(hasActiveIcsCalendars(undefined)).toBe(false);
  });
});

describe('stripIcsCalendarCredentials', () => {
  it('removes username/password and keeps everything else', () => {
    const stripped = stripIcsCalendarCredentials([
      { id: 'a', name: 'Work', url: 'https://x.test/c/', username: 'u', password: 'p', color: 'bg-blue-600', enabled: true },
    ]);
    expect(stripped).toEqual([
      { id: 'a', name: 'Work', url: 'https://x.test/c/', color: 'bg-blue-600', enabled: true },
    ]);
  });

  it('tolerates null/undefined', () => {
    expect(stripIcsCalendarCredentials(null)).toEqual([]);
  });
});

describe('applyRemoteIcsCalendars', () => {
  const local = [
    { id: 'a', name: 'Work', url: 'https://x.test/a/', username: 'u', password: 'p' },
    { id: 'b', name: 'Home', url: 'https://x.test/b/', username: 'hu', password: 'hp' },
  ];

  it('restores local credentials for credential-stripped remote entries', () => {
    const remote = [{ id: 'a', name: 'Work renamed', url: 'https://x.test/a2/' }];
    expect(applyRemoteIcsCalendars(remote, local)).toEqual([
      { id: 'a', name: 'Work renamed', url: 'https://x.test/a2/', username: 'u', password: 'p' },
    ]);
  });

  it('prefers credentials carried by the remote entry (per-user encrypted config)', () => {
    const remote = [{ id: 'a', name: 'Work', url: 'https://x.test/a/', username: 'ru', password: 'rp' }];
    expect(applyRemoteIcsCalendars(remote, local)[0]).toMatchObject({ username: 'ru', password: 'rp' });
  });

  it('drops local entries absent from the remote list and defaults creds for new ones', () => {
    const remote = [{ id: 'c', name: 'New', url: 'https://x.test/c/' }];
    expect(applyRemoteIcsCalendars(remote, local)).toEqual([
      { id: 'c', name: 'New', url: 'https://x.test/c/', username: '', password: '' },
    ]);
  });
});

describe('primary calendar stub (unified list)', () => {
  const META = { name: 'Personal', color: 'bg-teal-600', enabled: false };
  const EXTRAS = [{ id: 'x1', name: 'Work', url: 'https://x.test/w/', color: 'bg-blue-600', enabled: true }];

  it('injectPrimaryStub prepends a URL-less stub when a primary URL is configured', () => {
    const out = injectPrimaryStub(EXTRAS, META, true);
    expect(out[0]).toEqual({ id: 'primary', name: 'Personal', color: 'bg-teal-600', enabled: false });
    expect('url' in out[0]).toBe(false);
    expect(out.slice(1)).toEqual(EXTRAS);
  });

  it('injectPrimaryStub omits the stub without a primary URL and defaults missing meta', () => {
    expect(injectPrimaryStub(EXTRAS, META, false)).toEqual(EXTRAS);
    expect(injectPrimaryStub([], null, true)).toEqual([
      { id: 'primary', name: '', color: 'bg-gray-600', enabled: true },
    ]);
  });

  it('injectPrimaryStub drops a stray primary entry from the extras list', () => {
    const out = injectPrimaryStub([{ id: 'primary', name: 'stale' }, ...EXTRAS], META, true);
    expect(out.filter(c => c.id === 'primary')).toHaveLength(1);
    expect(out[0].name).toBe('Personal');
  });

  it('splitPrimaryStub recovers meta and extras, and round-trips inject', () => {
    const { meta, extras } = splitPrimaryStub(injectPrimaryStub(EXTRAS, META, true));
    expect(meta).toEqual(META);
    expect(extras).toEqual(EXTRAS);
  });

  it('splitPrimaryStub returns null meta for lists without a stub (older clients)', () => {
    expect(splitPrimaryStub(EXTRAS)).toEqual({ meta: null, extras: EXTRAS });
    expect(splitPrimaryStub(undefined)).toEqual({ meta: null, extras: [] });
  });

  it('a Phase-1 build would skip the stub when fetching (no url ⇒ inactive)', () => {
    const stub = injectPrimaryStub([], { enabled: true }, true)[0];
    expect(isActiveIcsCalendar(stub)).toBe(false);
  });
});
