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

  // Hide when the user clicks outside the popup
  win.on('blur', () => win.hide());

  return win;
}

function createTray(): void {
  const iconPath = DEV
    ? path.join(process.cwd(), 'public/icon-16x16.png')
    : path.join(__dirname, '../dist/icon-16x16.png');

  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip('dayGLANCE');

  trayWindow = createTrayWindow();

  // Left-click: toggle the Glance popup
  tray.on('click', (_event, bounds) => {
    if (!trayWindow) return;
    if (trayWindow.isVisible()) {
      trayWindow.hide();
      return;
    }
    // Position popup below the tray icon, horizontally centred on it
    const { x, y, width: iconW, height: iconH } = bounds;
    const { width: popW } = trayWindow.getBounds();
    const xPos = Math.round(x - popW / 2 + iconW / 2);
    const yPos = Math.round(y + iconH);
    trayWindow.setPosition(xPos, yPos);
    trayWindow.show();
    trayWindow.focus();
  });

  // Right-click: simple native menu
  tray.on('right-click', () => {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Open dayGLANCE',
        click: () => {
          if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
          else createWindow();
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
    tray?.popUpContextMenu(menu);
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

app.whenReady().then(() => {
  const win = createWindow();
  createWsServer(win);

  // Menu bar tray — macOS only for now
  if (process.platform === 'darwin') createTray();

  app.on('activate', () => {
    // Dock icon clicked: show/restore the main window
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS with the tray active the app stays running in the background;
  // the user can reopen from the tray or dock.
  if (process.platform !== 'darwin') app.quit();
});
