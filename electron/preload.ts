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

  // Show or clear the reminder dot (●) next to the tray icon.
  setTrayIndicator: (on: boolean) => ipcRenderer.send('tray:set-indicator', on),

  // Main window pushes live focus state to main process (every second when active).
  pushFocusState: (state: unknown) => ipcRenderer.send('tray:push-focus-state', state),

  // Tray popup receives live focus state forwarded from the main window.
  onFocusState: (callback: (state: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('tray:focus-state', handler);
    return () => ipcRenderer.removeListener('tray:focus-state', handler);
  },

  // Main window pushes active reminders to the tray popup whenever they change.
  pushReminders: (reminders: unknown) => ipcRenderer.send('tray:push-reminders', reminders),

  // Tray popup receives the active reminder list forwarded from the main window.
  onReminders: (callback: (reminders: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, reminders: unknown) => callback(reminders);
    ipcRenderer.on('tray:reminders', handler);
    return () => ipcRenderer.removeListener('tray:reminders', handler);
  },

  // Main window pushes the currently-in-progress task to the tray popup.
  pushCurrentTask: (task: unknown) => ipcRenderer.send('tray:push-current-task', task),

  // Tray popup receives the currently-in-progress task forwarded from the main window.
  onCurrentTask: (callback: (task: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, task: unknown) => callback(task);
    ipcRenderer.on('tray:current-task', handler);
    return () => ipcRenderer.removeListener('tray:current-task', handler);
  },

  // Registers (or clears) a system-wide hotkey that shows the tray popup.
  // Pass an empty string to unregister. Returns true if registration succeeded.
  setGlobalHotkey: (accelerator: string) => ipcRenderer.invoke('hotkey:register', accelerator),

  // Registers (or clears) a system-wide hotkey that shows the main app window.
  setMainWindowHotkey: (accelerator: string) => ipcRenderer.invoke('hotkey:register-main-window', accelerator),

  // Tray popup listens for the signal to focus the quick-add input.
  onFocusQuickAdd: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('tray:focus-quick-add', handler);
    return () => ipcRenderer.removeListener('tray:focus-quick-add', handler);
  },
});
