import { describe, it, expect, vi } from 'vitest';
import {
  PRIMARY_FEED_ID,
  isIcsContent,
  withExportParam,
  fetchIcsFeed,
  isFeedEvent,
  replaceFeedEvents,
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
