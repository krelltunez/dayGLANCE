// Main→renderer request/response channel for MCP reads (spec §10 Phase 2),
// with the §3.3 health check built into every call.
//
// HEALTH CHECK, NOT EXISTENCE CHECK: a crashed renderer leaves a mainWindow
// object that live() still considers healthy — isDestroyed() does not catch a
// dead render process (render-process-gone only logs; see main.ts). So no
// answer within the timeout means UNAVAILABLE, regardless of what the window
// object claims. The renderer answers synchronously inside its IPC callback
// (no React render round-trip — see useMcpBridge.js), so the timeout can be
// short: an alive renderer replies in single-digit milliseconds even while
// hidden and background-throttled, because IPC delivery is not a timer.
//
// TRAY GUARD: requests are only ever sent to the main window's webContents,
// and responses from ANY other sender are dropped here — so the tray popup
// (which runs the same App tree on a stale snapshot) can never answer even if
// its renderer were subscribed. Same posture as the tray:data-changed guard.

import { BrowserWindow, ipcMain } from 'electron';

/** One-second ping ceiling: ~100x the expected reply latency of a live renderer. */
export const PING_TIMEOUT_MS = 1000;
/** Data requests get headroom for a large day payload or a GC pause. */
export const REQUEST_TIMEOUT_MS = 3000;

export type RendererResult =
  | { ok: true; data: unknown; undo?: unknown }
  | { ok: false; error: { code: string; message: string } };

const UNAVAILABLE: RendererResult = {
  ok: false,
  error: {
    code: 'renderer_unavailable',
    message:
      'The dayGLANCE window is not responding (it may have crashed or be restarting). ' +
      'Data is temporarily unreadable — this is NOT an empty schedule. Retry shortly.',
  },
};

export interface RendererBridge {
  /** Send one request; resolves with the renderer's answer or a typed unavailable error. Never rejects, never hangs. */
  request(method: string, params?: unknown, timeoutMs?: number): Promise<RendererResult>;
  /** The §3.3 health check: cheap, short-timeout round trip. */
  ping(): Promise<boolean>;
  dispose(): void;
}

/**
 * Accepts a getter (never a captured window reference) for the same reason
 * ws-server.ts does: the main window can be recreated, and requests must
 * always target the current one.
 */
export function createRendererBridge(getMainWindow: () => BrowserWindow | null): RendererBridge {
  let nextId = 1;
  const pending = new Map<number, { resolve: (r: RendererResult) => void; timer: NodeJS.Timeout }>();

  const onResponse = (event: Electron.IpcMainEvent, raw: unknown): void => {
    // Only the main window may answer. A response from the tray popup (or any
    // future window) is dropped unanswered; the request then times out to
    // unavailable rather than being served from a stale snapshot.
    const mw = getMainWindow();
    if (!mw || event.sender !== mw.webContents) return;

    const response = raw as { id?: unknown; ok?: unknown; data?: unknown; undo?: unknown; error?: unknown };
    if (typeof response?.id !== 'number') return;
    const entry = pending.get(response.id);
    if (!entry) return; // late reply after timeout — already answered unavailable
    pending.delete(response.id);
    clearTimeout(entry.timer);

    if (response.ok === true) {
      // `undo` is the §4.3 journal descriptor for writes — main-process-only
      // metadata, threaded alongside `data` so it never reaches tool output.
      entry.resolve({ ok: true, data: response.data, ...(response.undo !== undefined ? { undo: response.undo } : {}) });
    } else {
      const err = (response.error ?? {}) as { code?: unknown; message?: unknown };
      entry.resolve({
        ok: false,
        error: {
          code: typeof err.code === 'string' ? err.code : 'internal',
          message: typeof err.message === 'string' ? err.message : 'Renderer reported an error',
        },
      });
    }
  };
  ipcMain.on('mcp:response', onResponse);

  const request = (method: string, params: unknown = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<RendererResult> => {
    const mw = getMainWindow();
    if (!mw) return Promise.resolve(UNAVAILABLE);

    return new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(UNAVAILABLE);
      }, timeoutMs);
      pending.set(id, { resolve, timer });
      try {
        mw.webContents.send('mcp:request', { id, method, params });
      } catch {
        // A destroyed webContents throws synchronously — same verdict.
        pending.delete(id);
        clearTimeout(timer);
        resolve(UNAVAILABLE);
      }
    });
  };

  return {
    request,
    ping: async () => (await request('ping', {}, PING_TIMEOUT_MS)).ok,
    dispose: () => {
      ipcMain.removeListener('mcp:response', onResponse);
      for (const [id, entry] of pending) {
        clearTimeout(entry.timer);
        entry.resolve(UNAVAILABLE);
        pending.delete(id);
      }
    },
  };
}
