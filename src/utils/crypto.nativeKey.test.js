import { describe, it, expect, afterEach } from 'vitest';
import { isFileKeyRecord } from './crypto.js';

// The file-tier key's Android keystore record is {rawKey, salt}. On a shell
// with one shared slot the GLANCEvault root key ({rootBytes, salt}) lands in
// the same place; read as the file key it failed the AES import and the
// Direct Access cycle prompted for the passphrase again (2026-10-10). The shim
// treats a record of the other shape as no key.
const rec = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');

describe('isFileKeyRecord', () => {
  afterEach(() => { delete global.window; });

  it('accepts only a non-empty rawKey record', () => {
    expect(isFileKeyRecord(rec({ rawKey: [1, 2, 3], salt: [4] }))).toBe(true);
    expect(isFileKeyRecord(rec({ rootBytes: [1, 2, 3], salt: [4] }))).toBe(false);
    expect(isFileKeyRecord(rec({ rawKey: [], salt: [] }))).toBe(false);
    expect(isFileKeyRecord('')).toBe(false);
    expect(isFileKeyRecord(null)).toBe(false);
    expect(isFileKeyRecord('%%%')).toBe(false);
  });
});
