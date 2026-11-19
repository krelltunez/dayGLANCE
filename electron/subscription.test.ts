// Billing results reach the window that is on screen. The package behind
// subscription.ts sends each purchase and restore result to the window it was
// given; handed a window, it keeps the first one for the life of the process,
// and a window recreated after a renderer crash then shows a paywall whose
// spinner never clears although the purchase completed. So it is handed a
// getter.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const H = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock('@glance-apps/billing/electron-main', () => ({ registerElectronBilling: H.register }));

const root = path.resolve(__dirname, '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf-8');

describe('desktop billing registration', () => {
  it('hands the package the getter it was given, with dayGLANCE\'s App Store setup', async () => {
    const { registerSubscriptionHandlers } = await import('./subscription');
    const first = { id: 1 };
    const second = { id: 2 };
    let current: unknown = first;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerSubscriptionHandlers((() => current) as any);

    expect(H.register).toHaveBeenCalledTimes(1);
    const [source, options] = H.register.mock.calls[0];
    // A function, resolved when a result is sent: the window of that moment.
    expect(typeof source).toBe('function');
    expect(source()).toBe(first);
    current = second;
    expect(source()).toBe(second);
    expect(options).toMatchObject({
      entitlementId: 'pro',
      products: { yearly: 'com.dayglance.pro.yearly', lifetime: 'com.dayglance.pro.lifetime' },
    });
    expect(options.rcApiKey).toMatch(/^appl_/);
  });

  it('main registers billing once, with the current main window', () => {
    const main = read('electron/main.ts');
    const calls = [...main.matchAll(/^.*registerSubscriptionHandlers\(.*$/gm)].map((m) => m[0].trim());
    expect(calls).toEqual(['registerSubscriptionHandlers(() => live(mainWindow));']);
  });

  it('uses a billing package that resolves the window on every push', () => {
    // 0.2.3 is the first version that accepts a getter. An older one would call
    // isDestroyed() on the function and throw on every result.
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@glance-apps/billing']).toBe('0.2.3');
    const installed = JSON.parse(read('node_modules/@glance-apps/billing/package.json'));
    expect(installed.version).toBe('0.2.3');
    expect(read('node_modules/@glance-apps/billing/dist/electron-main/index.js')).toContain("typeof window === 'function'");
  });
});
