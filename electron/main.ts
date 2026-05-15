import { app, BrowserWindow, shell, ipcMain, net, Tray, Menu, nativeImage, globalShortcut, session } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createWsServer } from './ws-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pin userData explicitly — the implicit default derives from productName,
// so a rename or build-config drift would silently orphan existing user data.
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

// True if the navigation target is the app itself (file:// in production,
// the Vite dev server in dev). Used to block renderer-initiated navigations
// to external origins (defense-in-depth against XSS).
function isSameAppOrigin(url: string): boolean {
  try {
    const { protocol, origin } = new URL(url);
    if (protocol === 'file:') return true;
    if (DEV && origin === new URL(VITE_DEV_SERVER_URL).origin) return true;
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

  if (DEV) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
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
    win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { tray: '1' } });
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

function createTray(): void {
  // Downsample the high-res app icon to 44×44 px, then tell Electron it's a
  // @2x image so macOS renders it at 22 logical points — the standard menu bar
  // icon size. setTemplateImage makes it white on dark bars, dark on light bars.
  const srcPath = DEV
    ? path.join(process.cwd(), 'public/icon-512.png')
    : path.join(__dirname, '../dist/icon-512.png');
  const iconBuf = nativeImage.createFromPath(srcPath).resize({ width: 44, height: 44 }).toPNG();
  const icon = nativeImage.createFromBuffer(iconBuf, { scaleFactor: 2 });
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('dayGLANCE');
  trayWindow = createTrayWindow();

  // Left-click: toggle the Glance popup; clear any pending reminder indicator.
  tray.on('click', (_event, bounds) => {
    const tw = live(trayWindow);
    if (!tw) return;
    if (tw.isVisible()) { tw.hide(); return; }
    const { x, y, width: iconW, height: iconH } = bounds;
    const { width: popW } = tw.getBounds();
    tw.setPosition(Math.round(x - popW / 2 + iconW / 2), Math.round(y + iconH));
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

// Block private/loopback/link-local addresses to prevent SSRF.
function validateProxyUrl(urlString: string): void {
  let parsed: URL;
  try { parsed = new URL(urlString); } catch { throw new Error('Invalid URL'); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }

  const h = parsed.hostname.toLowerCase();

  if (h === 'localhost' || h === '0.0.0.0') throw new Error('Private/reserved address');

  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0 ||
      (a === 100 && b >= 64 && b <= 127)
    ) throw new Error('Private/reserved address');
  }

  if (
    h === '::1' || h === '::' ||
    /^::ffff:/i.test(h) || /^fe80:/i.test(h) ||
    /^fc/i.test(h)      || /^fd/i.test(h)
  ) throw new Error('Private/reserved address');
}

// iCloud sync file — shared with the iOS app via the ubiquitous container.
// The path matches NSFileManager url(forUbiquityContainerIdentifier:) on macOS.
// ICLOUD_CONTAINER_ID must match the iOS app's entitlement
// (com.apple.developer.icloud-container-identifiers: iCloud.com.dayglance).
// Update both here and in the iOS entitlement file if the bundle ID changes.
const ICLOUD_CONTAINER_ID = 'iCloud~com~dayglance';
const ICLOUD_SYNC_PATH = path.join(
  app.getPath('home'),
  `Library/Mobile Documents/${ICLOUD_CONTAINER_ID}/Documents/dayglance-sync.json`
);

ipcMain.handle('icloud:read', () => {
  if (process.platform !== 'darwin') return null;
  try {
    const dir = path.dirname(ICLOUD_SYNC_PATH);
    const base = path.basename(ICLOUD_SYNC_PATH);
    // iCloud daemon stores cloud-only files as hidden .filename.icloud placeholders.
    // Detect this case and tell JS to wait rather than treating it as "no remote file".
    if (!fs.existsSync(ICLOUD_SYNC_PATH)) {
      if (fs.existsSync(path.join(dir, '.' + base + '.icloud'))) {
        return JSON.stringify({ downloading: true });
      }
      return null;
    }
    return fs.readFileSync(ICLOUD_SYNC_PATH, 'utf-8');
  } catch (e: unknown) {
    // Return a structured error so the renderer can distinguish "iCloud not
    // available / not signed in" from "no remote file yet" (null).
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ error: msg });
  }
});

// Track our own writes so the fs.watch callback can ignore them.
let lastMacOSWriteTime = 0;
// 2s suppression: enough to absorb iCloud daemon's self-echo round-trip
// without blocking legitimate remote writes. The 1s fs.watch debounce sits
// inside this window, so the effective minimum gap between a local write and
// a recognized remote write is 2s.
const ICLOUD_WRITE_SUPPRESSION_MS = 2000;

ipcMain.handle('icloud:write', (_event, json: string) => {
  if (process.platform !== 'darwin') return false;
  try {
    const dir = path.dirname(ICLOUD_SYNC_PATH);
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write: write to a temp file then rename so the iCloud daemon never
    // picks up a partially-written file.
    const tmp = ICLOUD_SYNC_PATH + '.tmp';
    fs.writeFileSync(tmp, json, { encoding: 'utf-8' });
    fs.renameSync(tmp, ICLOUD_SYNC_PATH);
    lastMacOSWriteTime = Date.now();
    return true;
  } catch { return false; }
});

// Watch the iCloud container directory for changes written by the iOS app.
// Sends 'icloud:changed' to the renderer so it can run a sync cycle immediately
// instead of waiting for the 15-second poll.
function startICloudWatch(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return;
  const dir = path.dirname(ICLOUD_SYNC_PATH);
  const file = path.basename(ICLOUD_SYNC_PATH);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  let debounce: ReturnType<typeof setTimeout> | null = null;

  // Re-attachable watcher: iCloud daemon can recreate the directory (e.g. on
  // Sonoma+), which kills the watcher silently. Re-attach on error or close.
  const attach = () => {
    try {
      const watcher = fs.watch(dir, (_eventType, filename) => {
        if (filename !== file) return;
        if (Date.now() - lastMacOSWriteTime < ICLOUD_WRITE_SUPPRESSION_MS) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          try {
            if (!fs.existsSync(ICLOUD_SYNC_PATH)) return;
            const content = fs.readFileSync(ICLOUD_SYNC_PATH, 'utf-8');
            live(win)?.webContents.send('icloud:changed', content);
          } catch {}
        }, 1000);
      });
      watcher.on('error', () => setTimeout(attach, 5000));
      watcher.on('close', () => setTimeout(attach, 5000));
    } catch {
      setTimeout(attach, 5000);
    }
  };

  attach();
}

// Proxy outbound HTTP requests from the renderer so they aren't subject to
// Chromium's CORS restrictions when the app is loaded from file://.
ipcMain.handle('proxy-fetch', async (_event, method: string, url: string, headers: Record<string, string>, body: string | null) => {
  const upperMethod = (method ?? '').toUpperCase();
  if (!PROXY_ALLOWED_METHODS.has(upperMethod)) {
    return { status: 400, ok: false, statusText: 'Bad Request', body: 'Method not allowed' };
  }
  try { validateProxyUrl(url); } catch (e: unknown) {
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
    const response = await net.fetch(url, {
      method: upperMethod,
      headers,
      signal: controller.signal,
      ...(body != null ? { body } : {}),
    });
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
    const bounds = tray?.getBounds();
    if (bounds) {
      const { x, y, width: iconW, height: iconH } = bounds;
      const { width: popW } = tw.getBounds();
      tw.setPosition(Math.round(x - popW / 2 + iconW / 2), Math.round(y + iconH));
    }
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

app.whenReady().then(() => {
  // Content Security Policy — applied to every response the renderer loads.
  // script-src 'self': only scripts from the app bundle (no inline scripts, no eval).
  // style-src 'self' 'unsafe-inline': Tailwind generates inline styles at runtime.
  // connect-src 'self' https:: allows XHR/fetch to any https origin (AI APIs, CalDAV, etc.).
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

  const win = createWindow();
  createWsServer(() => live(mainWindow));
  if (process.platform === 'darwin') { createTray(); startICloudWatch(win); }

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
