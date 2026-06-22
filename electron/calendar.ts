import { ipcMain, app } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── macOS native calendar (EventKit) ───────────────────────────────────────────
//
// Read-only access to the system Calendar via a signed Swift helper binary
// (electron/native/calendar-helper). The helper emits JSON identical to the
// mobile DayGlanceNative bridge so the renderer reuses nativeEventToTask unchanged.
//
// All handlers no-op (empty/false) on non-macOS platforms and when the helper
// binary is missing, so Windows/Linux Electron and dev builds without the helper
// degrade gracefully to URL/CalDAV subscriptions.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HELPER_NAME = 'dayglance-calendar-helper';

// Resolves the helper path: bundled under Contents/Resources/calendar-helper in
// packaged builds (electron-builder extraResources), or the local build output in dev.
function helperPath(): string | null {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'calendar-helper', HELPER_NAME)]
    : [path.join(__dirname, '..', 'electron', 'native', 'calendar-helper', 'build', HELPER_NAME)];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function calendarSupported(): boolean {
  return process.platform === 'darwin' && helperPath() !== null;
}

// Spawns the helper with the given args and resolves its parsed JSON stdout.
// Rejects are swallowed by callers into safe empty defaults.
function runHelper(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bin = helperPath();
    if (!bin) { reject(new Error('calendar helper not found')); return; }
    execFile(bin, args, { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => {
      if (err) { reject(err); return; }
      try {
        resolve(JSON.parse(stdout.toString().trim() || 'null'));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function registerCalendarHandlers(): void {
  ipcMain.handle('calendar:request-access', async () => {
    if (!calendarSupported()) return { granted: false };
    try {
      const res = await runHelper(['request-access']) as { granted?: boolean } | null;
      return { granted: !!res?.granted };
    } catch {
      return { granted: false };
    }
  });

  ipcMain.handle('calendar:get-calendars', async () => {
    if (!calendarSupported()) return [];
    try {
      const res = await runHelper(['calendars']);
      return Array.isArray(res) ? res : [];
    } catch {
      return [];
    }
  });

  // Returns a per-day map { "YYYY-MM-DD": Event[] } inclusive of [startDate, endDate].
  ipcMain.handle('calendar:get-events', async (_event, startDate: string, endDate: string) => {
    if (!calendarSupported()) return {};
    if (typeof startDate !== 'string' || typeof endDate !== 'string') return {};
    try {
      const res = await runHelper(['events', '--start', startDate, '--end', endDate]);
      return (res && typeof res === 'object' && !Array.isArray(res)) ? res : {};
    } catch {
      return {};
    }
  });
}
