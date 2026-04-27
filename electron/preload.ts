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
});
