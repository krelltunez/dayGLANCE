import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeAction, DEFAULT_DESKTOP_SETTINGS, hasTray, HIDDEN_ARG, launchedHidden, loadDesktopSettings, loginItemSettings,
  parseDesktopSettings, quitOnMainWindowClose, saveDesktopSettings, supportsBackgroundSettings,
} from './backgroundMode';

const dirs: string[] = [];
const temp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dayglance-bg-')); dirs.push(d); return d; };
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('closing the main window', () => {
  it('hides on macOS whatever the setting, as it always did', () => {
    expect(closeAction({ platform: 'darwin', isQuitting: false, keepRunning: false })).toBe('hide');
    expect(closeAction({ platform: 'darwin', isQuitting: false, keepRunning: true })).toBe('hide');
  });
  it('on Windows hides with keep-running on, closes with it off', () => {
    expect(closeAction({ platform: 'win32', isQuitting: false, keepRunning: true })).toBe('hide');
    expect(closeAction({ platform: 'win32', isQuitting: false, keepRunning: false })).toBe('close');
  });
  it('on Linux, with no tray to come back from, always closes', () => {
    expect(closeAction({ platform: 'linux', isQuitting: false, keepRunning: true })).toBe('close');
  });
  it('always closes while quitting', () => {
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      expect(closeAction({ platform, isQuitting: true, keepRunning: true })).toBe('close');
    }
  });
});

describe('a real close on Windows', () => {
  it('quits from the close handler, since the hidden popup keeps window-all-closed from firing', () => {
    expect(quitOnMainWindowClose({ platform: 'win32', isQuitting: false, trayPresent: true })).toBe(true);
  });
  it('leaves an app already quitting, macOS, and Linux (window-all-closed) alone', () => {
    expect(quitOnMainWindowClose({ platform: 'win32', isQuitting: true, trayPresent: true })).toBe(false);
    expect(quitOnMainWindowClose({ platform: 'win32', isQuitting: false, trayPresent: false })).toBe(false);
    expect(quitOnMainWindowClose({ platform: 'darwin', isQuitting: false, trayPresent: true })).toBe(false);
    expect(quitOnMainWindowClose({ platform: 'linux', isQuitting: false, trayPresent: false })).toBe(false);
  });
});

describe('platforms', () => {
  it('macOS and Windows get the tray; only Windows shows the background settings', () => {
    expect(hasTray('darwin')).toBe(true);
    expect(hasTray('win32')).toBe(true);
    expect(hasTray('linux')).toBe(false);
    expect(supportsBackgroundSettings('win32')).toBe(true);
    expect(supportsBackgroundSettings('darwin')).toBe(false);
    expect(supportsBackgroundSettings('linux')).toBe(false);
  });
});

describe('open at login', () => {
  it('registers with --hidden, so a login start stays in the tray', () => {
    expect(loginItemSettings(true)).toEqual({ openAtLogin: true, args: [HIDDEN_ARG] });
    expect(loginItemSettings(false)).toEqual({ openAtLogin: false, args: [HIDDEN_ARG] });
  });
  it('a --hidden launch is a background start on Windows only', () => {
    expect(launchedHidden('win32', ['dayGLANCE.exe', HIDDEN_ARG])).toBe(true);
    expect(launchedHidden('win32', ['dayGLANCE.exe'])).toBe(false);
    expect(launchedHidden('darwin', ['dayGLANCE', HIDDEN_ARG])).toBe(false);
    expect(launchedHidden('linux', ['dayglance', HIDDEN_ARG])).toBe(false);
  });
});

describe('the settings file', () => {
  it('defaults to keep running on and open at login off', () => {
    expect(DEFAULT_DESKTOP_SETTINGS).toEqual({ keepRunning: true, openAtLogin: false, backgroundNoticeShown: false });
    expect(loadDesktopSettings(temp())).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });
  it('round-trips, and a malformed field falls back to its default', () => {
    const d = temp();
    const saved = { keepRunning: false, openAtLogin: true, backgroundNoticeShown: true };
    saveDesktopSettings(d, saved);
    expect(loadDesktopSettings(d)).toEqual(saved);
    expect(parseDesktopSettings({ keepRunning: 'no', openAtLogin: true })).toEqual({ ...DEFAULT_DESKTOP_SETTINGS, openAtLogin: true });
    expect(parseDesktopSettings(null)).toEqual(DEFAULT_DESKTOP_SETTINGS);
    fs.writeFileSync(path.join(d, 'desktop-settings.json'), '{not json');
    expect(loadDesktopSettings(d)).toEqual(DEFAULT_DESKTOP_SETTINGS);
  });
});
