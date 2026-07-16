import { ipcMain, app } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── App Store storefront detection (macOS) ──────────────────────────────────
//
// Reports the storefront country the app is running under so the renderer can
// suppress region-restricted features — specifically generative-AI on the China
// (CN) storefront, per App Store Review Guideline 5 (Deep Synthesis / MIIT).
//
// Two signals, in order of authority:
//   1. StoreKit storefront via the signed Swift helper (dayglance-storefront-helper).
//      This is the correct signal — it's the actual App Store storefront, not the
//      device's region. Emits an ISO 3166-1 alpha-3 code (e.g. "CHN").
//   2. OS region via app.getLocaleCountryCode() (ISO alpha-2, e.g. "CN"), used
//      only when the helper is missing, times out, or returns nothing.
//
// The fallback matters: it is unverified whether StoreKit resolves a storefront
// inside a spawned (non-App-Store) helper process. If the helper returns null,
// the locale fallback still catches a reviewer testing from a CN-configured Mac,
// so the feature is never left visibly active in the China review environment —
// and a null never disables AI worldwide (that would need the locale to be CN too).

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELPER_NAME = 'dayglance-storefront-helper';

function helperPath(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'storefront-helper', HELPER_NAME)]
    : [path.join(__dirname, '..', 'electron', 'native', 'storefront-helper', 'build', HELPER_NAME)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// Spawns the helper and resolves its parsed JSON stdout. A hung StoreKit call is
// bounded by the timeout, after which resolveStorefrontCountry falls back to locale.
function runHelper(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bin = helperPath();
    if (!bin) { reject(new Error('storefront helper not found')); return; }
    execFile(bin, args, { timeout: 10_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) { reject(err); return; }
      try {
        resolve(JSON.parse(stdout.toString().trim() || 'null'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

const norm = (code: string | null | undefined): string => (code || '').toUpperCase();

// Resolves the storefront country as an uppercase ISO code (alpha-2 or alpha-3),
// or '' when unknown. StoreKit's alpha-3 is preferred; locale's alpha-2 is the
// fallback. The renderer treats both "CN" and "CHN" as the China storefront.
async function resolveStorefrontCountry(): Promise<string> {
  if (process.platform === 'darwin') {
    try {
      const res = await runHelper(['country']) as { countryCode?: string | null } | null;
      const sk = norm(res?.countryCode);
      if (sk) return sk;
    } catch {
      // helper missing / errored / timed out — fall through to locale
    }
  }
  try {
    return norm(app.getLocaleCountryCode());
  } catch {
    return '';
  }
}

export function registerStorefrontHandlers(): void {
  ipcMain.handle('storefront:country', async () => {
    try {
      return await resolveStorefrontCountry();
    } catch {
      return '';
    }
  });
}
