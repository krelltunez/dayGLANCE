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
