import { describe, it, expect } from 'vitest';
import { syncErrorText } from './syncErrors.js';

// A fake i18next translator: returns a known string for mapped keys, otherwise
// honours { defaultValue } the way i18next does.
const KNOWN = { 'sync.errors.KEY_MISMATCH': 'Wrong sync passphrase.' };
const t = (key, opts = {}) => KNOWN[key] ?? (opts.defaultValue ?? key);

describe('syncErrorText', () => {
  it('returns null for a null/empty message (the engine "clear error" signal)', () => {
    expect(syncErrorText(t, null, 'NETWORK_ERROR')).toBe(null);
    expect(syncErrorText(t, '', 'NETWORK_ERROR')).toBe(null);
  });

  it('maps a known code to its localized string', () => {
    expect(syncErrorText(t, 'raw decrypt error', 'KEY_MISMATCH')).toBe('Wrong sync passphrase.');
  });

  it('falls back to the engine message when the code has no key', () => {
    expect(syncErrorText(t, 'Server exploded', 'SOME_FUTURE_CODE')).toBe('Server exploded');
  });

  it('returns the raw message when there is no code', () => {
    expect(syncErrorText(t, 'Plain message', null)).toBe('Plain message');
    expect(syncErrorText(t, 'Plain message', undefined)).toBe('Plain message');
  });
});

// The two DB-tier codes @glance-apps/sync 1.9.0/1.10.0 introduced. Wording is
// copied verbatim from what lastGLANCE/lifeGLANCE shipped, with the two
// constraints that shaped it: the quota message gives NO deletion advice
// (deletes leave tombstones and reclaim is an operator action, so no user
// action reduces usage) and points at whoever runs the server; the credential
// message avoids "password"/"passphrase" (the passphrase prompt is the wrong
// fix) and leads with local data being safe rather than with sync stopping.
import en from '../../public/locales/en/translation.json';
import fr from '../../public/locales/fr/translation.json';

describe('locale coverage for the 1.10.0 engine codes', () => {
  const realT = (locale) => (key, opts = {}) => {
    const value = key.split('.').reduce((o, k) => (o == null ? o : o[k]), locale);
    return typeof value === 'string' ? value : (opts.defaultValue ?? key);
  };

  it.each([
    ['QUOTA_EXCEEDED'],
    ['CREDENTIAL_INVALID'],
  ])('%s renders from both locales through syncErrorText', (code) => {
    for (const locale of [en, fr]) {
      const rendered = syncErrorText(realT(locale), 'engine fallback message', code);
      expect(rendered, `missing sync.errors.${code}`).not.toBe('engine fallback message');
      expect(rendered.length).toBeGreaterThan(20);
    }
  });

  it('the quota message contains no deletion advice and points at the operator', () => {
    expect(en.sync.errors.QUOTA_EXCEEDED).not.toMatch(/delete|remove|free up/i);
    expect(en.sync.errors.QUOTA_EXCEEDED).toMatch(/whoever runs your sync server/);
    expect(en.sync.errors.QUOTA_EXCEEDED).toMatch(/saved on this device/);
  });

  it('the credential message avoids passphrase language and reassures first', () => {
    expect(en.sync.errors.CREDENTIAL_INVALID).not.toMatch(/password|passphrase/i);
    expect(en.sync.errors.CREDENTIAL_INVALID).toMatch(/^The sync server no longer accepts/);
    expect(en.sync.errors.CREDENTIAL_INVALID).toMatch(/saved on this device/);
  });
});
