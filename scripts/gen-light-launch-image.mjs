#!/usr/bin/env node
// The LIGHT-appearance launch image: LaunchImage with the "day" of the
// wordmark in the colour the app itself draws it on a light surface.
//
// The launch image is the calendar mark and the wordmark on transparency, over
// LaunchBackground. Its "day" is near-white (#E5E7EB, Tailwind gray-200, what
// src/components/Wordmark.jsx uses in dark mode), which disappears on the light
// LaunchBackground. Wordmark.jsx draws "day" in stone-600 (#57534E) on light
// surfaces, so the light image is the same image with exactly those pixels
// recoloured. Every other byte is kept: each pixel's alpha, and the orange,
// down to the faintest antialiased edge. That is why this reads and writes the
// PNG itself (node:zlib) rather than going through a canvas, whose
// premultiplied alpha rounds the colour of nearly transparent pixels.
//
// The existing images stay as the dark-appearance variant.
//
//   node scripts/gen-light-launch-image.mjs
//
// Writes launch-*-light.png beside each launch-*.png in LaunchImage.imageset.
// Commit the output. src/iosLaunchScreen.test.js holds the two to each other.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

// Wordmark.jsx: text-stone-600 for "day" on a light surface.
export const LIGHT_DAY = [0x57, 0x53, 0x4e];
// A pixel of the "day" wordmark: neutral, light. The orange never is.
export const isDayPixel = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) < 40 && r > 150;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 8-bit RGBA, non-interlaced PNG to raw pixels. Anything else is refused. */
function readPng(buf) {
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  if (ihdr[8] !== 8 || ihdr[9] !== 6 || ihdr[12] !== 0) {
    throw new Error(`expected 8-bit RGBA, not interlaced (depth ${ihdr[8]}, colour type ${ihdr[9]}, interlace ${ihdr[12]})`);
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

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Raw 8-bit RGBA pixels to a PNG. */
function writePng({ width, height, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dayglance-ios/DayGlance/Assets.xcassets/LaunchImage.imageset');
const sources = fs.readdirSync(dir).filter((f) => /^launch-.*\.png$/.test(f) && !f.endsWith('-light.png'));

for (const file of sources) {
  const image = readPng(fs.readFileSync(path.join(dir, file)));
  let recoloured = 0;
  for (let i = 0; i < image.px.length; i += 4) {
    if (image.px[i + 3] > 0 && isDayPixel(image.px[i], image.px[i + 1], image.px[i + 2])) {
      image.px[i] = LIGHT_DAY[0];
      image.px[i + 1] = LIGHT_DAY[1];
      image.px[i + 2] = LIGHT_DAY[2];
      recoloured++;
    }
  }
  const target = file.replace(/\.png$/, '-light.png');
  fs.writeFileSync(path.join(dir, target), writePng(image));
  console.log(`${file} -> ${target} (${recoloured} pixels recoloured)`);
}
