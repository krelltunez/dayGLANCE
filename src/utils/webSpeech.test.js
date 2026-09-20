import { describe, it, expect, beforeEach } from 'vitest';
import {
  WEB_SPEECH_BLOCKED_KEY,
  hasWebSpeechAPI, isSpeechBlocked, rememberBlocked, clearBlocked,
  shouldRememberBlock, webSpeechUsable,
} from './webSpeech.js';

const fakeStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
};

// Storage that throws on every access, as it does when the browser has site
// data blocked. Nothing here may take the app down with it.
const hostileStorage = () => ({
  getItem() { throw new Error('denied'); },
  setItem() { throw new Error('denied'); },
  removeItem() { throw new Error('denied'); },
});

describe('hasWebSpeechAPI', () => {
  it('accepts either the standard or the webkit-prefixed constructor', () => {
    expect(hasWebSpeechAPI({ SpeechRecognition: class {} })).toBe(true);
    expect(hasWebSpeechAPI({ webkitSpeechRecognition: class {} })).toBe(true);
  });

  it('is false where neither exists, and without a window at all', () => {
    expect(hasWebSpeechAPI({})).toBe(false);
    expect(hasWebSpeechAPI(null)).toBe(false);
    expect(hasWebSpeechAPI(undefined)).toBe(false);
  });
});

describe('remembering an unreachable recognition service', () => {
  let storage;
  beforeEach(() => { storage = fakeStorage(); });

  it('starts unblocked, blocks once recorded, and clears on request', () => {
    expect(isSpeechBlocked(storage)).toBe(false);
    rememberBlocked(storage);
    expect(isSpeechBlocked(storage)).toBe(true);
    clearBlocked(storage);
    expect(isSpeechBlocked(storage)).toBe(false);
  });

  it('persists under a stable key, so the verdict survives a reload', () => {
    rememberBlocked(storage);
    expect(storage.getItem(WEB_SPEECH_BLOCKED_KEY)).toBe('1');
  });

  it('survives storage that throws on every access', () => {
    const hostile = hostileStorage();
    expect(() => rememberBlocked(hostile)).not.toThrow();
    expect(() => clearBlocked(hostile)).not.toThrow();
    // Unreadable storage must read as "not blocked": failing closed here would
    // hide the microphone from every private-mode window.
    expect(isSpeechBlocked(hostile)).toBe(false);
  });

  it('reads a missing storage as not blocked', () => {
    expect(isSpeechBlocked(null)).toBe(false);
  });
});

describe('shouldRememberBlock', () => {
  // The discriminator that keeps a plain outage from permanently disabling a
  // microphone that works: only an online device indicts the service.
  it('does not indict the service while the device is offline', () => {
    expect(shouldRememberBlock({ navigator: { onLine: false } })).toBe(false);
  });

  it('records the block when the device is online', () => {
    expect(shouldRememberBlock({ navigator: { onLine: true } })).toBe(true);
  });

  it('records the block when the browser reports nothing', () => {
    expect(shouldRememberBlock({ navigator: {} })).toBe(true);
    expect(shouldRememberBlock({})).toBe(true);
    expect(shouldRememberBlock(null)).toBe(true);
  });
});

describe('webSpeechUsable', () => {
  it('needs the interface AND no recorded failure', () => {
    const w = { SpeechRecognition: class {} };
    const storage = fakeStorage();
    expect(webSpeechUsable(w, storage)).toBe(true);

    rememberBlocked(storage);
    expect(webSpeechUsable(w, storage)).toBe(false);

    clearBlocked(storage);
    expect(webSpeechUsable(w, storage)).toBe(true);
  });

  it('is false without the interface, blocked or not', () => {
    expect(webSpeechUsable({}, fakeStorage())).toBe(false);
  });
});
