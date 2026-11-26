// #2446: the AUMID the app sets, the appId the installer stamps on shortcuts,
// and the installer's re-stamp on upgrade have to agree, or one app shows as
// two taskbar buttons.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { shouldSetAppUserModelId, WINDOWS_APP_USER_MODEL_ID } from './windowsAppId.js';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');

function loadConfig() {
  const saved = process.env.DAYGLANCE_APP_ID;
  delete process.env.DAYGLANCE_APP_ID;
  try {
    delete require.cache[require.resolve('../electron-builder.config.cjs')];
    return require('../electron-builder.config.cjs');
  } finally {
    if (saved !== undefined) process.env.DAYGLANCE_APP_ID = saved;
  }
}

describe('Windows AppUserModelID', () => {
  it("equals the appId the Windows installer stamps on its shortcuts", () => {
    expect(loadConfig().appId).toBe(WINDOWS_APP_USER_MODEL_ID);
  });

  it('is set on a packaged Windows build only', () => {
    expect(shouldSetAppUserModelId('win32', true)).toBe(true);
    expect(shouldSetAppUserModelId('win32', false)).toBe(false);
    expect(shouldSetAppUserModelId('darwin', true)).toBe(false);
    expect(shouldSetAppUserModelId('linux', true)).toBe(false);
  });

  it('is set in main.ts before the first window is created', () => {
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    const set = main.indexOf('app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)');
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(main.indexOf('new BrowserWindow('));
    expect(set).toBeLessThan(main.indexOf('app.whenReady()'));
  });

  it('the installer re-stamps the shortcuts an upgrade keeps', () => {
    const include = loadConfig().nsis?.include;
    expect(include).toBe('electron/resources/installer.nsh');
    const nsh = fs.readFileSync(path.join(root, include), 'utf8');
    expect(nsh).toContain('!macro customInstall');
    expect(nsh).toMatch(/WinShell::SetLnkAUMI "\$newStartMenuLink" "\$\{APP_ID\}"/);
    expect(nsh).toMatch(/WinShell::SetLnkAUMI "\$newDesktopLink" "\$\{APP_ID\}"/);
  });
});
