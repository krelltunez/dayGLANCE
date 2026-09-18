import { afterEach, expect, it, vi } from 'vitest';
import { canUseJobo, readJoboEnabled, setJoboEnabled, JOBO_ENABLED_KEY } from './preference.js';
afterEach(() => vi.unstubAllGlobals());
it('defaults off without browser storage', () => expect(readJoboEnabled()).toBe(false));
it('requires opt-in, loaded data, single user and main window', () => {
  const ctx = {
      dataLoaded: true,
      isTrayMode: false
    },
    features = {
      multiUserEnabled: false
    };
  expect(canUseJobo(true, ctx, features)).toBe(true);
  expect(canUseJobo(false, ctx, features)).toBe(false);
  expect(canUseJobo(true, {
    ...ctx,
    dataLoaded: false
  }, features)).toBe(false);
  expect(canUseJobo(true, {
    ...ctx,
    isTrayMode: true
  }, features)).toBe(false);
  expect(canUseJobo(true, ctx, {
    multiUserEnabled: true
  })).toBe(false);
});
it('preference persists before change notification', () => {
  const map = new Map(),
    events = [];
  vi.stubGlobal('window', {
    localStorage: {
      getItem: key => map.get(key),
      setItem: (key, value) => map.set(key, value)
    },
    dispatchEvent: e => events.push([e.type, map.get(JOBO_ENABLED_KEY)])
  });
  expect(readJoboEnabled()).toBe(false);
  setJoboEnabled(true);
  expect(readJoboEnabled()).toBe(true);
  expect(events).toEqual([['dayglance-jobo-preference', 'true']]);
});
it('a failed preference save does not notify success', () => {
  const notify = vi.fn();
  vi.stubGlobal('window', {
    localStorage: {
      setItem: () => {
        throw Error('quota');
      }
    },
    dispatchEvent: notify
  });
  expect(() => setJoboEnabled(true)).toThrow('quota');
  expect(notify).not.toHaveBeenCalled();
});
