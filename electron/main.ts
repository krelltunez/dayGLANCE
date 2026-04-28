import { app, BrowserWindow, shell, ipcMain, net, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
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
let trayWindow: BrowserWindow | null = null;
let trayNeedsReload = false;
let trayReloadTimer: ReturnType<typeof setTimeout> | null = null;

// Safe accessor — returns null if the window has been destroyed so callers
// never have to scatter isDestroyed() checks throughout the file.
function live(win: BrowserWindow | null): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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

  if (DEV) {
    mainWindow.loadURL(VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
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
  const iconPath = DEV
    ? path.join(process.cwd(), 'public/icon-16x16.png')
    : path.join(__dirname, '../dist/icon-16x16.png');

  const icon = nativeImage.createFromPath(iconPath);
  icon.setTemplateImage(true); // auto-adapts to light/dark menu bar (white on dark)
  tray = new Tray(icon);
  tray.setToolTip('dayGLANCE');
  trayWindow = createTrayWindow();

  // Left-click: toggle the Glance popup
  tray.on('click', (_event, bounds) => {
    const tw = live(trayWindow);
    if (!tw) return;
    if (tw.isVisible()) { tw.hide(); return; }
    const { x, y, width: iconW, height: iconH } = bounds;
    const { width: popW } = tw.getBounds();
    tw.setPosition(Math.round(x - popW / 2 + iconW / 2), Math.round(y + iconH));
    tw.show();
    tw.focus();
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

// Proxy outbound HTTP requests from the renderer so they aren't subject to
// Chromium's CORS restrictions when the app is loaded from file://.
ipcMain.handle('proxy-fetch', async (_event, method: string, url: string, headers: Record<string, string>, body: string | null) => {
  const response = await net.fetch(url, {
    method,
    headers,
    ...(body != null ? { body } : {}),
  });
  const text = await response.text();
  return { status: response.status, ok: response.ok, statusText: response.statusText, body: text };
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
  const win = createWindow();
  createWsServer(win);
  if (process.platform === 'darwin') createTray();

  app.on('activate', () => {
    const mw = live(mainWindow);
    if (mw) { mw.show(); mw.focus(); } else createWindow();
  });
});

app.on('window-all-closed', () => {
  // On macOS the app stays alive in the tray; the user can reopen from there or the dock.
  if (process.platform !== 'darwin') app.quit();
});
