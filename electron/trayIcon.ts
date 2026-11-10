// The menu bar icon's size (dayGLANCE's app icon as a template image). The
// image is the menu bar's 22pt height; the visible mark is drawn at 19pt and
// centred in it, so it sits at the size of the system icons around it and
// beside lastGLANCE's 20pt mark rather than filling the bar edge to edge.

/** The menu bar image's height, in points. */
export const MENU_BAR_PT = 22;
/** The visible mark, in points. */
export const MENU_BAR_GLYPH_PT = 19;

/**
 * Centre a square bitmap (`size` px a side, 4 bytes a pixel, as
 * nativeImage.toBitmap() returns) in a transparent square `canvas` px a side.
 * Byte order is kept as given, so it works for BGRA and RGBA alike.
 */
export function padSquareBitmap(src: Uint8Array, size: number, canvas: number): Buffer {
  if (canvas < size) throw new Error(`canvas ${canvas} is smaller than the image ${size}`);
  if (src.length !== size * size * 4) throw new Error(`expected ${size * size * 4} bytes, got ${src.length}`);
  const out = Buffer.alloc(canvas * canvas * 4);
  const offset = Math.floor((canvas - size) / 2);
  for (let row = 0; row < size; row++) {
    const from = row * size * 4;
    const to = ((row + offset) * canvas + offset) * 4;
    out.set(src.subarray(from, from + size * 4), to);
  }
  return out;
}
