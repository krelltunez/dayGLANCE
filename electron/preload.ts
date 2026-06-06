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

  // Subscriptions — StoreKit 2 via inAppPurchase + RevenueCat entitlement checks.
  // macOS only; always returns { active: false } on non-macOS platforms.
  subscriptionStatus: (): Promise<{ active: boolean; productId: string | null }> =>
    ipcRenderer.invoke('subscription:status'),
  subscriptionPurchase: (productId: string): Promise<void> =>
    ipcRenderer.invoke('subscription:purchase', productId),
  subscriptionRestore: (): Promise<void> =>
    ipcRenderer.invoke('subscription:restore'),
  onSubscriptionEvent: (callback: (event: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: unknown) => callback(event);
    ipcRenderer.on('subscription:event', handler);
    return () => ipcRenderer.removeListener('subscription:event', handler);
  },
  onSubscriptionPricesReady: (callback: (prices: { yearly: string | null; lifetime: string | null }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, prices: { yearly: string | null; lifetime: string | null }) => callback(prices);
    ipcRenderer.on('subscription:prices-ready', handler);
    return () => ipcRenderer.removeListener('subscription:prices-ready', handler);
  },

  // iCloud sync — reads/writes dayglance-sync.json in the shared ubiquitous container.
  // macOS only; returns null/false on other platforms.
  readICloud: (): Promise<string | null> => ipcRenderer.invoke('icloud:read'),
  writeICloud: (json: string): Promise<boolean> => ipcRenderer.invoke('icloud:write', json),
  onICloudChanged: (callback: (json: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, json: string) => callback(json);
    ipcRenderer.on('icloud:changed', handler);
    return () => ipcRenderer.removeListener('icloud:changed', handler);
  },

  // iCloud file operations — intents and multi-user sync (supplemental to WebDAV)
  listICloudFiles: (relativePath: string): Promise<string[]> =>
    ipcRenderer.invoke('icloud:list-files', relativePath),
  readICloudFile: (relativePath: string): Promise<string | null> =>
    ipcRenderer.invoke('icloud:read-file', relativePath),
  writeICloudFile: (relativePath: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke('icloud:write-file', relativePath, content),
  deleteICloudFile: (relativePath: string): Promise<boolean> =>
    ipcRenderer.invoke('icloud:delete-file', relativePath),
  makeICloudDir: (relativePath: string): Promise<boolean> =>
    ipcRenderer.invoke('icloud:make-dir', relativePath),

  // Tray popup listens for the signal to focus the quick-add input.
  onFocusQuickAdd: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('tray:focus-quick-add', handler);
    return () => ipcRenderer.removeListener('tray:focus-quick-add', handler);
  },
});
