import { app, BrowserWindow, shell, ipcMain, net } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWsServer } from './ws-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pin userData explicitly — the implicit default derives from productName,
// so a rename or build-config drift would silently orphan existing user data.
app.setPath('userData', path.join(app.getPath('appData'), 'dayGLANCE'));

const DEV = !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
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
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
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

app.whenReady().then(() => {
  const win = createWindow();
  createWsServer(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
