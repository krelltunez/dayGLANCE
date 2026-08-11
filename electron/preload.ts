import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  // True only in the Mac App Store (sandboxed) build. Electron sets process.mas
  // for the `mas` target. Used to suppress behavior App Store review disallows —
  // today that is the GitHub-releases update check (App.jsx) and its update
  // banner (SettingsModal.jsx). NOTE: it does NOT gate Obsidian vault access.
  // ALL Electron builds (dev, Developer ID, MAS) route the vault through the
  // main process; the renderer keys that solely on the presence of
  // window.electronAPI.obsidian, exposed unconditionally below. Only the
  // security-scoped-bookmark half of that path is MAS-specific, and it is
  // handled inside electron/obsidian.ts, not gated here.
  isMAS: process.mas === true,

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
  // Asks the main process to leave native fullscreen (no-op when not fullscreen).
  exitFullscreen: () => ipcRenderer.send('window:exit-fullscreen'),
  // Reports the app's dark-mode choice so the next launch's window backing
  // surface matches the theme instead of flashing white (see main.ts).
  setWindowTheme: (darkMode: boolean) => ipcRenderer.send('window:set-theme', darkMode),

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

  // Main window signals that persisted data changed, so the tray popup can
  // reload its snapshot. Deliberately payload-free and on its OWN channel:
  // ws:push-state is the Stream Deck broadcast and re-fires every 15 s from the
  // clock tick, which would reload the tray four times a minute for nothing.
  notifyDataChanged: () => ipcRenderer.send('tray:data-changed'),

  // MCP read bridge (main window only — the tray never subscribes, see
  // src/hooks/useMcpBridge.js). Main sends correlated requests over
  // 'mcp:request'; the renderer answers on 'mcp:response'. The main-process
  // side additionally drops responses from any webContents other than the
  // main window's (electron/mcpRendererBridge.ts).
  onMcpRequest: (callback: (request: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, request: unknown) => callback(request);
    ipcRenderer.on('mcp:request', handler);
    return () => ipcRenderer.removeListener('mcp:request', handler);
  },
  mcpRespond: (response: unknown) => ipcRenderer.send('mcp:response', response),

  // Local integrations settings (Stream Deck + MCP, spec §6.2/§6.3). The
  // renderer never mutates the config directly: it sends typed transition
  // actions and the main process's consent-state machine accepts or refuses
  // them (electron/localIntegrations.ts).
  localIntegrations: {
    get: (): Promise<unknown> => ipcRenderer.invoke('local-integrations:get'),
    transition: (action: unknown): Promise<unknown> =>
      ipcRenderer.invoke('local-integrations:transition', action),
    // Main pushes a fresh snapshot when listener state changes underneath the
    // UI (e.g. a port collision discovered after the toggle returned).
    onStatus: (callback: (snapshot: unknown) => void) => {
      const handler = (_: Electron.IpcRendererEvent, snapshot: unknown) => callback(snapshot);
      ipcRenderer.on('local-integrations:status', handler);
      return () => ipcRenderer.removeListener('local-integrations:status', handler);
    },
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

  // Tray popup receives its own on-screen visibility from the main process,
  // which owns every show/hide call site. Re-sent after each reload, so the
  // popup knows its current state immediately rather than at the next
  // transition. Used to skip work that is pointless while it is off screen.
  onTrayVisibility: (callback: (visible: boolean) => void) => {
    const handler = (_: Electron.IpcRendererEvent, visible: boolean) => callback(visible);
    ipcRenderer.on('tray:visibility', handler);
    return () => ipcRenderer.removeListener('tray:visibility', handler);
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
  subscriptionPrices: (): Promise<{ yearly: string | null; lifetime: string | null; yearlyTrialDays: number | null }> =>
    ipcRenderer.invoke('subscription:prices'),
  onSubscriptionEvent: (callback: (event: unknown) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: unknown) => callback(event);
    ipcRenderer.on('subscription:event', handler);
    return () => ipcRenderer.removeListener('subscription:event', handler);
  },
  onSubscriptionPricesReady: (callback: (prices: { yearly: string | null; lifetime: string | null; yearlyTrialDays: number | null }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, prices: { yearly: string | null; lifetime: string | null; yearlyTrialDays: number | null }) => callback(prices);
    ipcRenderer.on('subscription:prices-ready', handler);
    return () => ipcRenderer.removeListener('subscription:prices-ready', handler);
  },

  // App Store region signal + the source that produced it:
  //   { country: string, source: 'locale' | 'none' }
  // country is an uppercase ISO code (alpha-2, e.g. "CN"; '' if unknown), read from
  // the OS region (app.getLocaleCountryCode). Used to comply with regional legal
  // requirements — e.g. suppressing generative-AI features on the China storefront
  // (App Store Guideline 5 / MIIT). macOS only; other platforms return
  // { country: '', source: 'none' }.
  getStorefrontCountry: (): Promise<{ country: string; source: 'locale' | 'none' }> =>
    ipcRenderer.invoke('storefront:country'),

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

  // Native calendar (macOS / EventKit) — read-only access to the system Calendar
  // via a signed Swift helper spawned by the main process. Mirrors the mobile
  // bridge's JSON contract so the renderer reuses nativeEventToTask unchanged.
  // All return empty/false on non-macOS platforms.
  requestCalendarAccess: (): Promise<{ granted: boolean }> =>
    ipcRenderer.invoke('calendar:request-access'),
  // The main process caches this list (5 min TTL) so both renderers don't each
  // spawn the helper. `force` bypasses that cache for an explicit user refresh.
  getCalendars: (force?: boolean): Promise<Array<{ id: string; name: string; accountName: string; color: string }>> =>
    ipcRenderer.invoke('calendar:get-calendars', force === true),
  // Returns a per-day map { "YYYY-MM-DD": Event[] } covering [startDate, endDate] inclusive.
  getCalendarEvents: (startDate: string, endDate: string): Promise<Record<string, unknown[]>> =>
    ipcRenderer.invoke('calendar:get-events', startDate, endDate),

  // Tray popup listens for the signal to focus the quick-add input.
  onFocusQuickAdd: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('tray:focus-quick-add', handler);
    return () => ipcRenderer.removeListener('tray:focus-quick-add', handler);
  },

  // Obsidian vault — folder access held by the main process on every desktop
  // platform. On macOS a security-scoped bookmark keeps it alive across
  // relaunch under the App Sandbox; on Windows/Linux a plain persisted path is
  // used and restore verifies it is still reachable. The renderer drives file
  // I/O through the shim in src/obsidianElectronHandle.js.
  obsidian: {
    pick: (): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('obsidian:pick'),
    restore: (): Promise<{ path: string; name: string } | null> => ipcRenderer.invoke('obsidian:restore'),
    disconnect: (): Promise<boolean> => ipcRenderer.invoke('obsidian:disconnect'),
    // Opens a note in the Obsidian app. The main process builds the obsidian://
    // URL from the vault path it holds — the renderer passes only a note name,
    // so the http/https-only external-URL allowlist stays intact.
    openNote: (noteName: string): Promise<boolean> =>
      ipcRenderer.invoke('obsidian:open-note', noteName),
    stat: (relativePath: string): Promise<{ kind: 'file' | 'directory' } | null> =>
      ipcRenderer.invoke('obsidian:stat', relativePath),
    listDir: (relativePath: string): Promise<Array<{ name: string; kind: 'file' | 'directory' }>> =>
      ipcRenderer.invoke('obsidian:list-dir', relativePath),
    readFile: (relativePath: string): Promise<{ text?: string; lastModified?: number; notFound?: boolean; error?: string }> =>
      ipcRenderer.invoke('obsidian:read-file', relativePath),
    writeFile: (relativePath: string, content: string): Promise<boolean> =>
      ipcRenderer.invoke('obsidian:write-file', relativePath, content),
  },
});
