import { describe, expect, it } from 'vitest';
import { MENU_BAR_GLYPH_PT, MENU_BAR_PT, padSquareBitmap } from './trayIcon';

const px = (b: Buffer, size: number, x: number, y: number) => [...b.subarray((y * size + x) * 4, (y * size + x) * 4 + 4)];

describe('the menu bar icon', () => {
  it('draws a 19pt mark in the 22pt menu bar image', () => {
    expect(MENU_BAR_PT).toBe(22);
    expect(MENU_BAR_GLYPH_PT).toBe(19);
  });

  it('centres the mark in a transparent canvas, pixels unchanged', () => {
    // A 2x2 image of distinct opaque pixels, centred in 4x4.
    const src = Uint8Array.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]);
    const out = padSquareBitmap(src, 2, 4);
    expect(out.length).toBe(4 * 4 * 4);
    expect(px(out, 4, 1, 1)).toEqual([1, 2, 3, 255]);
    expect(px(out, 4, 2, 1)).toEqual([4, 5, 6, 255]);
    expect(px(out, 4, 1, 2)).toEqual([7, 8, 9, 255]);
    expect(px(out, 4, 2, 2)).toEqual([10, 11, 12, 255]);
    for (const [x, y] of [[0, 0], [3, 0], [0, 3], [3, 3], [0, 1], [3, 2]]) expect(px(out, 4, x, y)).toEqual([0, 0, 0, 0]);
  });

  it('at 2x, a 38px mark sits 3px in from each edge of the 44px image', () => {
    const size = MENU_BAR_GLYPH_PT * 2, canvas = MENU_BAR_PT * 2;
    const out = padSquareBitmap(new Uint8Array(size * size * 4).fill(255), size, canvas);
    expect(px(out, canvas, 2, 2)[3]).toBe(0);
    expect(px(out, canvas, 3, 3)[3]).toBe(255);
    expect(px(out, canvas, 40, 40)[3]).toBe(255);
    expect(px(out, canvas, 41, 41)[3]).toBe(0);
  });

  it('refuses a bitmap of the wrong size', () => {
    expect(() => padSquareBitmap(new Uint8Array(3), 2, 4)).toThrow();
    expect(() => padSquareBitmap(new Uint8Array(16 * 4), 4, 2)).toThrow();
  });
});
