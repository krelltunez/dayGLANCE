import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,

  // Renderer pushes app state to connected WebSocket clients (e.g. Stream Deck plugin)
  pushState: (state: unknown) => ipcRenderer.send('ws:push-state', state),

  // Renderer subscribes to commands arriving from WebSocket clients
  onCommand: (callback: (command: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, command: unknown) => callback(command);
    ipcRenderer.on('ws:command', handler);
    return () => ipcRenderer.removeListener('ws:command', handler);
  },

  // Main process asks renderer to re-push state (e.g. a plugin client just connected)
  onRequestState: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('ws:request-state', handler);
    return () => ipcRenderer.removeListener('ws:request-state', handler);
  },

  // Routes an HTTP request through the main process so the renderer can reach
  // external servers (WebDAV, CalDAV) without hitting Chromium CORS restrictions.
  proxyFetch: (method: string, url: string, headers: Record<string, string>, body: string | null) =>
    ipcRenderer.invoke('proxy-fetch', method, url, headers, body),

  // Sets the macOS dock badge to the number of incomplete tasks today.
  setBadgeCount: (count: number) => ipcRenderer.send('set-badge-count', count),

  // Tray popup tells the main process to show the main window and navigate to a location.
  openMainAt: (payload: unknown) => ipcRenderer.send('tray:open-main', payload),

  // Main window listens for navigation requests forwarded from the tray popup.
  onTrayNavigate: (callback: (payload: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('tray:navigate', handler);
    return () => ipcRenderer.removeListener('tray:navigate', handler);
  },

  // Tray sends background mutations (e.g. toggle-complete) that run in the
  // main window without bringing it to the foreground.
  backgroundAction: (payload: unknown) => ipcRenderer.send('tray:background-action', payload),
  onBackgroundAction: (callback: (payload: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on('tray:background-action', handler);
    return () => ipcRenderer.removeListener('tray:background-action', handler);
  },

  // Registers (or clears) a system-wide hotkey that shows the tray popup.
  // Pass an empty string to unregister. Returns true if registration succeeded.
  setGlobalHotkey: (accelerator: string) => ipcRenderer.invoke('hotkey:register', accelerator),

  // Tray popup listens for the signal to focus the quick-add input.
  onFocusQuickAdd: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('tray:focus-quick-add', handler);
    return () => ipcRenderer.removeListener('tray:focus-quick-add', handler);
  },
});
