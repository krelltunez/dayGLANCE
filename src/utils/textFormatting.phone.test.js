import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The task-level wiring of the phone-note affordance: isPhoneOnlyTask /
// isLinkOnlyTask / getLinkUrl / openNoteAction, with the platform capability
// toggled per test. The detection rules themselves live in
// phoneNumber.test.js; here we pin how the affordance composes with the
// existing URL-only behavior and the open mechanism split (tel: must
// NAVIGATE, never window.open: the iOS shell's window.open path forwards
// only http/https).

let dialable = true;
vi.mock('./phoneNumber.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, canDialHere: () => dialable };
});

const { isPhoneOnlyTask, isLinkOnlyTask, getLinkUrl, openNoteAction } =
  await import('./textFormatting.jsx');

const phoneTask = (over = {}) => ({ id: 't1', title: 'Call the dentist', notes: '+1 (415) 555-0134', ...over });
const linkTask = (over = {}) => ({ id: 't2', title: 'Read this', notes: 'https://example.com/a', ...over });

beforeEach(() => { dialable = true; });
afterEach(() => { delete globalThis.window; });

describe('phone-note affordance (dialable platform)', () => {
  it('a phone-only note is an action note with a tel: URL', () => {
    expect(isPhoneOnlyTask(phoneTask())).toBe(true);
    expect(isLinkOnlyTask(phoneTask())).toBe(true);
    expect(getLinkUrl(phoneTask())).toBe('tel:+14155550134');
  });

  it('subtasks disable the affordance, same as for links', () => {
    expect(isPhoneOnlyTask(phoneTask({ subtasks: [{ id: 's1' }] }))).toBe(false);
    expect(isLinkOnlyTask(phoneTask({ subtasks: [{ id: 's1' }] }))).toBe(false);
  });

  it('URL notes keep their exact prior behavior (raw URL, phone check never rewrites them)', () => {
    expect(isPhoneOnlyTask(linkTask())).toBe(false);
    expect(isLinkOnlyTask(linkTask())).toBe(true);
    expect(getLinkUrl(linkTask())).toBe('https://example.com/a');
  });

  it('openNoteAction NAVIGATES for tel: and window.opens for links', () => {
    const opened = [];
    globalThis.window = {
      open: (...args) => opened.push(args),
      location: { href: 'app://dayglance/' },
    };
    openNoteAction(phoneTask());
    expect(window.location.href).toBe('tel:+14155550134');
    expect(opened).toEqual([]);

    openNoteAction(linkTask());
    expect(opened).toEqual([['https://example.com/a', '_blank', 'noopener,noreferrer']]);
  });
});

describe('phone-note affordance (desktop: not dialable)', () => {
  beforeEach(() => { dialable = false; });

  it('the same task is a plain note: no phone affordance, no tel: URL', () => {
    expect(isPhoneOnlyTask(phoneTask())).toBe(false);
    expect(isLinkOnlyTask(phoneTask())).toBe(false);
    // getLinkUrl falls back to the raw note (its pre-feature behavior).
    expect(getLinkUrl(phoneTask())).toBe('+1 (415) 555-0134');
  });

  it('URL notes are unaffected by the capability gate', () => {
    expect(isLinkOnlyTask(linkTask())).toBe(true);
    expect(getLinkUrl(linkTask())).toBe('https://example.com/a');
  });
});
