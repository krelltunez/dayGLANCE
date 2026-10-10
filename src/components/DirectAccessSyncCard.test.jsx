import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

// The encryption switch on the Direct Access card (docs/direct-access-sync.md,
// Phase 6): a device with the file-tier key flips it; one without is asked for
// the passphrase first. i18n returns keys; the status hook is the fake
// transport's snapshot. Component tests here render static markup (no DOM),
// so the decisions are exported and exercised directly.
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k) => k }) }));
vi.mock('../native.js', () => ({ isNativeAndroid: () => false, isNativeIOS: () => false }));
vi.mock('../hooks/useDirectAccessStatus.js', () => ({ default: (transport) => transport.getSnapshot() }));
const { default: DirectAccessSyncCard, decideEncryptToggle, turnOnEncryption } = await import('./DirectAccessSyncCard.jsx');

const fakeTransport = (over = {}) => {
  const snap = { supported: true, status: 'connected', name: 'GLANCE', path: '/x', connected: true, enabled: true, encrypt: false, pickError: null, roster: null, ...over };
  return { getSnapshot: () => snap, subscribe: () => () => {}, setEncryptsWrites: vi.fn() };
};
const crypto = (ready) => ({ hasEncryptionReady: () => ready, getSyncPassphrase: () => null, setupEncryptionKey: vi.fn(async () => {}), decryptData: vi.fn(), isEncryptedEnvelope: () => false });
const props = { darkMode: false, textPrimary: '', textSecondary: '', borderClass: '' };
const t = (k) => k;

describe('DirectAccessSyncCard: the encryption switch', () => {
  it('renders the switch only once a folder is connected, reflecting the stored state and its hint', () => {
    const off = renderToStaticMarkup(<DirectAccessSyncCard {...props} transport={fakeTransport()} crypto={crypto(true)} />);
    expect(off).toMatch(/aria-label="directAccess\.encrypt"/);
    expect(off).not.toMatch(/checked=""/);
    expect(off).toContain('directAccess.encryptHint');
    const on = renderToStaticMarkup(<DirectAccessSyncCard {...props} transport={fakeTransport({ encrypt: true })} crypto={crypto(true)} />);
    expect(on).toMatch(/checked=""/);
    expect(on).toContain('directAccess.encryptOnHint');
    expect(on).not.toMatch(/type="password"/);
    const disconnected = renderToStaticMarkup(<DirectAccessSyncCard {...props} transport={fakeTransport({ status: 'disconnected', connected: false, name: null })} crypto={crypto(true)} />);
    expect(disconnected).not.toMatch(/directAccess\.encrypt/);
  });

  it('a tap: off is just off (the file decides), on flips at once with a key in memory, and asks without one', () => {
    expect(decideEncryptToggle({ encrypt: true, keyInMemory: false })).toBe('off');
    expect(decideEncryptToggle({ encrypt: true, keyInMemory: true })).toBe('off');
    expect(decideEncryptToggle({ encrypt: false, keyInMemory: true })).toBe('on');
    expect(decideEncryptToggle({ encrypt: false, keyInMemory: false })).toBe('ask');
  });

  it('turning on from a passphrase refuses a blank or a mismatch, sets the key up before the switch, and reports a derivation failure', async () => {
    const transport = fakeTransport();
    const setup = vi.fn(async () => {});
    expect(await turnOnEncryption({ passphrase: '  ', confirm: '', setupEncryptionKey: setup, transport, t })).toEqual({ ok: false, error: null });
    expect(await turnOnEncryption({ passphrase: 'open sesame', confirm: 'open sesamee', setupEncryptionKey: setup, transport, t })).toEqual({ ok: false, error: 'sync.form.passphraseMismatch' });
    expect(setup).not.toHaveBeenCalled();
    expect(transport.setEncryptsWrites).not.toHaveBeenCalled();
    expect(await turnOnEncryption({ passphrase: 'open sesame ', confirm: ' open sesame', setupEncryptionKey: setup, transport, t })).toEqual({ ok: true });
    expect(setup).toHaveBeenCalledWith('open sesame');
    expect(transport.setEncryptsWrites).toHaveBeenCalledWith(true);
    const failing = fakeTransport();
    const r = await turnOnEncryption({ passphrase: 'x', confirm: 'x', setupEncryptionKey: async () => { throw new Error('keystore unavailable'); }, transport: failing, t });
    expect(r).toEqual({ ok: false, error: 'keystore unavailable' });
    expect(failing.setEncryptsWrites).not.toHaveBeenCalled();
  });
});

describe('DirectAccessSyncCard: remove encryption (Phase 8)', () => {
  it('offers the action only to a device that holds the key, behind a confirmation', () => {
    const withKey = renderToStaticMarkup(<DirectAccessSyncCard {...props} transport={fakeTransport({ encrypt: true })} crypto={crypto(true)} />);
    expect(withKey).toContain('directAccess.removeEncryption');
    expect(withKey).not.toContain('directAccess.removeEncryptionGo');            // the confirmation is a second step
    const withoutKey = renderToStaticMarkup(<DirectAccessSyncCard {...props} transport={fakeTransport({ encrypt: true })} crypto={crypto(false)} />);
    expect(withoutKey).not.toContain('directAccess.removeEncryption');
    const disconnected = renderToStaticMarkup(<DirectAccessSyncCard {...props} transport={fakeTransport({ status: 'disconnected', connected: false, name: null })} crypto={crypto(true)} />);
    expect(disconnected).not.toContain('directAccess.removeEncryption');
  });
});
