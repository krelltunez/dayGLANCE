// Lightweight startup logger — a support aid for diagnosing desktop launch
// problems that only reproduce on a user's machine (the Windows "installs but
// never launches" class of bug). It appends timestamped milestones and any
// load/crash events to a small, bounded file in userData so a user can send it
// after a bad launch. Best-effort throughout: logging must NEVER throw into the
// startup path, so every fs call is guarded.
//
// The pure file bookkeeping lives here (no electron import) so it is unit
// testable; main.ts injects the userData directory and wires the electron event
// milestones.

import fs from 'node:fs';
import path from 'node:path';

export const STARTUP_LOG_FILENAME = 'dayglance-startup.log';

// Keep the file tiny — it's a rolling record of recent launches, not a full
// trace. When the existing log exceeds this, it's dropped on the next init so it
// can never grow without bound across launches.
export const MAX_LOG_BYTES = 256 * 1024;

let logPath: string | null = null;

function stamp(): string {
  // new Date() is fine in app code (unlike workflow scripts); wrapped so a
  // hypothetical environment quirk can't break logging.
  try { return new Date().toISOString(); } catch { return '?'; }
}

/**
 * Point the logger at <userDataDir>/dayglance-startup.log and open a new session
 * section. Preserves prior contents unless the file has grown past MAX_LOG_BYTES,
 * in which case it starts fresh. Returns the resolved path (or null on failure).
 */
export function initStartupLog(userDataDir: string): string | null {
  try {
    const target = path.join(userDataDir, STARTUP_LOG_FILENAME);
    let prior = '';
    try {
      if (fs.statSync(target).size <= MAX_LOG_BYTES) {
        prior = fs.readFileSync(target, 'utf-8');
      }
      // Oversized → drop it; `prior` stays empty so we start clean.
    } catch { /* no existing log — first run */ }
    const header = `\n===== session ${stamp()} platform=${process.platform} pid=${process.pid} =====\n`;
    fs.writeFileSync(target, prior + header);
    logPath = target;
    return logPath;
  } catch {
    logPath = null;
    return null;
  }
}

/** Append one timestamped line. No-op until initStartupLog has run. */
export function logStartup(message: string): void {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, `[${stamp()}] ${message}\n`);
  } catch { /* best-effort — never break startup */ }
}

/** The active log path, or null if logging isn't initialized. */
export function startupLogPath(): string | null {
  return logPath;
}

// Test-only: reset module state between cases.
export function __resetStartupLogForTests(): void {
  logPath = null;
}
