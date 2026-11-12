// The Windows tray icon is committed output of scripts/gen-tray-icons.mjs and
// ships through win.extraResources. Neither failing breaks a build: a missing
// file only shows as main.ts falling back to the shrunk app icon, the faint
// smear the drawn mark replaced. These pin the files, their sizes, the .ico
// directory, and the packaging entry.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { WINDOWS_TRAY_SCALES } from './trayPopup';
// @ts-expect-error: a plain .mjs script, no declarations
import { icoFromPngs, TRAY_SIZES, trayMarkSvg } from '../scripts/gen-tray-icons.mjs';

const require = createRequire(import.meta.url);
const dir = path.join(__dirname, 'resources', 'tray');

function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function icoEntries(buf: Buffer): { size: number; bytes: number; offset: number }[] {
  expect(buf.readUInt16LE(2)).toBe(1);
  const count = buf.readUInt16LE(4);
  return Array.from({ length: count }, (_, i) => {
    const e = 6 + i * 16;
    return { size: buf.readUInt8(e) || 256, bytes: buf.readUInt32LE(e + 8), offset: buf.readUInt32LE(e + 12) };
  });
}

describe('the Windows tray icon files', () => {
  it('the scales main.ts loads are the sizes the generator draws', () => {
    expect(WINDOWS_TRAY_SCALES.map(([, px]) => px)).toEqual(TRAY_SIZES);
    for (const [scale, px] of WINDOWS_TRAY_SCALES) expect(px).toBe(Math.round(16 * scale));
  });

  it.each(WINDOWS_TRAY_SCALES.map(([, px]) => px))('tray-%ipx.png is that size', (px) => {
    expect(pngSize(fs.readFileSync(path.join(dir, `tray-${px}.png`)))).toEqual({ width: px, height: px });
  });

  it('tray.ico holds each PNG, byte for byte, so Windows can pick the exact size', () => {
    const ico = fs.readFileSync(path.join(dir, 'tray.ico'));
    const entries = icoEntries(ico);
    expect(entries.map((e) => e.size)).toEqual(TRAY_SIZES);
    for (const e of entries) {
      const png = ico.subarray(e.offset, e.offset + e.bytes);
      expect(png.equals(fs.readFileSync(path.join(dir, `tray-${e.size}.png`)))).toBe(true);
    }
  });
});

describe('the generator', () => {
  it('writes a well-formed .ico directory', () => {
    const a = Buffer.from('aaaa'), b = Buffer.from('bbbbbb');
    const ico = icoFromPngs([{ size: 16, png: a }, { size: 256, png: b }]);
    expect(icoEntries(ico)).toEqual([
      { size: 16, bytes: 4, offset: 6 + 32 },
      { size: 256, bytes: 6, offset: 6 + 32 + 4 },
    ]);
    expect(ico.subarray(38).toString()).toBe('aaaabbbbbb');
  });

  it('draws each size on its own canvas, edge to edge', () => {
    for (const px of TRAY_SIZES) {
      const svg: string = trayMarkSvg(px);
      expect(svg).toContain(`width="${px}" height="${px}" viewBox="0 0 ${px} ${px}"`);
    }
  });
});

describe('packaging', () => {
  it('the Windows build ships the tray folder outside the asar', () => {
    delete require.cache[require.resolve('../electron-builder.config.cjs')];
    const config = require('../electron-builder.config.cjs');
    expect(config.win.extraResources).toContainEqual({ from: 'electron/resources/tray', to: 'tray' });
  });
});
