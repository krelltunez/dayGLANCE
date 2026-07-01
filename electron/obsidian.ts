import { ipcMain, app, dialog, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

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
    if (process.platform !== 'darwin') return null;
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
    return { path: dir, name: path.basename(dir) };
  });

  // Re-open a previously-picked vault on launch. Resolves the stored bookmark and
  // begins access. Returns { path, name } or null if nothing is configured.
  ipcMain.handle('obsidian:restore', async () => {
    if (process.platform !== 'darwin') return null;
    const cfg = loadConfig();
    if (!cfg) return null;
    vaultBasePath = cfg.path;
    beginAccess(cfg.bookmark);
    return { path: cfg.path, name: path.basename(cfg.path) };
  });

  ipcMain.handle('obsidian:disconnect', async () => {
    if (stopAccessing) { try { stopAccessing(); } catch { /* ignore */ } stopAccessing = null; }
    vaultBasePath = null;
    clearConfig();
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
  ipcMain.handle('obsidian:write-file', async (_e, relativePath: string, content: string) => {
    const abs = resolveInVault(relativePath);
    if (!abs) return false;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, 'utf-8');
      return true;
    } catch { return false; }
  });
}
