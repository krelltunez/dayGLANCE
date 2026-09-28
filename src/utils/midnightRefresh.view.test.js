import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { rememberViewsForMidnight, readMidnightViews, clearMidnightViews, MIDNIGHT_VIEW_KEY } from './midnightRefresh.js';

// The nightly reload resets the day, not the user's place: the view on
// screen is handed across it, read once, and ignored when stale, so an
// ordinary reload later still opens the default view.

const memoryStorage = () => {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('the view handed across the nightly reload', () => {
  it('round-trips the desktop and phone views', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    rememberViewsForMidnight({ desktop: 'jobo', mobile: 'sched' }, 1000);
    expect(readMidnightViews(1000 + 60_000)).toEqual({ desktop: 'jobo', mobile: 'sched' });
  });

  // MUTATION: drop the age check and a manual reload hours later reopens
  // the handed view instead of the default.
  it('is ignored once stale, or from the future', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    rememberViewsForMidnight({ desktop: 'jobo', mobile: 'grid' }, 1000);
    expect(readMidnightViews(1000 + 3 * 60_000)).toBeNull();
    expect(readMidnightViews(500)).toBeNull();
  });

  it('is spent once cleared', () => {
    vi.stubGlobal('sessionStorage', memoryStorage());
    rememberViewsForMidnight({ desktop: 'week', mobile: 'list' }, 1000);
    clearMidnightViews();
    expect(readMidnightViews(1000)).toBeNull();
  });

  it('never throws when storage is unavailable or holds junk', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(() => rememberViewsForMidnight({ desktop: 'jobo' })).not.toThrow();
    expect(readMidnightViews()).toBeNull();
    expect(() => clearMidnightViews()).not.toThrow();
    vi.stubGlobal('sessionStorage', { getItem: (k) => (k === MIDNIGHT_VIEW_KEY ? '{not json' : null) });
    expect(readMidnightViews()).toBeNull();
  });
});

describe('App wiring', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');

  it('remembers the views on screen right before the reload', () => {
    expect(app).toMatch(/rememberViewsForMidnight\(viewsOnScreenRef\.current\);\s*window\.location\.reload\(\);/);
  });

  it('both view initialisers prefer the handed view when it is still on, then clear it', () => {
    expect(app).toMatch(/const handed = readMidnightViews\(\)\?\.desktop;\s*if \(handed && allowed\.includes\(handed\)\) return handed;/);
    expect(app).toMatch(/const handed = readMidnightViews\(\)\?\.mobile;\s*return handed && enabledViews\(MOBILE_VIEW_MODES, hiddenViews\.mobile\)\.includes\(handed\)/);
    expect(app).toContain('clearMidnightViews();');
  });
});

describe('the view pickers in Settings wrap', () => {
  it('no view row can run into the next column', () => {
    const modal = readFileSync(new URL('../components/SettingsModal.jsx', import.meta.url), 'utf8');
    const panel = readFileSync(new URL('../components/MobileSettingsPanel.jsx', import.meta.url), 'utf8');
    expect(modal.match(/<div className="flex flex-wrap gap-2">\s*\{enabledViews\(/g)).toHaveLength(3);
    expect(modal).not.toMatch(/<div className="flex gap-2">\s*\{enabledViews\(/);
    expect(panel).toMatch(/<div className="flex flex-wrap gap-2">\s*\{enabledViews\(MOBILE_VIEW_MODES/);
  });
});
