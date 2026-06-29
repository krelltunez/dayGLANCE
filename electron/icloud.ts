import { ipcMain, app, BrowserWindow } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── iCloud sync (macOS) ─────────────────────────────────────────────────────
//
// Reads/writes dayglance-sync.json and supplemental intent files in the shared
// iCloud ubiquitous container, also used by the iOS app.
//
// Container location is resolved two ways:
//   1. Sandboxed Mac App Store build — $HOME points inside the sandbox container
//      and can never reach Mobile Documents, so a tiny signed Swift helper calls
//      NSFileManager.url(forUbiquityContainerIdentifier:) and returns the real path.
//   2. Unsandboxed Developer ID build — no iCloud entitlement (by design), so the
//      helper returns null and we fall back to the plain $HOME-relative path, which
//      is correct and unchanged from the prior behavior.
//
// ICLOUD_CONTAINER_DOTTED must match the iCloud-prefixed entitlement value
// (com.apple.developer.icloud-container-identifiers). ICLOUD_CONTAINER_FOLDER is
// the on-disk folder spelling (dots → tildes) used for the fallback path. Update
// both here and in the entitlement files if the container ID changes.
const ICLOUD_CONTAINER_DOTTED = 'iCloud.com.dayglance';
const ICLOUD_CONTAINER_FOLDER = 'iCloud~com~dayglance';
const SYNC_FILE = 'dayglance-sync.json';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELPER_NAME = 'dayglance-icloud-helper';

// Resolves the helper path: bundled under Contents/Resources/icloud-helper in
// packaged builds (electron-builder extraResources), or the local build output in dev.
function helperPath(): string | null {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'icloud-helper', HELPER_NAME)
    : path.join(__dirname, '..', 'electron', 'native', 'icloud-helper', 'build', HELPER_NAME);
  return fs.existsSync(candidate) ? candidate : null;
}

function runHelper(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bin = helperPath();
    if (!bin) { reject(new Error('icloud helper not found')); return; }
    execFile(bin, args, { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) { reject(err); return; }
      try { resolve(JSON.parse(stdout.toString().trim() || 'null')); }
      catch (e) { reject(e); }
    });
  });
}

// $HOME-relative Documents dir — correct for the unsandboxed Developer ID build.
function fallbackDocumentsDir(): string {
  return path.join(
    app.getPath('home'),
    `Library/Mobile Documents/${ICLOUD_CONTAINER_FOLDER}/Documents`
  );
}

// Resolve the container's Documents dir, preferring the helper (sandbox-correct)
// and caching the first success. On failure we return the $HOME fallback without
// caching, so a transient helper error (e.g. iCloud still signing in) is retried.
let cachedDocumentsDir: string | null = null;
async function iCloudDocumentsDir(): Promise<string> {
  if (cachedDocumentsDir) return cachedDocumentsDir;
  try {
    const res = await runHelper(['container', ICLOUD_CONTAINER_DOTTED]) as { url?: string | null } | null;
    if (res?.url) {
      cachedDocumentsDir = path.join(res.url, 'Documents');
      return cachedDocumentsDir;
    }
  } catch { /* helper missing or iCloud unavailable — fall back */ }
  return fallbackDocumentsDir();
}

async function syncFilePath(): Promise<string> {
  return path.join(await iCloudDocumentsDir(), SYNC_FILE);
}

// Track our own writes so the fs.watch callback can ignore them.
let lastMacOSWriteTime = 0;
// 2s suppression: enough to absorb iCloud daemon's self-echo round-trip
// without blocking legitimate remote writes. The 1s fs.watch debounce sits
// inside this window, so the effective minimum gap between a local write and
// a recognized remote write is 2s.
const ICLOUD_WRITE_SUPPRESSION_MS = 2000;

export function registerICloudHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('icloud:read', async () => {
    if (process.platform !== 'darwin') return null;
    try {
      const filePath = await syncFilePath();
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      // iCloud daemon stores cloud-only files as hidden .filename.icloud placeholders.
      // Detect this case and tell JS to wait rather than treating it as "no remote file".
      if (!fs.existsSync(filePath)) {
        if (fs.existsSync(path.join(dir, '.' + base + '.icloud'))) {
          return JSON.stringify({ downloading: true });
        }
        return null;
      }
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e: unknown) {
      // Return a structured error so the renderer can distinguish "iCloud not
      // available / not signed in" from "no remote file yet" (null).
      const msg = e instanceof Error ? e.message : String(e);
      return JSON.stringify({ error: msg });
    }
  });

  ipcMain.handle('icloud:write', async (_event, json: string) => {
    if (process.platform !== 'darwin') return false;
    try {
      const filePath = await syncFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Write in-place rather than using a temp-file + rename.
      // rename(2) replaces the destination inode, stripping the iCloud extended
      // attributes that bird attached when it last downloaded the file. Without
      // those xattrs bird does not recognise the file as needing re-upload.
      // Writing to the existing fd preserves the inode (and all xattrs) so bird
      // sees a normal modification event and queues the upload.
      fs.writeFileSync(filePath, json, { encoding: 'utf-8' });
      lastMacOSWriteTime = Date.now();
      return true;
    } catch { return false; }
  });

  // iCloud file operations — intents and multi-user sync (supplemental to WebDAV).
  // All paths are relative to Documents/ inside the iCloud container.
  ipcMain.handle('icloud:list-files', async (_event, relativePath: string) => {
    if (process.platform !== 'darwin') return [];
    try {
      const dirPath = path.join(await iCloudDocumentsDir(), relativePath);
      if (!fs.existsSync(dirPath)) return [];
      return fs.readdirSync(dirPath)
        .filter(name => !name.startsWith('.') && name.endsWith('.json'));
    } catch { return []; }
  });

  ipcMain.handle('icloud:read-file', async (_event, relativePath: string) => {
    if (process.platform !== 'darwin') return null;
    try {
      const filePath = path.join(await iCloudDocumentsDir(), relativePath);
      const dir = path.dirname(filePath);
      const base = path.basename(filePath);
      if (!fs.existsSync(filePath)) {
        if (fs.existsSync(path.join(dir, '.' + base + '.icloud'))) {
          return JSON.stringify({ downloading: true });
        }
        return null;
      }
      return fs.readFileSync(filePath, 'utf-8');
    } catch { return null; }
  });

  ipcMain.handle('icloud:write-file', async (_event, relativePath: string, content: string) => {
    if (process.platform !== 'darwin') return false;
    try {
      const filePath = path.join(await iCloudDocumentsDir(), relativePath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // Write in-place (not rename) to preserve iCloud xattrs so bird queues the upload.
      fs.writeFileSync(filePath, content, { encoding: 'utf-8' });
      return true;
    } catch { return false; }
  });

  ipcMain.handle('icloud:delete-file', async (_event, relativePath: string) => {
    if (process.platform !== 'darwin') return true;
    try {
      const filePath = path.join(await iCloudDocumentsDir(), relativePath);
      fs.unlinkSync(filePath);
      return true;
    } catch (e: unknown) {
      if (e instanceof Error && (e as NodeJS.ErrnoException).code === 'ENOENT') return true;
      return false;
    }
  });

  ipcMain.handle('icloud:make-dir', async (_event, relativePath: string) => {
    if (process.platform !== 'darwin') return false;
    try {
      const dirPath = path.join(await iCloudDocumentsDir(), relativePath);
      fs.mkdirSync(dirPath, { recursive: true });
      return true;
    } catch { return false; }
  });

  if (process.platform === 'darwin') startICloudWatch(getWindow);
}

// Watch the iCloud container directory for changes written by the iOS app.
// Sends 'icloud:changed' to the renderer so it can run a sync cycle immediately
// instead of waiting for the 15-second poll.
async function startICloudWatch(getWindow: () => BrowserWindow | null): Promise<void> {
  const syncPath = await syncFilePath();
  const dir = path.dirname(syncPath);
  const file = path.basename(syncPath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}

  let debounce: ReturnType<typeof setTimeout> | null = null;

  // Re-attachable watcher: iCloud daemon can recreate the directory (e.g. on
  // Sonoma+), which kills the watcher silently. Re-attach on error or close.
  const attach = () => {
    try {
      const watcher = fs.watch(dir, (_eventType, filename) => {
        if (filename !== file) return;
        if (Date.now() - lastMacOSWriteTime < ICLOUD_WRITE_SUPPRESSION_MS) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => {
          try {
            if (!fs.existsSync(syncPath)) return;
            const content = fs.readFileSync(syncPath, 'utf-8');
            const win = getWindow();
            win?.webContents.send('icloud:changed', content);
          } catch {}
        }, 1000);
      });
      watcher.on('error', () => setTimeout(attach, 5000));
      watcher.on('close', () => setTimeout(attach, 5000));
    } catch {
      setTimeout(attach, 5000);
    }
  };

  attach();
}
