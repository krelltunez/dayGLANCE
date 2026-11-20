import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Cold open, from the launch screen to the app's first frame. CI cannot launch
// the app, so this holds the pieces to each other:
//
//   launch screen (UILaunchScreen: LaunchBackground + LaunchImage, light and
//   dark)  →  what shows behind the transparent web view until the page paints
//   (ContentView's background)  →  the app shell's own background
//
// The middle step was the window's systemBackground, white in light mode: the
// white flash between the dark launch screen and the app.

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const ASSETS = 'dayglance-ios/DayGlance/Assets.xcassets';

// Just enough PNG to read the launch images: 8-bit RGBA, not interlaced.
function decodePng(file) {
  const buf = fs.readFileSync(path.join(root, file));
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[12]], `${file}: 8-bit RGBA, not interlaced`).toEqual([8, 6, 0]);
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? px[y * stride + x - 4] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? px[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      px[y * stride + x] = (line[x] + pred) & 0xff;
    }
  }
  return { width, height, px };
}

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');

function launchBackground() {
  const json = JSON.parse(read(`${ASSETS}/LaunchBackground.colorset/Contents.json`));
  const toHex = (c) => hex(['red', 'green', 'blue'].map((k) => Number(c.components[k])));
  const any = json.colors.filter((c) => !c.appearances);
  const dark = json.colors.filter((c) => c.appearances?.some((a) => a.value === 'dark'));
  expect(any).toHaveLength(1);
  expect(dark).toHaveLength(1);
  return { light: toHex(any[0].color), dark: toHex(dark[0].color) };
}

describe('cold open: launch screen → behind the web view → app shell', () => {
  it('draws the launch colour behind the transparent web view', () => {
    const swift = read('dayglance-ios/DayGlance/ContentView.swift').replace(/\/\/.*$/gm, '');
    expect(swift).toMatch(/WebView\(\)\s*\.ignoresSafeArea\(\)\s*\.background\(Color\("LaunchBackground"\)\.ignoresSafeArea\(\)\)/);
    // It only shows because the web view is transparent until the page paints.
    const webView = read('dayglance-ios/DayGlance/WebView/WebView.swift');
    expect(webView).toContain('webView.isOpaque = false');
    expect(webView).toContain('webView.backgroundColor = .clear');
  });

  it('the launch screen is LaunchBackground and LaunchImage', () => {
    const yml = read('dayglance-ios/project.yml');
    expect(yml).toMatch(/UILaunchScreen:\s*\n\s*UIColorName: "LaunchBackground"\s*\n\s*UIImageName: "LaunchImage"/);
  });

  it("LaunchBackground is the app shell's light background in light mode, and slate-900 in dark", () => {
    const { light, dark } = launchBackground();
    // App.jsx: bgClass = darkMode ? 'bg-gray-900' : 'bg-stone-100', the app shell.
    expect(read('src/App.jsx')).toMatch(/const bgClass = darkMode \? 'bg-gray-900' : 'bg-stone-100';/);
    expect(light).toBe('#F5F5F4'); // Tailwind stone-100
    expect(dark).toBe('#0F172A');
  });

  describe('LaunchImage follows the appearance', () => {
    const json = JSON.parse(read(`${ASSETS}/LaunchImage.imageset/Contents.json`));
    const withFile = json.images.filter((e) => e.filename);
    const lightFiles = withFile.filter((e) => !e.appearances).map((e) => e.filename);
    const darkFiles = withFile.filter((e) => e.appearances?.some((a) => a.value === 'dark')).map((e) => e.filename);

    it('the default (light) images are the -light ones; dark uses the originals', () => {
      expect(lightFiles.length).toBeGreaterThan(0);
      expect(lightFiles.every((f) => f.endsWith('-light.png'))).toBe(true);
      expect(darkFiles.map((f) => f.replace(/\.png$/, '-light.png')).sort()).toEqual([...lightFiles].sort());
    });

    // Wordmark.jsx draws "day" gray-200 in dark mode and stone-600 in light.
    const DARK_DAY = [0xe5, 0xe7, 0xeb];
    const LIGHT_DAY = [0x57, 0x53, 0x4e];
    it('Wordmark.jsx is where those two colours come from', () => {
      expect(read('src/components/Wordmark.jsx')).toContain("darkMode ? 'text-gray-200' : 'text-stone-600'");
    });

    it.each(darkFiles)('%s and its light twin: same shape, orange untouched, only "day" recoloured', (darkFile) => {
      const dark = decodePng(`${ASSETS}/LaunchImage.imageset/${darkFile}`);
      const light = decodePng(`${ASSETS}/LaunchImage.imageset/${darkFile.replace(/\.png$/, '-light.png')}`);
      expect([light.width, light.height]).toEqual([dark.width, dark.height]);
      // Plain loops that count, asserted once at the end: an expect() per pixel
      // is over a million calls for the iPad image, and took the test past
      // vitest's 5 s limit on CI.
      const isNeutralLight = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 40 && r > 150;
      let recoloured = 0;
      let lightGreyLeft = 0;
      const mismatches = { alpha: 0, day: 0, other: 0 };
      let first = null;
      const counts = new Map(); // the dark images' opaque "day" colours
      let solidDay = 0;
      for (let i = 0; i < dark.px.length; i += 4) {
        const [dr, dg, db, da] = [dark.px[i], dark.px[i + 1], dark.px[i + 2], dark.px[i + 3]];
        const [lr, lg, lb, la] = [light.px[i], light.px[i + 1], light.px[i + 2], light.px[i + 3]];
        if (la !== da) { // alpha: identical everywhere
          mismatches.alpha++;
          first ??= `alpha at byte ${i}: ${la} vs ${da}`;
        }
        if (da === 0) continue;
        if (isNeutralLight(dr, dg, db)) {
          recoloured++;
          if (lr !== LIGHT_DAY[0] || lg !== LIGHT_DAY[1] || lb !== LIGHT_DAY[2]) {
            mismatches.day++;
            first ??= `"day" at byte ${i}: ${hex([lr, lg, lb])}, expected ${hex(LIGHT_DAY)}`;
          }
        } else if (lr !== dr || lg !== dg || lb !== db) {
          mismatches.other++;
          first ??= `untouched pixel at byte ${i}: ${hex([lr, lg, lb])} vs ${hex([dr, dg, db])}`;
        }
        if (isNeutralLight(lr, lg, lb)) lightGreyLeft++;
        if (da === 255 && Math.max(dr, dg, db) - Math.min(dr, dg, db) < 40) {
          const c = hex([dr, dg, db]);
          counts.set(c, (counts.get(c) ?? 0) + 1);
          solidDay++;
        }
      }
      expect(mismatches, first ?? 'no mismatch').toEqual({ alpha: 0, day: 0, other: 0 });
      // The wordmark's "day" was really there, and none of it is left light on
      // the light background.
      expect(recoloured).toBeGreaterThan(100);
      expect(lightGreyLeft).toBe(0);
      // The dark images' opaque "day" is gray-200 (with a few near-white
      // neighbours from the original rendering): Wordmark.jsx's dark colour.
      const [top, topCount] = [...counts].sort((a, b) => b[1] - a[1])[0];
      expect(top).toBe(hex(DARK_DAY));
      expect(topCount / solidDay).toBeGreaterThan(0.8);
    });
  });
});
