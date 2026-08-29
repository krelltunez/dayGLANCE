import { describe, it, expect } from 'vitest';
import { deriveBlockId, splitBlockId, hasForeignBlockId, blockIdSuffix } from './index.js';

// FROZEN-BEHAVIOR PINS for the identity core, living beside the code they
// pin (moved from dayGLANCE's obsidian.deterministicBlockIds.test.js in the
// format-package extraction). Tokens derived by different app versions —
// and now by different CONSUMERS, the app and the bridge plugin — must
// agree forever.

const DATE = '2026-08-29';
const TITLE = 'Ship the report';

describe('unanimity: independent consumers derive the same token', () => {
  it('two simulated devices derive identical tokens from the same line, independently', () => {
    // No shared state between calls — a second "device" is just a second call.
    const deviceA = deriveBlockId(DATE, TITLE);
    const deviceB = deriveBlockId(DATE, TITLE);
    expect(deviceA).toBe(deviceB);
    expect(deviceA).toMatch(/^[a-z0-9]{8}$/);
  });
  it('a retitle of a still-untagged line derives a different token — exactly the pre-existing re-mint behavior', () => {
    expect(deriveBlockId(DATE, 'Old title')).not.toBe(deriveBlockId(DATE, 'New title'));
  });
});

describe('pinned normalization (b)', () => {
  it('differences that DO NOT matter yield identical tokens: NFC/NFD form, leading/trailing whitespace', () => {
    const nfc = 'Café review';       // é composed
    const nfd = 'Café review';      // e + combining acute
    expect(deriveBlockId(DATE, nfd)).toBe(deriveBlockId(DATE, nfc));
    expect(deriveBlockId(DATE, `  ${TITLE}  `)).toBe(deriveBlockId(DATE, TITLE));
  });

  it('differences that DO matter yield different tokens: internal whitespace, date, title text', () => {
    const base = deriveBlockId(DATE, TITLE);
    expect(deriveBlockId(DATE, 'Ship the  report')).not.toBe(base); // internal spacing preserved
    expect(deriveBlockId('2026-08-30', TITLE)).not.toBe(base);      // different daily note
    expect(deriveBlockId(DATE, 'Ship the reports')).not.toBe(base); // different line
  });

  it('the date/title boundary cannot alias', () => {
    expect(deriveBlockId('2026-08-291', 'x')).not.toBe(deriveBlockId('2026-08-29', '1x'));
  });
});

describe('the FROZEN algorithm — golden values', () => {
  // ★ These values pin the derivation for all time. Tokens derived by
  // different app versions must agree forever; if this test fails, the
  // algorithm changed, and shipping that change reintroduces cross-device
  // mint divergence between updated and un-updated devices. Do not update
  // these values — fix the regression.
  it('known inputs produce known tokens', () => {
    expect(deriveBlockId('2026-08-29', 'Ship the report')).toBe('6y27fxnp');
    expect(deriveBlockId('2026-08-29', 'Walk the dog')).toBe('aek0sh1o');
    expect(deriveBlockId('2026-01-01', '')).toBe('0hafidqx');
    expect(deriveBlockId('2026-08-29', 'Café ☕ ünïcödé')).toBe('j92rqxza');
  });
});
