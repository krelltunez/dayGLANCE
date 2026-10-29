import { describe, it, expect } from 'vitest';
import { isLandscapeNow } from './useIsLandscape.js';

const win = (innerWidth, innerHeight, extra = {}) => ({ innerWidth, innerHeight, ...extra });
const screenOf = (type) => ({ screen: { orientation: { type } } });

describe('isLandscapeNow (#2258)', () => {
  it('a phone held upright with the keyboard shrinking the page is not landscape', () => {
    // Pixel 9 in a WebView browser: 412 wide, keyboard leaves ~380 of height.
    expect(isLandscapeNow(win(412, 380, screenOf('portrait-primary')))).toBe(false);
  });

  it('a phone turned sideways is landscape', () => {
    expect(isLandscapeNow(win(915, 380, screenOf('landscape-primary')))).toBe(true);
    expect(isLandscapeNow(win(915, 380, screenOf('landscape-secondary')))).toBe(true);
  });

  it('a tall viewport is never landscape, whatever the device reports', () => {
    expect(isLandscapeNow(win(412, 915, screenOf('portrait-primary')))).toBe(false);
    // A tablet in landscape split-screen keeps its narrow-window layout.
    expect(isLandscapeNow(win(600, 800, screenOf('landscape-primary')))).toBe(false);
  });

  it('falls back to window.orientation, then to the viewport', () => {
    expect(isLandscapeNow(win(412, 380, { orientation: 0 }))).toBe(false);
    expect(isLandscapeNow(win(915, 380, { orientation: -90 }))).toBe(true);
    expect(isLandscapeNow(win(915, 380))).toBe(true);
  });
});
