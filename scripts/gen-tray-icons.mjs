#!/usr/bin/env node
// The Windows tray icon, drawn for the notification area rather than shrunk
// from the app icon.
//
// public/icon-512.png is thin orange strokes on transparency, with the art
// sitting high in the frame. Resized to the tray's 16px those strokes fall
// below a pixel and smear into a faint, off-centre outline. This mark is the
// same calendar-and-fan, redrawn as a filled silhouette on a 16-unit grid:
// the orange body edge to edge, the rings above it, and the header rule, the
// dot and the three rays cut in dark ink. At 16px every edge lands on a pixel
// boundary; the larger sizes scale the grid, with the ink weight rounded to a
// whole or half pixel and the header rule snapped to the pixel grid.
//
// Writes electron/resources/tray/:
//   tray-16.png … tray-48.png  one per Windows display scale (100% … 300%)
//   tray.ico                   the same images as PNG entries, which is what
//                              Windows' own icon loading picks a size from
//
// main.ts (trayImage) loads tray.ico on Windows and falls back to the PNGs.
// macOS keeps its template image, built from the app icon at runtime.
//
// Renders with Chromium through Playwright, which is not a declared
// dependency (as scripts/gen-readme-screenshots.mjs):
//
//   npm i playwright --no-save        # unless it is already installed
//   node scripts/gen-tray-icons.mjs
//
// Commit the output.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'electron/resources/tray')

export const TRAY_SIZES = [16, 20, 24, 32, 40, 48]
const ORANGE = '#FF8C00' // the app icon's orange
const INK = '#2A1500'

export function trayMarkSvg(N) {
  const s = N / 16
  const u = (n) => +(n * s).toFixed(3)
  const px = (n) => Math.round(n * s)
  const lw = N <= 16 ? 1 : N <= 20 ? 1.25 : N <= 24 ? 1.5 : Math.round(s * 2) / 2
  const cy = u(10.5), x0 = u(4.5), x1 = u(13.5), up = u(7.5), dn = u(13.5)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${N}" height="${N}" viewBox="0 0 ${N} ${N}">
  <rect x="0" y="${px(2)}" width="${N}" height="${N - px(2)}" rx="${u(2.5)}" fill="${ORANGE}"/>
  <rect x="${px(3)}" y="0" width="${px(2)}" height="${px(4)}" rx="${u(1)}" fill="${ORANGE}"/>
  <rect x="${px(11)}" y="0" width="${px(2)}" height="${px(4)}" rx="${u(1)}" fill="${ORANGE}"/>
  <rect x="0" y="${px(5)}" width="${N}" height="${Math.max(1, px(1))}" fill="${INK}"/>
  <g fill="none" stroke="${INK}" stroke-width="${lw}">
    <path d="M${x0} ${cy}C${u(8)} ${cy} ${u(9)} ${up} ${x1} ${up}"/>
    <path d="M${x0} ${cy}H${x1}"/>
    <path d="M${x0} ${cy}C${u(8)} ${cy} ${u(9)} ${dn} ${x1} ${dn}"/>
  </g>
  <circle cx="${x0}" cy="${cy}" r="${u(1.75)}" fill="${INK}"/>
</svg>`
}

/** An .ico holding each PNG as is (Vista and later read PNG entries). */
export function icoFromPngs(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, png }, i) => {
    const e = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, e)
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1)
    dir.writeUInt8(0, e + 2) // palette
    dir.writeUInt8(0, e + 3) // reserved
    dir.writeUInt16LE(1, e + 4) // planes
    dir.writeUInt16LE(32, e + 6) // bits per pixel
    dir.writeUInt32LE(png.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += png.length
  })
  return Buffer.concat([header, dir, ...images.map((i) => i.png)])
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { chromium } = createRequire(import.meta.url)('playwright')
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  const images = []
  for (const size of TRAY_SIZES) {
    await page.setContent(`<html><body style="margin:0">${trayMarkSvg(size)}</body></html>`)
    const png = await page.locator('svg').screenshot({ omitBackground: true })
    fs.writeFileSync(path.join(outDir, `tray-${size}.png`), png)
    images.push({ size, png })
  }
  await browser.close()
  fs.writeFileSync(path.join(outDir, 'tray.ico'), icoFromPngs(images))
  console.log(`wrote ${path.relative(root, outDir)}/tray-{${TRAY_SIZES.join(',')}}.png and tray.ico`)
}
