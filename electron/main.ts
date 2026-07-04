import { app, BrowserWindow, shell, ipcMain, net, protocol, Tray, Menu, nativeImage, globalShortcut, session, screen } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import dns from 'node:dns';
import nodeNet from 'node:net';
import { fileURLToPath } from 'node:url';
import { createWsServer } from './ws-server.js';
import { registerSubscriptionHandlers } from './subscription.js';
import { registerCalendarHandlers } from './calendar.js';
import { registerICloudHandlers } from './icloud.js';
import { registerObsidianHandlers } from './obsidian.js';
import { APP_SCHEME, APP_HOST, APP_BASE_URL, resolveAppRequest } from './appProtocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Register the custom app:// scheme as a proper web origin BEFORE app ready.
// standard+secure gives it a real, allowlistable origin (app://dayglance) with a
// secure context (streaming fetch, CSP, service-worker-grade trust) instead of
// the opaque null origin file:// produced. supportFetchAPI/corsEnabled/stream let
// the renderer fetch (incl. text/event-stream SSE) and let the handler stream
// large asset bodies. Must run at module load — registerSchemesAsPrivileged is a
// no-op once the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// Pin userData explicitly to the productName-derived path. Electron's default
// derives from app.getName() (never the bundle ID), and this pin has shipped in
// every Electron build since main.ts was created, so existing users are already
// here. The MAS build's distinct bundle ID (com.dayglance) does not move it either.
app.setPath('userData', path.join(app.getPath('appData'), 'dayGLANCE'));

const DEV = !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let trayWindow: BrowserWindow | null = null;
let trayNeedsReload = false;
let trayReloadTimer: ReturnType<typeof setTimeout> | null = null;
let registeredHotkey: string | null = null;
let registeredMainWindowHotkey: string | null = null;

// Tray menu bar title: focus countdown takes priority over the reminder dot.
let trayIndicatorOn = false;
let trayFocusTitle = '';
function refreshTrayTitle() {
  tray?.setTitle(trayFocusTitle || (trayIndicatorOn ? '●' : ''));
}

// Safe accessor — returns null if the window has been destroyed so callers
// never have to scatter isDestroyed() checks throughout the file.
function live(win: BrowserWindow | null): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

// Only open http/https URLs in the system browser — prevents javascript:,
// file:, custom-protocol, and other potentially dangerous scheme abuse.
function openExternalSafe(url: string): void {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') shell.openExternal(url);
  } catch { /* malformed URL — ignore */ }
}

// The app's own built renderer directory — the root the app:// handler serves
// from, and the only files renderer navigations may reach.
const APP_DIST_DIR = path.join(__dirname, '../dist');

// True if the navigation target is the app itself: the Vite dev server in dev, or
// the app's own custom-scheme origin (app://dayglance, any path/query/hash — the
// tray uses ?tray=1) in production. Used to block renderer-initiated navigations
// to external origins (defense-in-depth against XSS). Production no longer loads
// via file://, so that branch is gone; the app:// origin is the trusted one.
function isSameAppOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (DEV && parsed.origin === new URL(VITE_DEV_SERVER_URL).origin) return true;
    if (parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST) return true;
    return false;
  } catch { return false; }
}

// ── Window state persistence ─────────────────────────────────────────────────
interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean; }

function winStatePath() { return path.join(app.getPath('userData'), 'window-state.json'); }

function loadWindowState(): WindowState {
  try {
    const data = JSON.parse(fs.readFileSync(winStatePath(), 'utf-8')) as WindowState;
    if (typeof data.width === 'number' && typeof data.height === 'number') return data;
  } catch { /* first launch or corrupt file — use defaults */ }
  return { width: 1280, height: 800, maximized: false };
}

function saveWindowState(state: WindowState): void {
  try { fs.writeFileSync(winStatePath(), JSON.stringify(state)); } catch { /* ignore */ }
}

function createWindow(): BrowserWindow {
  const saved = loadWindowState();

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : {}),
    show: false,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 8 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Track the last non-maximized bounds so we can restore them correctly.
  let normalBounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  const trackBounds = () => {
    const win = live(mainWindow);
    if (win && !win.isMaximized() && !win.isMinimized()) normalBounds = win.getBounds();
  };
  mainWindow.on('resize', trackBounds);
  mainWindow.on('move', trackBounds);
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      event.preventDefault();
      live(mainWindow)?.hide();
      return;
    }
    saveWindowState({ ...normalBounds, maximized: live(mainWindow)?.isMaximized() ?? false });
  });

  if (saved.maximized) mainWindow.maximize();

  // Show the window only after the renderer has painted its first frame,
  // preventing the white screen that appears when the window is shown before
  // React has had a chance to render anything.
  mainWindow.once('ready-to-show', () => { live(mainWindow)?.show(); });

  if (DEV) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadURL(APP_BASE_URL);
  }

  // Open external links in the system browser (https/http only).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  // Prevent the renderer from navigating away from the app origin.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isSameAppOrigin(url)) event.preventDefault();
  });

  return mainWindow;
}

function createTrayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (DEV) {
    win.loadURL(`${VITE_DEV_SERVER_URL}?tray=1`);
  } else {
    win.loadURL(`${APP_BASE_URL}?tray=1`);
  }

  // After every (re)load, re-push cached reminders once React has mounted and
  // registered its onReminders listener. 800ms is enough for the renderer to
  // finish hydrating; focus state self-corrects within 1s so no re-push needed.
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => { pushRemindersToTray(); pushCurrentTaskToTray(); }, 800);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isSameAppOrigin(url)) event.preventDefault();
  });

  // Hide when the user clicks outside the popup; reload if state changed while it was open
  win.on('blur', () => {
    if (win.isDestroyed()) return;
    win.hide();
    if (trayNeedsReload) {
      trayNeedsReload = false;
      win.webContents.reload();
    }
  });

  return win;
}

// Position the tray popup under the menu-bar icon. When the icon's bounds are
// unavailable/zero — which happens if the menu-bar item failed to render, e.g. an
// icon that didn't load — fall back to the TOP-RIGHT of the primary display's work
// area (under the menu bar, where the tray lives) instead of the (0,0) top-left
// corner the raw arithmetic would otherwise produce.
function positionTrayPopup(tw: BrowserWindow, iconBounds?: Electron.Rectangle): void {
  const { width: popW } = tw.getBounds();
  if (iconBounds && iconBounds.width > 0) {
    tw.setPosition(
      Math.round(iconBounds.x - popW / 2 + iconBounds.width / 2),
      Math.round(iconBounds.y + iconBounds.height),
    );
    return;
  }
  const wa = screen.getPrimaryDisplay().workArea;
  tw.setPosition(Math.round(wa.x + wa.width - popW - 8), Math.round(wa.y + 8));
}

function createTray(): void {
  // Downsample the high-res app icon to 44×44 px, then tell Electron it's a
  // @2x image so macOS renders it at 22 logical points — the standard menu bar
  // icon size. setTemplateImage makes it white on dark bars, dark on light bars.
  const srcPath = DEV
    ? path.join(process.cwd(), 'public/icon-512.png')
    : path.join(__dirname, '../dist/icon-512.png');
  const rawIcon = nativeImage.createFromPath(srcPath);
  if (rawIcon.isEmpty()) console.error('[tray] menu-bar icon failed to load from', srcPath);
  const iconBuf = rawIcon.resize({ width: 44, height: 44 }).toPNG();
  let icon = nativeImage.createFromBuffer(iconBuf, { scaleFactor: 2 });
  if (icon.isEmpty()) icon = rawIcon; // fall back to the un-resized image
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('dayGLANCE');
  trayWindow = createTrayWindow();

  // Left-click: toggle the Glance popup; clear any pending reminder indicator.
  tray.on('click', (_event, bounds) => {
    const tw = live(trayWindow);
    if (!tw) return;
    if (tw.isVisible()) { tw.hide(); return; }
    positionTrayPopup(tw, bounds);
    trayIndicatorOn = false;
    refreshTrayTitle();
    tw.show();
    tw.focus();
    pushRemindersToTray();
    pushCurrentTaskToTray();
  });

  // Right-click: native Open / Quit menu
  tray.on('right-click', () => {
    tray?.popUpContextMenu(Menu.buildFromTemplate([
      { label: 'Open dayGLANCE', click: () => { live(mainWindow)?.show(); live(mainWindow)?.focus(); } },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  });
}

// Allowed HTTP methods for the proxy — covers CalDAV/WebDAV needs.
const PROXY_ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'PROPFIND', 'MKCOL', 'REPORT', 'OPTIONS']);

// True for an IP address (v4 or v6 literal, no brackets) that is loopback,
// private (RFC1918), link-local, CGNAT, or otherwise reserved. Shared by the
// literal-host path and the DNS-resolution path so both block the same ranges.
function isPrivateOrReservedIp(ip: string): boolean {
  const h = ip.toLowerCase();

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0 ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }

  return (
    h === '::1' || h === '::' ||
    /^::ffff:/i.test(h) || /^fe80:/i.test(h) ||
    /^fc/i.test(h)      || /^fd/i.test(h)
  );
}

// Block private/loopback/link-local addresses to prevent SSRF. For an IP-literal
// host the range check runs directly; for a hostname we resolve EVERY A/AAAA
// record via DNS and reject if any resolves internally — closing the bypass where
// a public hostname (or a redirect target) points at 127.0.0.1 / an RFC1918 host.
async function validateProxyUrl(urlString: string): Promise<void> {
  let parsed: URL;
  try { parsed = new URL(urlString); } catch { throw new Error('Invalid URL'); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }

  const h = parsed.hostname.toLowerCase();

  if (h === 'localhost' || h === '0.0.0.0') throw new Error('Private/reserved address');

  // URL keeps the brackets on IPv6 literals (e.g. "[::1]"); strip them so the
  // literal check and net.isIP see the bare address.
  const bare = h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;

  if (nodeNet.isIP(bare)) {
    if (isPrivateOrReservedIp(bare)) throw new Error('Private/reserved address');
    return;
  }

  // Hostname — resolve and reject if ANY resolved address is internal.
  let addresses: { address: string }[];
  try {
    addresses = await dns.promises.lookup(bare, { all: true });
  } catch {
    throw new Error('DNS resolution failed');
  }
  for (const { address } of addresses) {
    if (isPrivateOrReservedIp(address)) throw new Error('Private/reserved address');
  }
}

// Proxy outbound HTTP requests from the renderer (via IPC, origin-independent) so
// WebDAV/CalDAV/vault sync reach servers that don't send CORS headers for the
// renderer origin. Invoked through ipcRenderer.invoke('proxy-fetch'), so it is
// unaffected by the file:// → app:// origin switch — it never reads the origin.
// (Vault SSE does NOT use this path: the proxy buffers the whole body via
// response.text() below, which can't stream text/event-stream; SSE uses a direct
// renderer fetch from the app:// origin instead.)
ipcMain.handle('proxy-fetch', async (_event, method: string, url: string, headers: Record<string, string>, body: string | null) => {
  const upperMethod = (method ?? '').toUpperCase();
  if (!PROXY_ALLOWED_METHODS.has(upperMethod)) {
    return { status: 400, ok: false, statusText: 'Bad Request', body: 'Method not allowed' };
  }
  try { await validateProxyUrl(url); } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid URL';
    return { status: 400, ok: false, statusText: 'Bad Request', body: msg };
  }
  // 30-second hard timeout — net.fetch has no built-in timeout, so a slow or
  // unresponsive WebDAV server (e.g. a home server that went offline) would
  // hold the cloudSyncInProgressRef lock indefinitely, silently blocking every
  // subsequent 60-second poll until the app is force-quit and restarted.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);
  try {
    // net.fetch follows redirects itself, but would NOT re-run validateProxyUrl
    // on the redirect target — a public URL could 302 to http://127.0.0.1/… and
    // bypass the SSRF guard. So follow manually, re-validating every hop.
    const MAX_REDIRECTS = 5;
    let currentUrl = url;
    let currentMethod = upperMethod;
    let currentBody = body;
    let response: Awaited<ReturnType<typeof net.fetch>>;
    for (let hop = 0; ; hop++) {
      response = await net.fetch(currentUrl, {
        method: currentMethod,
        headers,
        redirect: 'manual',
        signal: controller.signal,
        ...(currentBody != null ? { body: currentBody } : {}),
      });
      // Not a 3xx, or a 3xx without a Location — this is the final response.
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!location) break;
      if (hop >= MAX_REDIRECTS) {
        return { status: 0, ok: false, statusText: 'Too many redirects', body: '', headers: { etag: null } };
      }
      const nextUrl = new URL(location, currentUrl).toString();
      await validateProxyUrl(nextUrl); // re-validate the redirect target (throws → caught below)
      // Mirror fetch's method-rewrite semantics: 303 always, and 301/302 on POST,
      // switch to a bodyless GET; other redirects preserve method and body.
      if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
        currentMethod = 'GET';
        currentBody = null;
      }
      currentUrl = nextUrl;
    }
    const text = await response.text();
    return { status: response.status, ok: response.ok, statusText: response.statusText, body: text, headers: { etag: response.headers.get('etag') || null } };
  } catch (e: unknown) {
    const isAbort = e instanceof Error && e.name === 'AbortError';
    const msg = isAbort ? 'Sync request timed out (server did not respond within 30 s)' : (e instanceof Error ? e.message : 'Network error');
    return { status: 0, ok: false, statusText: msg, body: '', headers: { etag: null } };
  } finally {
    clearTimeout(timeoutId);
  }
});

// Dock badge — macOS only
ipcMain.on('set-badge-count', (_event, count: number) => {
  if (process.platform === 'darwin') app.setBadgeCount(count);
});

// Tray popup requests the main window to show and navigate to a specific location.
ipcMain.on('tray:open-main', (_event, payload: unknown) => {
  live(trayWindow)?.hide();
  const mw = live(mainWindow);
  if (mw) { mw.show(); mw.focus(); mw.webContents.send('tray:navigate', payload); }
});

// Tray sends background mutations (e.g. toggle-complete) to the main window without showing it.
ipcMain.on('tray:background-action', (_event, payload: unknown) => {
  live(mainWindow)?.webContents.send('tray:background-action', payload);
});

// Reminder indicator: show/clear the dot next to the tray icon.
ipcMain.on('tray:set-indicator', (_event, on: boolean) => {
  trayIndicatorOn = on;
  refreshTrayTitle();
});

// Last-known reminder list — re-sent to the tray popup after a reload or on show,
// so reminders aren't lost when the tray reloads in the background.
let lastKnownReminders: unknown = [];

function pushRemindersToTray() {
  if (Array.isArray(lastKnownReminders) && lastKnownReminders.length > 0) {
    live(trayWindow)?.webContents.send('tray:reminders', lastKnownReminders);
  }
}

// Last-known in-progress task — re-sent to the tray popup after a reload or on show.
let lastKnownCurrentTask: unknown = null;

function pushCurrentTaskToTray() {
  live(trayWindow)?.webContents.send('tray:current-task', lastKnownCurrentTask);
}

// Reminder list: cache + forward to tray popup whenever it changes.
ipcMain.on('tray:push-reminders', (_event, reminders: unknown) => {
  lastKnownReminders = reminders;
  live(trayWindow)?.webContents.send('tray:reminders', reminders);
});

// Current task: cache + forward to tray popup whenever it changes.
ipcMain.on('tray:push-current-task', (_event, task: unknown) => {
  lastKnownCurrentTask = task;
  live(trayWindow)?.webContents.send('tray:current-task', task);
});

// Focus state: update menu bar countdown and forward to tray popup.
ipcMain.on('tray:push-focus-state', (_event, state: { active: boolean; secondsRemaining: number }) => {
  if (state.active) {
    const m = Math.floor(state.secondsRemaining / 60);
    const s = state.secondsRemaining % 60;
    trayFocusTitle = `${m}:${s.toString().padStart(2, '0')}`;
  } else {
    trayFocusTitle = '';
  }
  refreshTrayTitle();
  live(trayWindow)?.webContents.send('tray:focus-state', state);
});

// Global hotkey: show tray popup and focus quick-add input.
ipcMain.handle('hotkey:register', (_event, accelerator: string) => {
  if (registeredHotkey) {
    try { globalShortcut.unregister(registeredHotkey); } catch { /* ignore */ }
    registeredHotkey = null;
  }
  if (!accelerator) return true;
  const ok = globalShortcut.register(accelerator, () => {
    const tw = live(trayWindow);
    if (!tw) return;
    if (tw.isVisible()) { tw.hide(); return; }
    positionTrayPopup(tw, tray?.getBounds());
    trayIndicatorOn = false;
    refreshTrayTitle();
    tw.show();
    tw.focus();
    pushRemindersToTray();
    pushCurrentTaskToTray();
    tw.webContents.send('tray:focus-quick-add');
  });
  if (ok) registeredHotkey = accelerator;
  return ok;
});

// Global hotkey: show and focus the main app window.
ipcMain.handle('hotkey:register-main-window', (_event, accelerator: string) => {
  if (registeredMainWindowHotkey) {
    try { globalShortcut.unregister(registeredMainWindowHotkey); } catch { /* ignore */ }
    registeredMainWindowHotkey = null;
  }
  if (!accelerator) return true;
  const ok = globalShortcut.register(accelerator, () => {
    const mw = live(mainWindow);
    if (!mw) return;
    if (mw.isMinimized()) mw.restore();
    mw.show();
    mw.focus();
  });
  if (ok) registeredMainWindowHotkey = accelerator;
  return ok;
});

// Keep tray popup in sync: reload it in the background whenever state changes
ipcMain.on('ws:push-state', (event) => {
  const tw = live(trayWindow);
  if (!tw) return;
  if (event.sender === tw.webContents) return;
  if (tw.isVisible()) {
    trayNeedsReload = true;
  } else {
    if (trayReloadTimer) clearTimeout(trayReloadTimer);
    trayReloadTimer = setTimeout(() => {
      trayReloadTimer = null;
      live(trayWindow)?.webContents.reload();
    }, 500);
  }
});

// Native macOS "About dayGLANCE" panel. macOS builds it from the bundle's
// Info.plist, but setAboutPanelOptions lets us override the copyright and add
// contact/website lines via the credits field (rendered below the copyright).
// applicationName/version are left to Info.plist so they stay in sync with the
// build (CFBundleShortVersionString + CFBundleVersion).
app.setAboutPanelOptions({
  copyright: 'Copyright © 2026 GLANCE Apps',
  credits: 'Support: support@glance-apps.com\nWeb: https://www.glance-apps.com/',
});

// Single-instance lock: only one dayGLANCE process may run at a time. A second
// launch would race for the fixed 7892 WebSocket port and the window-state file,
// so if we can't get the lock another instance already owns it — quit, and let
// that primary instance surface its window via the 'second-instance' handler.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const mw = live(mainWindow);
    if (mw) {
      if (mw.isMinimized()) mw.restore();
      if (!mw.isVisible()) mw.show();
      mw.focus();
    } else {
      // No live main window (tray-only after the window was closed) — recreate it.
      createWindow();
    }
  });
}

// One-time origin storage migration (file:// → app://dayglance).
//
// Browser storage is PARTITIONED BY ORIGIN. Switching the renderer from file:// to
// app:// gave the app a fresh, empty localStorage bucket, orphaning every existing
// user's data under the old file:// origin (it booted empty and rehydrated from
// iCloud — effective local data loss). This copies the old file:// localStorage
// into the app:// bucket ONCE, before the main window loads, so existing users keep
// their data after the switch. Conflict rule: file:// wins (the user's original
// local data is authoritative), applied a single time and then flagged done.
//
// IndexedDB is deliberately NOT migrated: it holds only origin-bound, generally
// non-extractable CryptoKeys (which cannot be moved across origins by any means and
// are re-derived from the sync passphrase on the next sync) plus minor caches
// (durable intents outbox, Obsidian dir handle). So after migration a user may see
// a one-time passphrase prompt to re-cache sync keys — expected, not data loss.
const STORAGE_MIGRATION_FLAG = '.origin-migrated-file-to-app-v1';

// Read a whole origin's localStorage as a plain object, robustly (index iteration
// avoids Storage-method name collisions). Runs in the page's main world.
const READ_LOCALSTORAGE_JS =
  'JSON.stringify((function(){var o={};for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);o[k]=localStorage.getItem(k);}return o;})())';

async function migrateFileToAppStorage(): Promise<void> {
  const flagPath = path.join(app.getPath('userData'), STORAGE_MIGRATION_FLAG);
  if (fs.existsSync(flagPath)) return;

  const bridgePath = path.join(APP_DIST_DIR, 'storage-bridge.html');
  if (!fs.existsSync(bridgePath)) return; // build without the bridge — skip safely

  const mkHidden = () => new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  try {
    // 1) READ the old file:// localStorage from a blank file:// document. All
    //    file:// documents share one localStorage bucket, so this sees exactly what
    //    the old file://…/index.html build wrote — without booting the app.
    const reader = mkHidden();
    let dump = '{}';
    try {
      await reader.loadFile(bridgePath); // file:// origin
      dump = await reader.webContents.executeJavaScript(READ_LOCALSTORAGE_JS);
    } finally {
      if (!reader.isDestroyed()) reader.destroy();
    }

    let fileData: Record<string, string> = {};
    try { fileData = JSON.parse(dump) || {}; } catch { fileData = {}; }
    const keys = Object.keys(fileData);
    if (keys.length === 0) {
      // Nothing under file:// (fresh install / already-migrated machine) — flag done.
      fs.writeFileSync(flagPath, new Date().toISOString());
      return;
    }

    // 2) WRITE into the app:// localStorage (file:// wins on conflict; app://-only
    //    keys are left intact). Same session as the main window, so the writes are
    //    visible to it immediately.
    const writer = mkHidden();
    try {
      await writer.loadURL(APP_BASE_URL + 'storage-bridge.html'); // app://dayglance origin
      await writer.webContents.executeJavaScript(
        `(function(){var d=${JSON.stringify(fileData)};for(var k in d){localStorage.setItem(k,d[k]);}return true;})()`,
      );
    } finally {
      if (!writer.isDestroyed()) writer.destroy();
    }

    fs.writeFileSync(flagPath, new Date().toISOString());
    console.info(`[migrate] copied ${keys.length} localStorage keys file:// → app://dayglance`);
  } catch (err) {
    // Never block startup, and do NOT flag done on failure — retry next launch.
    console.error('[migrate] file:// → app:// storage migration failed:', err);
  }
}

app.whenReady().then(async () => {
  // A doomed second instance may still reach 'ready' before app.quit() takes
  // effect; bail before creating any windows so it never steals the port/state.
  if (!gotSingleInstanceLock) return;

  // Content Security Policy — applied to every response the renderer loads.
  // script-src 'self': only scripts from the app bundle (no inline scripts, no eval).
  //   Under app://, 'self' is the app://dayglance origin (was the null file:// origin).
  // style-src 'self' 'unsafe-inline': Tailwind generates inline styles at runtime.
  // connect-src 'self' https:: allows XHR/fetch/SSE to any https origin — the vault
  //   (/sync, /intents, /events SSE, /salt, /blobs) on its direct renderer fetch,
  //   plus AI APIs and CalDAV. (WebDAV/CalDAV/vault sync still go via the IPC proxy,
  //   which is not subject to CSP; only vault SSE needs the direct-fetch allowance.)
  //   Note: an http (non-TLS) vault would be blocked here — the vault must be https.
  // img-src 'self' data: blob:: covers favicons, base64 images, and blob URLs.
  // object-src / base-uri 'none': closes classic plugin and base-tag injection vectors.
  const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https:",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });

  // Serve the built renderer from the custom app:// origin. Maps app://dayglance/…
  // requests to files in dist/ (with SPA fallback to index.html for client
  // routes), replacing the old file:// load. Custom-scheme responses do not pass
  // through onHeadersReceived, so the CSP is set on the document response here too
  // (belt-and-braces alongside the <meta> CSP baked into index.html). The IPC
  // proxy (proxy-fetch) is untouched by this — it never depended on the origin.
  protocol.handle(APP_SCHEME, async (request) => {
    const isFile = (p: string): boolean => {
      try { return fs.statSync(p).isFile(); } catch { return false; }
    };
    const resolved = resolveAppRequest(APP_DIST_DIR, request.url, isFile);
    if (resolved.status !== 200 || !resolved.filePath) {
      return new Response(resolved.status === 403 ? 'Forbidden' : 'Not found', {
        status: resolved.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    try {
      const data = await fs.promises.readFile(resolved.filePath);
      const headers: Record<string, string> = { 'Content-Type': resolved.contentType || 'application/octet-stream' };
      // Only the HTML document needs the CSP header; assets inherit nothing from it.
      if (resolved.contentType?.startsWith('text/html')) headers['Content-Security-Policy'] = CSP;
      return new Response(data, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  });

  // Recover data stranded under the old file:// origin BEFORE the app loads, so it
  // boots with the migrated localStorage. The protocol handler above must already
  // be registered (the writer window loads app://). Awaited so createWindow() sees
  // the migrated data; failures are swallowed inside and never block startup.
  await migrateFileToAppStorage();

  const win = createWindow();
  createWsServer(() => live(mainWindow));
  registerSubscriptionHandlers(win);
  registerCalendarHandlers();
  registerICloudHandlers(() => live(mainWindow));
  registerObsidianHandlers();
  if (process.platform === 'darwin') createTray();

  app.on('activate', () => {
    const mw = live(mainWindow);
    if (mw) { if (!mw.isVisible()) mw.show(); mw.focus(); } else createWindow();
  });
});

app.on('before-quit', () => { isQuitting = true; });

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // On macOS the app stays alive in the tray; the user can reopen from there or the dock.
  if (process.platform !== 'darwin') app.quit();
});
