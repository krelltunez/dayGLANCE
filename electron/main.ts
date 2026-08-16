import { app, BrowserWindow, shell, ipcMain, net, protocol, Tray, Menu, nativeImage, nativeTheme, globalShortcut, session, screen, Notification } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { homedir } from 'node:os';
import dns from 'node:dns';
import nodeNet from 'node:net';
import { fileURLToPath } from 'node:url';
import { createWsServer, WS_PORT } from './ws-server.js';
import type { WebSocketServer } from 'ws';
import type http from 'node:http';
import { registerSubscriptionHandlers } from './subscription.js';
import { registerCalendarHandlers } from './calendar.js';
import { registerStorefrontHandlers } from './storefront.js';
import { registerICloudHandlers } from './icloud.js';
import { registerObsidianHandlers } from './obsidian.js';
import { APP_SCHEME, APP_HOST, APP_BASE_URL, resolveAppRequest } from './appProtocol.js';
import { shouldQuitOnAllWindowsClosed, shouldUnregisterShortcutsOnQuit } from './startupQuit.js';
import { initStartupLog, logStartup } from './startupLog.js';
import { startMcpServer } from './mcpServer.js';
import { generateMcpToken } from './mcpAuth.js';
import { resolveMcpPort, describeBindFailure, DEFAULT_MCP_PORT } from './mcpPort.js';
import {
  defaultConfig as defaultIntegrationsConfig,
  recoverFromConfigFile,
  mcpGates,
  applyTransition as applyIntegrationsTransition,
  listenerEffects,
  type LocalIntegrationsConfig,
  type TransitionAction,
} from './localIntegrations.js';
import { createRendererBridge, type RendererBridge } from './mcpRendererBridge.js';
import type { WriteToolDeps } from './mcpWriteTools.js';
import { discoveryFilePath, discoveryPayload } from './mcpDiscovery.js';
import {
  appendEntry as appendJournalEntry,
  journalSnapshot as buildJournalSnapshot,
  buildUndoPlan,
  undoGroupKey,
  mcpIndicator,
  composeTrayTitle,
  type JournalEntry,
  type JournalRecord,
} from './mcpJournal.js';
import { createWriteGate } from './mcpWriteGate.js';
import { createIdempotencyStore } from './mcpIdempotency.js';
import { trayReloadDebounceMs } from './trayReloadPolicy.js';
import { decideRecovery } from './rendererRecovery.js';

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

// Startup logging — a bounded record in userData (dayglance-startup.log) that a
// user can send after a bad launch. Initialized as early as possible (right
// after userData is pinned) so it captures crashes that happen before app-ready.
// Best-effort: it never throws into startup. See electron/startupLog.ts.
initStartupLog(app.getPath('userData'));
logStartup('main process module loaded');
process.on('uncaughtException', (err) => {
  logStartup(`uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  logStartup(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

const DEV = !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5173';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
// True once the main window has been created for the first time. Guards the
// window-all-closed → app.quit() handler so transient utility windows created
// DURING startup (the file:// storage-migration reader/writer) can't trip it
// before the real window exists. See the window-all-closed handler.
let didCreateMainWindow = false;
let trayWindow: BrowserWindow | null = null;
// Crash-recovery attempt clocks, one ladder per window (rendererRecovery.ts).
let mainRecoveryAttempts: number[] = [];
let trayRecoveryAttempts: number[] = [];
// Consumed by createWindow: a recreate of a window that was hidden when its
// renderer crashed (macOS closed-to-tray) must not surface it. Recovery keeps
// the renderer alive for the save pass and tray pushes; showing a window the
// user closed is not its call to make.
let suppressNextMainShow = false;
let trayNeedsReload = false;
let trayReloadTimer: ReturnType<typeof setTimeout> | null = null;
// Clock reading of the last MCP-originated write, for the §3.6 tray reload
// policy (trayReloadPolicy.ts): while an agent is writing, the reload debounce
// stretches so a write storm coalesces instead of reloading the popup per write.
let lastMcpWriteAt: number | null = null;
let registeredHotkey: string | null = null;
let registeredMainWindowHotkey: string | null = null;

// Tray menu bar title: focus countdown takes priority over the reminder dot.
let trayIndicatorOn = false;
let trayFocusTitle = '';
function refreshTrayTitle() {
  // Focus and reminder state only. The MCP tier deliberately does NOT reach
  // the menu-bar title: the §6.5 ambient signal is the in-app bolt button
  // (settings cluster + tray popup), which exists on every platform, while
  // this title exists only on macOS.
  tray?.setTitle(composeTrayTitle({ focusTitle: trayFocusTitle, reminderOn: trayIndicatorOn }));
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

// ── Window background theme ──────────────────────────────────────────────────
// A BrowserWindow's backing surface is WHITE by default, and it shows whenever
// the window is visible before the renderer's first paint — the startup white
// flash (worst when the 10s fallback show fires before ready-to-show on a slow
// cold start). Dark-mode is renderer state (localStorage), which the main
// process can't read, so the renderer reports theme changes over IPC and we
// persist them here for the NEXT launch's window creation. First launch ever
// falls back to the OS theme. Colors match theme-init.js / the app shell.
const WINDOW_THEME_FILE = () => path.join(app.getPath('userData'), 'window-theme.json');
const DARK_BG = '#1f2937';
const LIGHT_BG = '#ffffff';

function windowBackgroundColor(): string {
  try {
    const raw = fs.readFileSync(WINDOW_THEME_FILE(), 'utf-8');
    const parsed = JSON.parse(raw) as { darkMode?: boolean };
    if (typeof parsed.darkMode === 'boolean') return parsed.darkMode ? DARK_BG : LIGHT_BG;
  } catch { /* first launch or unreadable — fall through to OS theme */ }
  return nativeTheme.shouldUseDarkColors ? DARK_BG : LIGHT_BG;
}

ipcMain.on('window:set-theme', (_event, darkMode: unknown) => {
  const dark = !!darkMode;
  try {
    fs.writeFileSync(WINDOW_THEME_FILE(), JSON.stringify({ darkMode: dark }));
  } catch { /* best-effort — worst case the next launch uses the OS theme */ }
  // Update live surfaces too, so resize exposure mid-session matches the theme.
  for (const win of BrowserWindow.getAllWindows()) {
    win.setBackgroundColor(dark ? DARK_BG : LIGHT_BG);
  }
});

function createWindow(): BrowserWindow {
  const saved = loadWindowState();
  didCreateMainWindow = true;
  logStartup('createWindow: called');

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : {}),
    show: false,
    backgroundColor: windowBackgroundColor(),
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
      const win = live(mainWindow);
      if (!win) return;
      // Hiding a window that's in native macOS fullscreen strands its fullscreen
      // Space as an empty black screen — leave fullscreen first, then hide once
      // the transition completes.
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => live(mainWindow)?.hide());
        win.setFullScreen(false);
      } else {
        win.hide();
      }
      return;
    }
    saveWindowState({ ...normalBounds, maximized: live(mainWindow)?.isMaximized() ?? false });
  });

  if (saved.maximized) mainWindow.maximize();

  // Show the window only after the renderer has painted its first frame,
  // preventing the white screen that appears when the window is shown before
  // React has had a chance to render anything.
  //
  // Safety net: if ready-to-show never fires (a renderer that fails to load or
  // paint), force the window visible after a grace period rather than leaving an
  // invisible process the user can only find in Task Manager. A visible window —
  // even blank — is reportable; a silent one is the "installed but never
  // launched" black hole. The timeout is long enough never to race a normal
  // startup. Both paths are logged so dayglance-startup.log shows which fired.
  const SHOW_FALLBACK_MS = 10_000;
  let shown = false;
  // Crash recovery can recreate a window that was hidden when its renderer
  // died (macOS closed-to-tray). That recreate must not surface the window,
  // so it sets suppressNextMainShow and this consumes it: the renderer comes
  // back alive but invisible, exactly as the user left it.
  const suppressShow = suppressNextMainShow;
  suppressNextMainShow = false;
  const showOnce = (why: string) => {
    if (shown) return;
    shown = true;
    if (suppressShow) {
      logStartup(`main window show suppressed after hidden-recreate (${why})`);
      return;
    }
    logStartup(`main window show (${why})`);
    live(mainWindow)?.show();
  };
  const fallbackShow = setTimeout(() => showOnce('fallback-timeout'), SHOW_FALLBACK_MS);
  mainWindow.once('ready-to-show', () => { clearTimeout(fallbackShow); showOnce('ready-to-show'); });

  // Startup diagnostics — high-signal failure events written to the startup log.
  mainWindow.webContents.on('did-finish-load', () => logStartup('main window did-finish-load'));
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
    logStartup(`did-fail-load: code=${code} "${desc}" url=${url}`));
  // Crash recovery (rendererRecovery.ts holds the tested decision ladder):
  // reload the surviving window on the first qualifying crash, recreate on a
  // second within the window, then stop. A crashed renderer leaves a window
  // isDestroyed() calls healthy, so without this the app is a blank frame
  // whose save pass and tray pushes are silently dead.
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logStartup(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    const decision = decideRecovery({
      reason: details.reason, isQuitting, attempts: mainRecoveryAttempts, now: Date.now(),
    });
    mainRecoveryAttempts = decision.attempts;
    if (decision.action === 'ignore' || decision.action === 'give-up') {
      if (decision.action === 'give-up') logStartup('crash recovery: giving up (crash loop)');
      return;
    }
    // Deferred so a crash arriving a moment before quit re-checks the flag
    // after before-quit has had the chance to set it.
    setTimeout(() => {
      if (isQuitting) return;
      const win = live(mainWindow);
      if (!win) return;
      logStartup(`crash recovery: ${decision.action}`);
      if (decision.action === 'reload') {
        win.webContents.reload();
      } else if (decision.action === 'load-url') {
        win.loadURL(DEV ? VITE_DEV_SERVER_URL : APP_BASE_URL);
      } else {
        // recreate: destroy the zombie first, and keep a hidden window hidden.
        suppressNextMainShow = !win.isVisible();
        win.destroy();
        createWindow();
      }
    }, 250);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) =>
    logStartup(`preload-error: ${preloadPath}: ${err?.message ?? err}`));

  if (DEV) {
    // concurrently starts vite and electron together, so the first load can
    // beat the dev server and fail with ERR_CONNECTION_REFUSED. A failed dev
    // load used to leave the window white forever; keep retrying until the
    // server comes up (also covers vite restarts). ERR_ABORTED (-3) is a
    // superseded navigation, not a server failure — never retry those.
    mainWindow.webContents.on('did-fail-load', (_e, code, _desc, url) => {
      if (code === -3 || !url?.startsWith(VITE_DEV_SERVER_URL)) return;
      setTimeout(() => {
        logStartup(`dev server load failed (${code}) — retrying`);
        mainWindow?.loadURL(VITE_DEV_SERVER_URL);
      }, 1000);
    });
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
    backgroundColor: windowBackgroundColor(),
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
    setTimeout(() => { pushRemindersToTray(); pushCurrentTaskToTray(); pushTrayVisibilityToTray(); }, 800);
  });

  // Tray crash recovery, same ladder as the main window. The popup's
  // accidental self-healing (tray:data-changed reload) only works while the
  // MAIN renderer is alive to emit a save pass; this handler covers the case
  // where the tray dies alone or both are down. Recreate is safe here: the
  // popup is created hidden by design, and the cached pushes re-send on
  // did-finish-load above.
  win.webContents.on('render-process-gone', (_e, details) => {
    logStartup(`tray render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    const decision = decideRecovery({
      reason: details.reason, isQuitting, attempts: trayRecoveryAttempts, now: Date.now(),
    });
    trayRecoveryAttempts = decision.attempts;
    if (decision.action === 'ignore' || decision.action === 'give-up') {
      if (decision.action === 'give-up') logStartup('tray crash recovery: giving up (crash loop)');
      return;
    }
    setTimeout(() => {
      if (isQuitting) return;
      const tw = live(trayWindow);
      if (!tw) return;
      logStartup(`tray crash recovery: ${decision.action}`);
      if (decision.action === 'reload') {
        tw.webContents.reload();
      } else if (decision.action === 'load-url') {
        tw.loadURL(DEV ? `${VITE_DEV_SERVER_URL}?tray=1` : `${APP_BASE_URL}?tray=1`);
      } else {
        const wasVisible = tw.isVisible();
        tw.destroy();
        trayWindow = createTrayWindow();
        if (wasVisible) setTrayVisible(false); // popup positioning is show-time logic; reopen from the tray icon
      }
    }, 250);
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
    setTrayVisible(false);
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
    if (tw.isVisible()) { tw.hide(); setTrayVisible(false); return; }
    positionTrayPopup(tw, bounds);
    trayIndicatorOn = false;
    refreshTrayTitle();
    tw.show();
    tw.focus();
    setTrayVisible(true);
    pushRemindersToTray();
    pushCurrentTaskToTray();
  });

  // Right-click: native Open / Quit menu. When the MCP listener is bound, the
  // menu also names the current tier and offers the §6.5 kill switch — this
  // path is pure main-process (runIntegrationsTransition), so it works with
  // NO window at all: no main window, no popup, no relay to drop.
  tray.on('right-click', () => {
    const gates = mcpGates(integrationsConfig);
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: 'Open dayGLANCE', click: () => { live(mainWindow)?.show(); live(mainWindow)?.focus(); } },
    ];
    if (gates.bound) {
      template.push(
        { type: 'separator' },
        { label: mcpIndicator(gates).label, enabled: false },
        { label: 'Turn off MCP server', click: () => killMcpServer() },
      );
    }
    template.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() });
    tray?.popUpContextMenu(Menu.buildFromTemplate(template));
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

// Escape → leave native (green-button) fullscreen. macOS doesn't do this by
// default; the renderer sends this only for an Escape no modal/editor consumed
// (see src/hooks/useFullscreenEscape.js). No-op when the window isn't fullscreen.
ipcMain.on('window:exit-fullscreen', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed() && win.isFullScreen()) win.setFullScreen(false);
});

// Tray popup requests the main window to show and navigate to a specific location.
// This is a user action and must never silently vanish: when the main window is
// gone (closed on non-macOS) OR a zombie (renderer crashed, which live() cannot
// see because the window is not destroyed), recreate it and deliver the
// navigation once the fresh renderer has loaded. Mirrors the second-instance
// recreate branch, plus the zombie destroy that branch does not need.
ipcMain.on('tray:open-main', (_event, payload: unknown) => {
  live(trayWindow)?.hide();
  setTrayVisible(false);
  const mw = live(mainWindow);
  if (mw && !mw.webContents.isCrashed()) {
    mw.show();
    mw.focus();
    mw.webContents.send('tray:navigate', payload);
    return;
  }
  if (mw) mw.destroy();
  const win = createWindow();
  win.webContents.once('did-finish-load', () => {
    const fresh = live(mainWindow);
    if (!fresh) return;
    fresh.show();
    fresh.focus();
    fresh.webContents.send('tray:navigate', payload);
  });
});

// Tray sends background mutations (e.g. toggle-complete) to the main window without showing it.
// Fire-and-forget BY DESIGN at this hop: delivery is confirmed end-to-end by
// the tray:action-applied ack below, and the tray treats silence past its
// timeout as failure. A liveness check here would be redundant and, for a
// crashed renderer, wrong (live() cannot see a zombie).
ipcMain.on('tray:background-action', (_event, payload: unknown) => {
  live(mainWindow)?.webContents.send('tray:background-action', payload);
});

// The main renderer reports an action applied; relay to the tray popup so it
// settles its pending map (src/utils/trayActionAcks.js).
ipcMain.on('tray:action-applied', (_event, ackId: unknown) => {
  live(trayWindow)?.webContents.send('tray:action-applied', ackId);
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

// Last-known popup visibility. The main process is the authority here — it owns
// every show/hide call site below — so the renderer never has to infer it from
// document.visibilityState.
//
// The popup is created hidden (createTrayWindow passes show: false), so false is
// the correct initial value. Cached and re-pushed on did-finish-load for the
// same reason as the reminder list: the popup reloads in the background, and a
// reload that lands while it is open must not leave the renderer believing it is
// hidden until the next transition.
let lastKnownTrayVisible = false;

function pushTrayVisibilityToTray() {
  live(trayWindow)?.webContents.send('tray:visibility', lastKnownTrayVisible);
}

// Single choke point for the popup's visibility so no show/hide path can update
// the window without telling the renderer.
function setTrayVisible(visible: boolean) {
  lastKnownTrayVisible = visible;
  pushTrayVisibilityToTray();
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
    if (tw.isVisible()) { tw.hide(); setTrayVisible(false); return; }
    positionTrayPopup(tw, tray?.getBounds());
    trayIndicatorOn = false;
    refreshTrayTitle();
    tw.show();
    tw.focus();
    setTrayVisible(true);
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

// Keep tray popup in sync: reload it in the background whenever persisted data
// changes. Driven by 'tray:data-changed' — emitted once per save pass from the
// main window — and NOT by 'ws:push-state', which is the Stream Deck broadcast.
// That channel re-fires every 15 s off the renderer's clock tick (currentTime is
// in its dependency array), so it reloaded the popup four times a minute with
// identical data; it also omits slices the tray renders (recycle bin, daily
// notes, areas, GTD frames), so some real edits never reached the tray at all.
// The save pass covers both, and carries no clock dependency.
ipcMain.on('tray:data-changed', (event) => {
  const tw = live(trayWindow);
  if (!tw) return;
  if (event.sender === tw.webContents) return;
  if (tw.isVisible()) {
    trayNeedsReload = true;
  } else {
    if (trayReloadTimer) clearTimeout(trayReloadTimer);
    // 500ms for user saves; stretched while MCP writes are recent, so an
    // agent writing at the §4.3 rate limit coalesces to one reload after the
    // storm instead of one per write. See electron/trayReloadPolicy.ts.
    trayReloadTimer = setTimeout(() => {
      trayReloadTimer = null;
      live(trayWindow)?.webContents.reload();
    }, trayReloadDebounceMs(Date.now(), lastMcpWriteAt));
  }
});

// Native macOS "About dayGLANCE" panel. macOS builds it from the bundle's
// Info.plist, but setAboutPanelOptions lets us override the copyright and add
// contact/website lines via the credits field (rendered below the copyright).
// applicationName/version are left to Info.plist so they stay in sync with the
// build (CFBundleShortVersionString + CFBundleVersion).
app.setAboutPanelOptions({
  copyright: 'Copyright © 2026 GLANCE Apps',
  // credits is a plain string (Electron doesn't accept an attributed/RTF value
  // here), so the URLs render as readable, copyable text rather than links.
  credits: [
    'Support: support@glance-apps.com',
    'Web: https://www.glance-apps.com/',
    'Privacy: https://glance-apps.com/dayglance/privacy',
    'Terms: https://www.glance-apps.com/eula',
  ].join('\n'),
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

    // 2) WRITE into the app:// localStorage. Only keys that do NOT already exist in
    //    the target are set (app://-only keys are left intact regardless). This is
    //    IDENTICAL to "file:// wins" on a true first run (the target bucket is empty,
    //    so every file:// key is written), but makes a RETRY non-destructive: if a
    //    previous launch migrated but crashed before writing the done-flag, the retry
    //    must not clobber newer app:// data the running app has since written with the
    //    stale file:// snapshot. Skipping already-present keys makes retries purely
    //    additive. Same session as the main window, so the writes are visible to it
    //    immediately.
    const writer = mkHidden();
    try {
      await writer.loadURL(APP_BASE_URL + 'storage-bridge.html'); // app://dayglance origin
      await writer.webContents.executeJavaScript(
        `(function(){var d=${JSON.stringify(fileData)};for(var k in d){if(localStorage.getItem(k)===null){localStorage.setItem(k,d[k]);}}return true;})()`,
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

// ── Local integrations: Stream Deck + MCP (spec §6.2/§6.3, Phase 5a) ────────
// Every DECISION (migration, tier resolution, consent transitions, listener
// reconciliation) lives in localIntegrations.ts, pure and unit-tested. This
// block owns only what cannot be pure: file I/O, listener lifecycle, and IPC.

const LOCAL_INTEGRATIONS_FILE = 'local-integrations.json';
function integrationsConfigPath(): string {
  return path.join(app.getPath('userData'), LOCAL_INTEGRATIONS_FILE);
}

let integrationsConfig: LocalIntegrationsConfig = defaultIntegrationsConfig();
let wsServerHandle: WebSocketServer | null = null;
let mcpServerHandle: http.Server | null = null;
let streamDeckStatus: { running: boolean; error: string | null } = { running: false, error: null };
let mcpStatus: { running: boolean; error: string | null } = { running: false, error: null };

// Created on first MCP start and reused across stop/start cycles: the bridge
// registers an ipcMain listener (restarting must not stack another one), and
// a long-lived gate + idempotency store mean toggling the port cannot be used
// to reset rate-limit strikes or the write-replay window.
let mcpBridge: RendererBridge | null = null;
let mcpWriteGate: ReturnType<typeof createWriteGate> | null = null;
let mcpIdempotencyStore: WriteToolDeps['store'] | null = null;

function saveIntegrationsConfig(): void {
  try {
    fs.writeFileSync(integrationsConfigPath(), JSON.stringify(integrationsConfig, null, 2));
  } catch (err) {
    console.error('[dayGLANCE] Failed to save local-integrations config:', err);
  }
}

// MUST run before migrateFileToAppStorage(): that migration stamps its
// done-flag even on a FRESH install, so reading the prior-install evidence
// after it would make every fresh install look like an upgrade and switch
// Stream Deck on for users who never had it (§6.2 inverted).
function loadOrMigrateIntegrationsConfig(): void {
  const cfgPath = integrationsConfigPath();

  // Read the file; every decision about the CONTENT is pure and tested
  // (localIntegrations.ts). A file that exists but cannot be read maps to ''
  // (unparseable), so it takes the same corrupt-recovery path below.
  let fileContent: string | null = null;
  if (fs.existsSync(cfgPath)) {
    try {
      fileContent = fs.readFileSync(cfgPath, 'utf-8');
    } catch (err) {
      console.error('[dayGLANCE] local-integrations config could not be read:', err);
      fileContent = '';
    }
  }

  // Any userData artifact only a previous RUN could have written. The startup
  // log is deliberately not usable here — initStartupLog() already created it
  // for THIS run at module load.
  const priorInstallEvidence =
    fs.existsSync(winStatePath()) ||
    fs.existsSync(WINDOW_THEME_FILE()) ||
    fs.existsSync(path.join(app.getPath('userData'), STORAGE_MIGRATION_FLAG));

  const result = recoverFromConfigFile(fileContent, priorInstallEvidence);
  integrationsConfig = result.config;
  if (result.action === 'use') return;

  if (result.corrupt) {
    // A corrupt file is not a choice the user made: MCP fails closed (the
    // migration never enables it), but Stream Deck re-migrates from the
    // evidence so existing users keep their buttons. Preserve the corrupt
    // file rather than overwriting it in place — it is the only record of
    // what the user actually had.
    const asidePath = `${cfgPath}.corrupt`;
    try {
      fs.rmSync(asidePath, { force: true }); // Windows rename refuses to overwrite
      fs.renameSync(cfgPath, asidePath);
      logStartup('local integrations: config unreadable; preserved as local-integrations.json.corrupt');
      console.error(
        `[dayGLANCE] local-integrations.json was unreadable. It was preserved as ${asidePath} and the Stream Deck migration re-ran.`,
      );
    } catch (err) {
      console.error('[dayGLANCE] Failed to move the corrupt local-integrations config aside:', err);
    }
  }

  saveIntegrationsConfig();
  logStartup(
    `local integrations: config ${result.corrupt ? 'recovered from corrupt file' : 'created'} ` +
    `(streamDeck ${integrationsConfig.streamDeck.enabled ? 'ON — upgrade migration' : 'off — fresh install'})`,
  );
}

// ── Multi-user flag for the MCP tool schemas ─────────────────────────────────
// A per-device toggle that lives in RENDERER state (unlike the consent tiers,
// which main owns in local-integrations.json), so the renderer pushes it here:
// once on mount and again on every change. It gates the EXISTENCE of
// create_task's assignee_id argument and the dayglance_list_users tool, both
// evaluated per request by the §3.7 server factory — a toggle mid-session
// changes the schema on the client's very next request, never a stale one.
// Only the flag crosses the IPC boundary; the user roster stays renderer-side.
let mcpMultiUserEnabled = false;

function registerMcpMultiUserHandler(): void {
  ipcMain.on('mcp:multi-user-enabled', (event, enabled: unknown) => {
    // Same sender discipline as mcpRendererBridge: only the main window's
    // live state is authoritative (the tray popup holds a stale snapshot).
    if (event.sender !== live(mainWindow)?.webContents) return;
    mcpMultiUserEnabled = enabled === true;
  });
}

// ── §4.3 write journal — session-scoped BY DESIGN ────────────────────────────
// Module scope in the main process (never on the McpServer instance, §3.7,
// never on disk): it covers the runaway-agent case, so dying with the process
// is correct. All decisions live in mcpJournal.ts, pure and tested.
let mcpJournalEntries: JournalEntry[] = [];

function recordMcpJournal(record: JournalRecord): void {
  mcpJournalEntries = appendJournalEntry(mcpJournalEntries, record, new Date().toISOString());
  pushMcpJournal();
}

function pushMcpJournal(): void {
  const snapshot = buildJournalSnapshot(mcpJournalEntries);
  for (const win of [live(mainWindow), live(trayWindow)]) {
    win?.webContents.send('mcp-journal:changed', snapshot);
  }
}

function registerMcpJournalHandlers(): void {
  ipcMain.handle('mcp-journal:get', () => buildJournalSnapshot(mcpJournalEntries));
  // Bulk undo (§4.3): reverse every session MCP write, applied by the main
  // window's renderer through taskMutations.js applyUndoOps — the same store
  // layer as any write, so sync, GLANCEintents, and tray:data-changed all
  // engage. The journal clears only on a confirmed application.
  ipcMain.handle('mcp-journal:undo-all', async () => {
    if (mcpJournalEntries.length === 0) return { ok: false, error: 'No MCP changes to undo.' };
    if (!mcpBridge) return { ok: false, error: 'The dayGLANCE window is not available.' };
    const plan = buildUndoPlan(mcpJournalEntries);
    const r = await mcpBridge.request('undo_mcp_writes', { ops: plan.ops }, 10_000);
    if (!r.ok) return { ok: false, error: r.error.message };
    mcpJournalEntries = [];
    pushMcpJournal();
    const data = r.data as { undone?: number; skipped?: number };
    return { ok: true, undone: data?.undone ?? plan.count, skipped: data?.skipped ?? 0 };
  });
  // Per-task undo: reverse every journal entry for ONE task, back to its
  // state before MCP first touched it. Same pipeline as undo-all — filter
  // the FULL journal by group key, reverse chronologically, apply through
  // the renderer's applyUndoOps — so an undone create still becomes a
  // recycle-bin move. Only the undone task's entries leave the journal;
  // the rest stay undoable (each entry's before-state is self-contained).
  ipcMain.handle('mcp-journal:undo-task', async (_event, groupKey: unknown) => {
    if (typeof groupKey !== 'string' || groupKey.length === 0) {
      return { ok: false, error: 'No task specified.' };
    }
    const subset = mcpJournalEntries.filter((e) => undoGroupKey(e.op) === groupKey);
    if (subset.length === 0) return { ok: false, error: 'No MCP changes to undo for this task.' };
    if (!mcpBridge) return { ok: false, error: 'The dayGLANCE window is not available.' };
    const plan = buildUndoPlan(subset);
    const r = await mcpBridge.request('undo_mcp_writes', { ops: plan.ops }, 10_000);
    if (!r.ok) return { ok: false, error: r.error.message };
    mcpJournalEntries = mcpJournalEntries.filter((e) => undoGroupKey(e.op) !== groupKey);
    pushMcpJournal();
    const data = r.data as { undone?: number; skipped?: number };
    return { ok: true, undone: data?.undone ?? plan.count, skipped: data?.skipped ?? 0 };
  });
}

function pushIntegrationsStatus(): void {
  const snapshot = integrationsSnapshot();
  // The tray gets the same push (§6.5): its listener-state display is LIVE
  // over IPC, deliberately outside the popup's stale data-snapshot cycle.
  for (const win of [live(mainWindow), live(trayWindow)]) {
    win?.webContents.send('local-integrations:status', snapshot);
  }
  refreshTrayTitle();
}

function startStreamDeckListener(): void {
  if (wsServerHandle) return;
  streamDeckStatus = { running: false, error: null };
  const wss = createWsServer(() => live(mainWindow));
  wsServerHandle = wss;
  wss.on('listening', () => {
    streamDeckStatus = { running: true, error: null };
    pushIntegrationsStatus();
  });
  wss.on('error', (err: NodeJS.ErrnoException) => {
    // Loud, specific, and no port-scan fallback — same posture as MCP (§3.4).
    streamDeckStatus = {
      running: false,
      error: err.code === 'EADDRINUSE'
        ? `Port ${WS_PORT} is already in use by another process. The Stream Deck plugin expects this exact port, so dayGLANCE will not pick another one. Quit the conflicting process, then toggle Stream Deck support off and on.`
        : `Stream Deck listener failed: ${err.code ?? err.message ?? 'unknown error'}`,
    };
    pushIntegrationsStatus();
  });
}

function stopStreamDeckListener(): void {
  const wss = wsServerHandle;
  wsServerHandle = null;
  streamDeckStatus = { running: false, error: null };
  if (wss) {
    for (const client of wss.clients) client.terminate();
    wss.close();
  }
  pushIntegrationsStatus();
}

function startMcpListener(): void {
  if (mcpServerHandle) return;
  if (!mcpGates(integrationsConfig).bound) return; // off means off: no port bound (§6.3)

  const resolved = resolveMcpPort(integrationsConfig.mcp.portOverride);
  if (!resolved.ok) {
    mcpStatus = { running: false, error: resolved.reason };
    pushIntegrationsStatus();
    return;
  }

  if (!mcpBridge) mcpBridge = createRendererBridge(() => live(mainWindow));
  if (!mcpWriteGate) mcpWriteGate = createWriteGate();
  if (!mcpIdempotencyStore) mcpIdempotencyStore = createIdempotencyStore();
  // Resolved on the machine, never inferred from the client (§5.3).
  const mcpTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Getter, read per request: settings-driven rotation invalidates the old
  // token on the very next request, no restart involved.
  const mcpToken = () => integrationsConfig.mcp.token ?? '';

  mcpStatus = { running: false, error: null };
  const srv = startMcpServer({
    token: mcpToken,
    portOverride: integrationsConfig.mcp.portOverride,
    readDeps: {
      bridge: mcpBridge,
      now: Date.now,
      timeZone: mcpTimeZone,
      // §6.3 device-calendar tier, settings-backed (this closure replaced the
      // DAYGLANCE_MCP_CALENDAR env var — tool code unchanged, as designed).
      includeNativeEvents: () => mcpGates(integrationsConfig).includeNative,
      multiUserEnabled: () => mcpMultiUserEnabled,
    },
    writeDeps: {
      bridge: mcpBridge,
      gate: mcpWriteGate,
      store: mcpIdempotencyStore,
      token: mcpToken,
      // §6.3 writes opt-in, settings-backed (replaced DAYGLANCE_MCP_WRITES).
      includeWrites: () => mcpGates(integrationsConfig).includeWrites,
      multiUserEnabled: () => mcpMultiUserEnabled,
      noteMcpWrite: () => { lastMcpWriteAt = Date.now(); },
      // §4.3 write journal (Phase 5b): session-scoped record + tray surface.
      journal: recordMcpJournal,
      // §4.3: repeated rate-limit violations auto-disable writes with a
      // notification. Fires exactly once, on the disable edge.
      onWritesDisabled: () => {
        console.error('[dayGLANCE] MCP writes auto-disabled after repeated rate-limit violations.');
        if (Notification.isSupported()) {
          new Notification({
            title: 'dayGLANCE MCP writes disabled',
            body: 'An MCP client repeatedly exceeded the write rate limit. Writes stay off until dayGLANCE restarts.',
          }).show();
        }
        // The bolt buttons' red dot state: push so it appears live, not on
        // the next unrelated status change.
        pushIntegrationsStatus();
      },
      now: Date.now,
      timeZone: mcpTimeZone,
    },
  });
  if (!srv) {
    // startMcpServer already logged why; mirror it into settings.
    mcpStatus = { running: false, error: 'MCP server could not start. See the startup log for details.' };
    pushIntegrationsStatus();
    return;
  }
  mcpServerHandle = srv;
  srv.on('listening', () => {
    mcpStatus = { running: true, error: null };
    syncDiscoveryFile();
    pushIntegrationsStatus();
  });
  srv.on('error', (err: NodeJS.ErrnoException) => {
    // The §3.4 loud collision: named port, no scan, shown in settings.
    mcpStatus = { running: false, error: describeBindFailure(resolved.port, err) };
    pushIntegrationsStatus();
  });
}

// ── §3.4 discovery file ──────────────────────────────────────────────────────
// {port, token} where the bridge looks, so direct-download setups need no
// manual configuration. Kept in lockstep with the listener: written on bind,
// rewritten when the token rotates, removed on unbind. MAS builds write
// nothing (discoveryFilePath returns null there): manual token only, per the
// Phase 0.5 findings.
function syncDiscoveryFile(): void {
  const filePath = discoveryFilePath(process.platform, process.env, homedir(), process.mas === true);
  if (!filePath) return;
  try {
    if (mcpStatus.running && mcpGates(integrationsConfig).bound) {
      const resolved = resolveMcpPort(integrationsConfig.mcp.portOverride);
      if (!resolved.ok) return;
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, discoveryPayload(resolved.port, integrationsConfig.mcp.token ?? ''), { mode: 0o600 });
    } else {
      fs.rmSync(filePath, { force: true });
    }
  } catch (err) {
    logStartup(`discovery file sync failed at ${filePath}: ${String((err as Error).message)}`);
  }
}

function stopMcpListener(onClosed?: () => void): void {
  const srv = mcpServerHandle;
  mcpServerHandle = null;
  mcpStatus = { running: false, error: null };
  syncDiscoveryFile();
  pushIntegrationsStatus();
  if (!srv) { onClosed?.(); return; }
  srv.close(() => { onClosed?.(); });
  // Destroy live connections (idle keep-alives, open SSE streams) so the port
  // is actually released now — close() alone waits on them indefinitely, which
  // would make a port-change restart race its own rebind.
  srv.closeAllConnections();
}

function integrationsSnapshot() {
  const resolved = resolveMcpPort(integrationsConfig.mcp.portOverride);
  return {
    config: integrationsConfig,
    gates: mcpGates(integrationsConfig),
    ports: {
      streamDeck: WS_PORT,
      mcpDefault: DEFAULT_MCP_PORT,
      mcpEffective: resolved.ok ? resolved.port : null,
    },
    status: {
      streamDeck: streamDeckStatus,
      mcp: {
        ...mcpStatus,
        // §4.3 auto-disable state, straight from the gate (the long-lived
        // authority — it survives listener stop/start deliberately). Drives
        // the bolt buttons' red dot; presentation reads it, never sets it.
        writesAutoDisabled: mcpWriteGate?.writesDisabled() ?? false,
      },
    },
  };
}

// The one transition entry point, shared by the settings/tray IPC handler and
// the tray icon's native context menu (the §6.5 kill switch path that needs
// no window at all). Config-owning, so it never routes through a renderer.
function runIntegrationsTransition(action: TransitionAction): { ok: true } | { ok: false; error: string } {
  const result = applyIntegrationsTransition(integrationsConfig, action, {
    nowIso: () => new Date().toISOString(),
    generateToken: generateMcpToken,
    resolvePort: resolveMcpPort,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const effects = listenerEffects(integrationsConfig, result.config);
  integrationsConfig = result.config;
  saveIntegrationsConfig();
  if (effects.streamDeck === 'start') startStreamDeckListener();
  else if (effects.streamDeck === 'stop') stopStreamDeckListener();
  if (effects.mcp === 'start') startMcpListener();
  else if (effects.mcp === 'stop') stopMcpListener();
  else if (effects.mcp === 'restart') stopMcpListener(() => startMcpListener());
  // Token rotation changes no listener state (the token is a live getter),
  // but the §3.4 discovery file carries the token, so keep it in lockstep.
  syncDiscoveryFile();
  pushIntegrationsStatus();
  return { ok: true };
}

/** The §6.5 kill switch: MCP off (port unbinds; writes drop with the tier). */
function killMcpServer(): void {
  const r = runIntegrationsTransition({ type: 'set-mcp-read-tier', tier: 'off' });
  if (!r.ok) console.error('[dayGLANCE] MCP kill switch failed:', r.error);
}

function registerLocalIntegrationsHandlers(): void {
  ipcMain.handle('local-integrations:get', () => integrationsSnapshot());
  ipcMain.handle('local-integrations:transition', (_event, action: unknown) => {
    const result = runIntegrationsTransition(action as TransitionAction);
    if (!result.ok) return result;
    return { ok: true, snapshot: integrationsSnapshot() };
  });
}

app.whenReady().then(async () => {
  // A doomed second instance may still reach 'ready' before app.quit() takes
  // effect; bail before creating any windows so it never steals the port/state.
  if (!gotSingleInstanceLock) return;
  logStartup('app ready');

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
    // DEV: leave the vite dev server's responses alone. The strict CSP breaks
    // dev in two ways — script-src 'self' blocks the inline react-refresh
    // preamble ("@vitejs/plugin-react can't detect preamble" → every module
    // throws → permanent white screen), and connect-src without ws: would
    // block the HMR websocket. The dev origin is trusted localhost only;
    // packaged builds never hit this branch and keep the full CSP.
    if (DEV && details.url.startsWith(VITE_DEV_SERVER_URL)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
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
  // Local-integrations config load + the §6.2 one-time Stream Deck migration.
  // Ordering is load-bearing: migrateFileToAppStorage() below stamps its
  // done-flag even on a fresh install, and that flag is one of the
  // prior-install signals — so this MUST read the evidence first.
  loadOrMigrateIntegrationsConfig();

  logStartup('storage migration: start');
  await migrateFileToAppStorage();
  logStartup('storage migration: done');

  const win = createWindow();
  // Both local listeners are settings-gated (§6.2, Phase 5a): the Stream Deck
  // toggle is ON for upgraded installs via the migration above, and the MCP
  // listener binds only when a read tier was enabled through the consent flow
  // — startMcpListener() no-ops otherwise, so off means no port bound at all.
  // The DAYGLANCE_MCP_DEV/TOKEN/PORT/CALENDAR/WRITES env vars are gone; the
  // config file is the sole source.
  registerLocalIntegrationsHandlers();
  registerMcpJournalHandlers();
  registerMcpMultiUserHandler();
  // §7 compile-out: the Claude Desktop setup module is EXCLUDED from MAS
  // packaging (electron-builder mas.files filter), so it loads dynamically
  // and its absence is a clean no-op, never a crash. The renderer's setup
  // button is likewise eliminated from the MAS bundle at build time.
  import('./mcpDesktopSetup.js')
    .then((m) => m.registerMcpDesktopSetup())
    .catch(() => { /* absent in the MAS package, by design */ });
  if (integrationsConfig.streamDeck.enabled) startStreamDeckListener();
  startMcpListener();
  registerSubscriptionHandlers(win);
  registerCalendarHandlers();
  registerStorefrontHandlers();
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
  // Guarded on app-ready (startupQuit.ts, issue #1352): globalShortcut throws
  // before ready, and the throw aborts the rest of the will-quit emit chain.
  // Under electronmon's kill sequence that skipped later listener is its
  // app.exit(signal), so the "killed" app resumed startup and kept the
  // single-instance lock and the 7892 port. Before ready nothing can be
  // registered (hotkeys register via renderer IPC), so skipping loses nothing.
  if (!shouldUnregisterShortcutsOnQuit(app.isReady())) {
    logStartup('will-quit: globalShortcut teardown skipped (app not ready)');
    return;
  }
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // On macOS the app stays alive in the tray; the user can reopen from there or the dock.
  //
  // The didCreateMainWindow guard is critical on Windows/Linux: startup runs
  // migrateFileToAppStorage() BEFORE the main window is created, and that
  // migration briefly opens then destroys hidden BrowserWindows (the file://
  // localStorage reader/writer). Destroying the last of those fires
  // window-all-closed while zero real windows exist yet — without the guard we
  // would app.quit() mid-startup and the process would exit before ever showing
  // a window (the app installed but "never launched"). macOS was unaffected only
  // because this branch is darwin-exempt. Once the main window has been created,
  // a genuine all-windows-closed on Windows/Linux still quits as intended.
  if (shouldQuitOnAllWindowsClosed(process.platform, didCreateMainWindow)) {
    logStartup('window-all-closed → app.quit()');
    app.quit();
  }
});
