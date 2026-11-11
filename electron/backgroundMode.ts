// Background mode and open at login on Windows, ported from lastGLANCE's
// electron/backgroundMode.ts. The decisions are pure functions here, tested
// without Electron; main.ts applies them.
//
//  - macOS: closing the window hides it, as Mac apps do, whatever the setting
//    (unchanged from before the port).
//  - Windows: with "Keep running in the background" on (the default, since
//    reminders and the tray popup depend on a live main renderer), closing
//    hides the window to the tray, and the first time a notification says
//    dayGLANCE is still running. With it off, closing quits, as it always did.
//  - Linux: no tray (AppIndicator delivers no reliable clicks, and dayGLANCE
//    has no menu-only tray there), so closing quits, as it always did. Hiding
//    the window with nothing to bring it back would strand the process.
//  - "Open at login" (Windows only for now) is off by default and goes through
//    app.setLoginItemSettings with `--hidden`, so a login start sits in the
//    tray instead of putting the window in the user's face.
//
// The settings live in userData/desktop-settings.json, best-effort: a missing
// or corrupt file means the defaults.

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomicSync } from './atomicWrite.js';

export const DESKTOP_SETTINGS_FILE = 'desktop-settings.json';
export const HIDDEN_ARG = '--hidden';

export interface DesktopSettings {
  /** Windows: closing hides to the tray. Ignored on macOS and Linux. */
  keepRunning: boolean;
  /** Windows: start (hidden, in the tray) when the user signs in. */
  openAtLogin: boolean;
  /** The "still running" notice has been shown once. */
  backgroundNoticeShown: boolean;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  keepRunning: true, openAtLogin: false, backgroundNoticeShown: false,
};

/** The platforms with a tray icon and popup. */
export function hasTray(platform: NodeJS.Platform): boolean {
  return platform === 'darwin' || platform === 'win32';
}

/** The platforms whose Settings show the background options. */
export function supportsBackgroundSettings(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

export function parseDesktopSettings(raw: unknown): DesktopSettings {
  const s = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const bool = (key: keyof DesktopSettings) =>
    (typeof s[key] === 'boolean' ? s[key] as boolean : DEFAULT_DESKTOP_SETTINGS[key]);
  return {
    keepRunning: bool('keepRunning'),
    openAtLogin: bool('openAtLogin'),
    backgroundNoticeShown: bool('backgroundNoticeShown'),
  };
}

export function loadDesktopSettings(userData: string): DesktopSettings {
  try {
    return parseDesktopSettings(JSON.parse(fs.readFileSync(path.join(userData, DESKTOP_SETTINGS_FILE), 'utf-8')));
  } catch {
    return { ...DEFAULT_DESKTOP_SETTINGS };
  }
}

export function saveDesktopSettings(userData: string, settings: DesktopSettings): void {
  try {
    writeFileAtomicSync(path.join(userData, DESKTOP_SETTINGS_FILE), JSON.stringify(settings));
  } catch { /* best-effort: this session still follows it */ }
}

/** What closing the main window does. */
export function closeAction(o: { platform: NodeJS.Platform; isQuitting: boolean; keepRunning: boolean }): 'hide' | 'close' {
  if (o.isQuitting) return 'close';
  if (o.platform === 'darwin') return 'hide';
  if (o.platform === 'win32') return o.keepRunning ? 'hide' : 'close';
  return 'close';
}

/**
 * Whether a main window that really closed (not hidden) must quit the app
 * itself. On Windows the hidden tray popup is a second window, so
 * window-all-closed never fires when the main window closes; without this the
 * process would linger with a tray icon after the user chose "closing quits".
 */
export function quitOnMainWindowClose(o: { platform: NodeJS.Platform; isQuitting: boolean; trayPresent: boolean }): boolean {
  return o.platform === 'win32' && !o.isQuitting && o.trayPresent;
}

/** Whether this launch should stay in the background (an open-at-login start on Windows). */
export function launchedHidden(platform: NodeJS.Platform, argv: readonly string[]): boolean {
  return platform === 'win32' && argv.includes(HIDDEN_ARG);
}

/** The login item settings for open at login (Windows). */
export function loginItemSettings(enabled: boolean): { openAtLogin: boolean; args: string[] } {
  return { openAtLogin: enabled, args: [HIDDEN_ARG] };
}
