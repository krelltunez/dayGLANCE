import { describe, it, expect } from 'vitest';
import { isOnlyPhoneNumber, phoneTelUrl, canDialPhone } from './phoneNumber.js';

// The contract: detection is STRICT (a false positive turns the notes button
// into a dial button), the tel: URI keeps only digits and a leading +, and
// dialing is platform-gated to native apps and mobile browsers.

describe('isOnlyPhoneNumber', () => {
  it('accepts the shapes people actually type', () => {
    for (const s of [
      '+1 (415) 555-0134',
      '(415) 555-0134',
      '415-555-0134',
      '4155550134',
      '+44 20 7946 0958',
      '555.0134.99',
      '  415 555 0134  ',
      '01 42 68 53 00',
    ]) {
      expect(isOnlyPhoneNumber(s), s).toBe(true);
    }
  });

  it('rejects date-shaped strings even though they fit the charset', () => {
    for (const s of ['2026-08-16', '2026.8.16', '16-08-2026', '8/16/26', '16.08.2026']) {
      expect(isOnlyPhoneNumber(s), s).toBe(false);
    }
  });

  it('rejects too few or too many digits (7 to 15, the E.164 bound)', () => {
    expect(isOnlyPhoneNumber('555-0134')).toBe(true); // exactly 7
    expect(isOnlyPhoneNumber('555-013')).toBe(false); // 6
    expect(isOnlyPhoneNumber('123456789012345')).toBe(true); // exactly 15
    expect(isOnlyPhoneNumber('1234567890123456')).toBe(false); // 16
  });

  it('rejects anything that is not purely a number', () => {
    for (const s of [
      'call 415-555-0134',
      '415-555-0134 tomorrow',
      'https://example.com',
      'x415555O134', // letter O, letters anywhere
      '', '   ', null, undefined, 42,
    ]) {
      expect(isOnlyPhoneNumber(s), String(s)).toBe(false);
    }
  });

  it('allows + only at the start', () => {
    expect(isOnlyPhoneNumber('+14155550134')).toBe(true);
    expect(isOnlyPhoneNumber('415+5550134')).toBe(false);
  });
});

describe('phoneTelUrl', () => {
  it('strips separators and keeps a leading +', () => {
    expect(phoneTelUrl('+1 (415) 555-0134')).toBe('tel:+14155550134');
    expect(phoneTelUrl('(415) 555-0134')).toBe('tel:4155550134');
    expect(phoneTelUrl('  415.555.0134 ')).toBe('tel:4155550134');
  });
});

describe('canDialPhone', () => {
  it('native app always dials, whatever the UA says', () => {
    expect(canDialPhone(true, 'Mozilla/5.0 (Windows NT 10.0)')).toBe(true);
  });

  it('mobile browsers dial; desktop does not', () => {
    expect(canDialPhone(false, 'Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe(true);
    expect(canDialPhone(false, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe(true);
    expect(canDialPhone(false, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(false);
    expect(canDialPhone(false, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe(false);
    expect(canDialPhone(false, '')).toBe(false);
    expect(canDialPhone(false, undefined)).toBe(false);
  });
});
