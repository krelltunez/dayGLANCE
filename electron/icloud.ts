import { ipcMain, app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

// ── iCloud sync (macOS) ─────────────────────────────────────────────────────
//
// Reads/writes dayglance-sync.json and supplemental intent files in the shared
// iCloud ubiquitous container, also used by the iOS app.
//
// Container resolution: the iCloud container lives at the real
// ~/Library/Mobile Documents/iCloud~com~dayglance/. Under the Mac App Store
// sandbox, app.getPath('home') is the app's private container Data dir, so we
// strip the container suffix to recover the real home (a no-op on the unsandboxed
// Developer ID build, where it's already the real home). The MAIN process holds
// the com.apple.developer.icloud-container-identifiers entitlement, so the sandbox
// grants it access to that path.
//
// Why not NSFileManager.url(forUbiquityContainerIdentifier:) via a helper: that API
// only returns a path to a process carrying the iCloud *developer* entitlement, and
// a spawned helper signed with app-sandbox+inherit doesn't have it — developer
// entitlements don't propagate through `inherit` the way the calendar TCC permission
// does. Resolving in-process (where the entitlement lives) is correct and simpler.
//
// ICLOUD_CONTAINER_FOLDER is the on-disk folder spelling (dots → tildes). Update it
// and the entitlement files together if the container ID changes.
const ICLOUD_CONTAINER_FOLDER = 'iCloud~com~dayglance';
const SYNC_FILE = 'dayglance-sync.json';

// The real home directory, recovered from the sandbox-redirected container path.
function realHomeDir(): string {
  return app.getPath('home').replace(/\/Library\/Containers\/[^/]+\/Data$/, '');
}

function iCloudDocumentsDir(): string {
  return path.join(realHomeDir(), `Library/Mobile Documents/${ICLOUD_CONTAINER_FOLDER}/Documents`);
}

function syncFilePath(): string {
  return path.join(iCloudDocumentsDir(), SYNC_FILE);
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
