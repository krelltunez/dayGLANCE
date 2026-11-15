import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  IOS_LANGUAGE_SEEN_KEY,
  followIOSLanguageChanges,
  setNativeAppLanguage,
  syncAppLanguageFromNative,
} from './nativeAppLocale.js';

const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
const origWindow = hadWindow ? globalThis.window : undefined;

function androidWindow({ supported = true, tag = null } = {}) {
  const native = {
    getAppLocale: vi.fn(() => JSON.stringify({ supported, tag })),
    setAppLocale: vi.fn(),
  };
  globalThis.window = { DayGlanceNative: native };
  return native;
}

function fakeI18n(language) {
  const i18n = {
    language,
    resolvedLanguage: language,
    changeLanguage: vi.fn((lng) => {
      i18n.language = lng;
      i18n.resolvedLanguage = lng;
    }),
  };
  return i18n;
}

describe('nativeAppLocale', () => {
  afterEach(() => {
    if (hadWindow) globalThis.window = origWindow;
    else delete globalThis.window;
  });

  it('adopts the language set in Android at startup', () => {
    androidWindow({ tag: 'pl' });
    const i18n = fakeI18n('en');
    syncAppLanguageFromNative(i18n);
    expect(i18n.changeLanguage).toHaveBeenCalledWith('pl');
  });

  it('maps the tag Android reports onto a shipped language', () => {
    androidWindow({ tag: 'pt' });
    const i18n = fakeI18n('en');
    syncAppLanguageFromNative(i18n);
    expect(i18n.changeLanguage).toHaveBeenCalledWith('pt-PT');
  });

  it('leaves the language alone when the app follows the system', () => {
    androidWindow({ tag: null });
    const i18n = fakeI18n('de');
    syncAppLanguageFromNative(i18n);
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  it('follows a change made in Android Settings while running', () => {
    androidWindow({ tag: null });
    const i18n = fakeI18n('en');
    syncAppLanguageFromNative(i18n);
    globalThis.window.__dayglanceAppLocaleChanged('uk');
    expect(i18n.changeLanguage).toHaveBeenCalledWith('uk');
  });

  it('ignores the echo of its own change', () => {
    androidWindow({ tag: 'fr' });
    const i18n = fakeI18n('fr');
    syncAppLanguageFromNative(i18n);
    globalThis.window.__dayglanceAppLocaleChanged('fr');
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  it('hands an explicit pick to Android', () => {
    const native = androidWindow();
    setNativeAppLanguage('zh-CN');
    expect(native.setAppLocale).toHaveBeenCalledWith('zh-CN');
  });

  it('does nothing below Android 13', () => {
    const native = androidWindow({ supported: false, tag: 'pl' });
    const i18n = fakeI18n('de');
    syncAppLanguageFromNative(i18n);
    setNativeAppLanguage('pl');
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(native.setAppLocale).not.toHaveBeenCalled();
    expect(globalThis.window.__dayglanceAppLocaleChanged).toBeUndefined();
  });

  it('stays inert on iOS, which shares the DayGlanceNative name', () => {
    const native = androidWindow({ tag: 'pl' });
    globalThis.window.DayGlanceIOS = true;
    const i18n = fakeI18n('en');
    syncAppLanguageFromNative(i18n);
    setNativeAppLanguage('pl');
    expect(native.getAppLocale).not.toHaveBeenCalled();
    expect(native.setAppLocale).not.toHaveBeenCalled();
  });

  it('stays inert on the web and Electron', () => {
    globalThis.window = {};
    const i18n = fakeI18n('en');
    expect(() => syncAppLanguageFromNative(i18n)).not.toThrow();
    expect(() => setNativeAppLanguage('pl')).not.toThrow();
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });
});

describe('following iOS language changes', () => {
  const store = (seen) => {
    const m = new Map(seen ? [[IOS_LANGUAGE_SEEN_KEY, seen]] : []);
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), m };
  };

  afterEach(() => {
    if (hadWindow) globalThis.window = origWindow;
    else delete globalThis.window;
  });

  it('adopts a language changed in iOS Settings since the last launch', () => {
    globalThis.window = { DayGlanceIOS: true };
    const i18n = fakeI18n('en');
    followIOSLanguageChanges(i18n, 'pl-PL', store('en-US'));
    expect(i18n.changeLanguage).toHaveBeenCalledWith('pl');
  });

  it('keeps an in-app choice while the iOS language stays the same', () => {
    globalThis.window = { DayGlanceIOS: true };
    const i18n = fakeI18n('uk');
    followIOSLanguageChanges(i18n, 'en-US', store('en-US'));
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });

  it('only records the language on the first launch, so existing choices stand', () => {
    globalThis.window = { DayGlanceIOS: true };
    const i18n = fakeI18n('de');
    const s = store();
    followIOSLanguageChanges(i18n, 'en-US', s);
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
    expect(s.m.get(IOS_LANGUAGE_SEEN_KEY)).toBe('en-US');
  });

  it('maps the iOS tag onto a shipped language', () => {
    globalThis.window = { DayGlanceIOS: true };
    const i18n = fakeI18n('en');
    followIOSLanguageChanges(i18n, 'zh-Hans-CN', store('en-US'));
    expect(i18n.changeLanguage).toHaveBeenCalledWith('zh-CN');
  });

  it('maps a Traditional Chinese iOS tag onto zh-TW', () => {
    globalThis.window = { DayGlanceIOS: true };
    const i18n = fakeI18n('en');
    followIOSLanguageChanges(i18n, 'zh-Hant-TW', store('en-US'));
    expect(i18n.changeLanguage).toHaveBeenCalledWith('zh-TW');
  });

  it('does nothing off iOS, Android included', () => {
    globalThis.window = { DayGlanceNative: {} };
    const i18n = fakeI18n('en');
    followIOSLanguageChanges(i18n, 'pl-PL', store('en-US'));
    expect(i18n.changeLanguage).not.toHaveBeenCalled();
  });
});
