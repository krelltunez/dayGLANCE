import { ipcMain, app, dialog, shell, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { buildObsidianOpenUri, buildObsidianOpenPathUri } from './obsidianUri.js';
import { createLaunchScheduler } from './obsidianLaunch.js';

// ── Obsidian vault access (Electron) ─────────────────────────────────────────
//
// The renderer's Obsidian integration (src/obsidian.js) is built on the browser
// File System Access API (showDirectoryPicker + a persisted directory handle).
// That works in the browser and in the unsandboxed Developer ID build, but under
// the Mac App Store sandbox a restored handle can't re-establish filesystem
// access after relaunch — Electron's FS Access layer does not create/resolve
// macOS security-scoped bookmarks. The symptom is a vault that shows "connected"
// but fails every write with "…could not be modified due to the state of the
// underlying filesystem".
//
// So on Electron we pick the folder with the NATIVE dialog (securityScopedBookmarks),
// persist the returned bookmark, and on each launch call
// app.startAccessingSecurityScopedResource() to regain access. All file I/O then
// runs here in the main process — the process that actually holds the sandbox
// grant. The renderer drives it through a thin handle shim
// (src/obsidianElectronHandle.js) that mirrors the FS Access surface it already uses.
//
// Requires the com.apple.security.files.bookmarks.app-scope entitlement (MAS).

interface VaultConfig { path: string; bookmark?: string; }

let vaultBasePath: string | null = null;
let stopAccessing: (() => void) | null = null;

// Launch-on-write (Obsidian build-out Phase 1): after a debounced quiet window
// following vault writes, open the last-written file so Obsidian Sync pushes
// the change. Fed by the obsidian:write-file handler below — the single funnel
// every desktop write path runs through. The scheduler starts DISABLED and
// stays so until the renderer pushes the device-local toggle over
// obsidian:set-launch-on-write, so no launch can fire ahead of the user's
// stored setting.
const launchScheduler = createLaunchScheduler((absPath) => {
  const uri = buildObsidianOpenPathUri(absPath);
  if (!uri) return;
  // activate: false is macOS-only (ignored elsewhere): the launch goes through
  // LaunchServices without taking focus, App Store sandbox included. Failures
  // stay silent BY DESIGN — on Linux the obsidian:// handler is frequently
  // unregistered (AppImage installs), and the vault write already succeeded;
  // only the wake didn't. No error state, no toast.
  shell.openExternal(uri, { activate: false }).catch(() => { /* ignore */ });
});

function configPath(): string {
  return path.join(app.getPath('userData'), 'obsidian-vault.json');
}

function loadConfig(): VaultConfig | null {
  try {
    const cfg = JSON.parse(fs.readFileSync(configPath(), 'utf-8')) as VaultConfig;
    return cfg && typeof cfg.path === 'string' ? cfg : null;
  } catch { return null; }
}

function saveConfig(cfg: VaultConfig): void {
  try { fs.writeFileSync(configPath(), JSON.stringify(cfg)); } catch { /* ignore */ }
}

function clearConfig(): void {
  try { fs.unlinkSync(configPath()); } catch { /* ignore */ }
}

// Begin security-scoped access for a bookmark (MAS). Releases any prior access
// first. No-op when there's no bookmark (unsandboxed Developer ID build — direct
// filesystem access needs no scope), or when the API is unavailable.
function beginAccess(bookmark: string | undefined): void {
  if (stopAccessing) { try { stopAccessing(); } catch { /* ignore */ } stopAccessing = null; }
  if (bookmark && typeof app.startAccessingSecurityScopedResource === 'function') {
    try { stopAccessing = app.startAccessingSecurityScopedResource(bookmark) as () => void; }
    catch { stopAccessing = null; }
  }
}

// Resolve a vault-relative path to an absolute one, refusing anything that would
// escape the vault root (defense-in-depth; the renderer already sanitizes segments).
function resolveInVault(relativePath: string): string | null {
  if (!vaultBasePath) return null;
  const abs = path.resolve(vaultBasePath, relativePath || '.');
  const rel = path.relative(vaultBasePath, abs);
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return abs;
}

export function registerObsidianHandlers(): void {
  // Native folder picker. Returns { path, name } and persists the security-scoped
  // bookmark so access survives relaunch. null if the user cancels.
  ipcMain.handle('obsidian:pick', async (event) => {
    const opts = {
      properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
      securityScopedBookmarks: true,
      message: 'Select your Obsidian vault folder',
    };
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0];
    const bookmark = result.bookmarks?.[0];
    saveConfig({ path: dir, bookmark });
    vaultBasePath = dir;
    beginAccess(bookmark);
    // A pending launch would point into the vault just swapped away from.
    launchScheduler.cancelPending();
    return { path: dir, name: path.basename(dir) };
  });

  // Re-open a previously-picked vault on launch. Resolves the stored bookmark
  // (macOS) and begins access. Returns { path, name } or null if nothing is
  // configured — null is the same signal the renderer already treats as
  // "not connected", so the Settings UI falls back to the Select Vault button.
  ipcMain.handle('obsidian:restore', async () => {
    const cfg = loadConfig();
    if (!cfg) return null;
    // Off-macOS there is no bookmark to fail at resolve time, so a vault on a
    // removed drive, unmounted share, or remapped drive letter would restore
    // "successfully" and then throw on the first fs call at write time.
    // Check reachability here instead and fail the restore cleanly (config is
    // kept, matching macOS stale-bookmark behavior — a re-pick overwrites it).
    if (process.platform !== 'darwin') {
      try {
        fs.accessSync(cfg.path, fs.constants.R_OK);
        if (!fs.statSync(cfg.path).isDirectory()) return null;
      } catch {
        return null;
      }
    }
    vaultBasePath = cfg.path;
    beginAccess(cfg.bookmark);
    return { path: cfg.path, name: path.basename(cfg.path) };
  });

  // Opens a vault note in the Obsidian app.
  //
  // The renderer cannot do this itself: window.open('obsidian://…') is caught by
  // setWindowOpenHandler and dropped by openExternalSafe, which only permits
  // http/https so a renderer compromise can't launch arbitrary schemes. Keeping
  // that allowlist intact, the renderer sends only a note NAME and the URL is
  // built here from the vault path we already hold — which is also the only
  // place the real vault name exists (the renderer's handle shim reports the
  // placeholder 'vault').
  ipcMain.handle('obsidian:open-note', async (_event, noteName: unknown) => {
    if (typeof noteName !== 'string') return false;
    const cfg = loadConfig();
    if (!cfg?.path) return false;
    const uri = buildObsidianOpenUri(path.basename(cfg.path), noteName);
    if (!uri) return false;
    try {
      await shell.openExternal(uri);
      return true;
    } catch {
      // Obsidian not installed, or no handler registered for the scheme.
      return false;
    }
  });

  ipcMain.handle('obsidian:disconnect', async () => {
    if (stopAccessing) { try { stopAccessing(); } catch { /* ignore */ } stopAccessing = null; }
    vaultBasePath = null;
    clearConfig();
    // Pending only, not the enabled flag: the toggle is the user's setting and
    // survives a vault swap — a write into a newly picked vault schedules again.
    launchScheduler.cancelPending();
    return true;
  });

  // The renderer pushes the device-local launch-on-write setting here at
  // startup and on every toggle change. Boolean only — the renderer never
  // supplies a URI or path, so the http/https-only external-URL allowlist
  // documented at obsidian:open-note keeps its security property.
  ipcMain.handle('obsidian:set-launch-on-write', async (_e, enabled: unknown) => {
    launchScheduler.setEnabled(enabled === true);
    return true;
  });

  // Stat a vault-relative path → { kind: 'file' | 'directory' } or null if missing.
  ipcMain.handle('obsidian:stat', async (_e, relativePath: string) => {
    const abs = resolveInVault(relativePath);
    if (!abs) return null;
    try {
      const st = fs.statSync(abs);
      return { kind: st.isDirectory() ? 'directory' : 'file' };
    } catch { return null; }
  });

  // List a directory → [{ name, kind }]. Empty array if missing/unreadable.
  ipcMain.handle('obsidian:list-dir', async (_e, relativePath: string) => {
    const abs = resolveInVault(relativePath);
    if (!abs) return [];
    try {
      return fs.readdirSync(abs, { withFileTypes: true })
        .map((d) => ({ name: d.name, kind: d.isDirectory() ? 'directory' : 'file' }));
    } catch { return []; }
  });

  // Read a file → { text, lastModified } or { notFound: true }.
  ipcMain.handle('obsidian:read-file', async (_e, relativePath: string) => {
    const abs = resolveInVault(relativePath);
    if (!abs) return { notFound: true };
    try {
      const text = fs.readFileSync(abs, 'utf-8');
      return { text, lastModified: fs.statSync(abs).mtimeMs };
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { notFound: true };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { error: msg };
    }
  });

  // Write a file (creating parent directories). Returns true on success.
  // Post-write chokepoint: every desktop vault write — daily notes, task
  // write-back, wiki notes — reaches disk through this handler (via the shim's
  // createWritable().close()), so launch-on-write hooks here and nowhere else.
  ipcMain.handle('obsidian:write-file', async (_e, relativePath: string, content: string) => {
    const abs = resolveInVault(relativePath);
    if (!abs) return false;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf-8');
      launchScheduler.noteWrite(abs);
      return true;
    } catch { return false; }
  });

  // A pending launch at quit fires immediately rather than being dropped:
  // editing a task and closing the app inside the quiet window is a normal
  // pattern, and dropping the launch would leave that edit unpushed until the
  // next write. openExternal is fire-and-forget here (no await, no
  // preventDefault), so quit is not delayed.
  app.on('will-quit', () => { launchScheduler.flush(); });
}
