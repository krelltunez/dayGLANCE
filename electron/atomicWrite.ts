/**
 * Atomic file replacement for vault writes.
 *
 * The obsidian:write-file handler was a bare fs.writeFileSync — open with
 * O_TRUNC, then write. A crash (or power loss) between the truncate and the
 * completed write leaves the file PARTIAL OR EMPTY, and the renderer-side
 * Electron vault shim presents an FSA-like createWritable() surface, which on
 * the real File System Access API IS atomic (swap file, commit on close) — so
 * callers reasonably assume a safety this path never had. A truncated daily
 * note is user data loss; this module closes that gap.
 *
 * Recipe: write the full content to a temp file in the SAME directory
 * (same-volume, so the rename is a rename and not a copy), fsync it so the
 * rename cannot be reordered ahead of the data reaching disk, then rename over
 * the target — atomic on POSIX; on Windows Node uses MoveFileEx with
 * replace-existing, which is the platform's standard best effort. On any
 * failure the temp file is unlinked and the original is left untouched.
 *
 * The temp name is dot-prefixed: Obsidian ignores hidden files, so neither the
 * vault indexer nor Obsidian Sync ever sees the intermediate file.
 *
 * Syscalls are wrapped in retryTransientFs — vaults live in synced folders
 * (iCloud Drive included), where EINTR interruptions are the same observed
 * hazard fsRetry.ts documents for the iCloud container.
 */

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { retryTransientFs } from './fsRetry.js';

/** Write `content` to `abs`, replacing any existing file atomically. Throws on failure. */
export function writeFileAtomicSync(abs: string, content: string): void {
  const dir = path.dirname(abs);
  const tmp = path.join(
    dir,
    `.${path.basename(abs)}.dgtmp-${process.pid.toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
  );
  let fd: number | null = null;
  try {
    fd = retryTransientFs(() => fs.openSync(tmp, 'w'));
    retryTransientFs(() => fs.writeFileSync(fd as number, content, 'utf-8'));
    retryTransientFs(() => fs.fsyncSync(fd as number));
    fs.closeSync(fd);
    fd = null;
    retryTransientFs(() => fs.renameSync(tmp, abs));
  } catch (err) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed or invalid */ }
    }
    try { fs.unlinkSync(tmp); } catch { /* nothing staged, or already renamed */ }
    throw err;
  }
}
