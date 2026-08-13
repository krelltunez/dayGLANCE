// The impure half of the "Set up Claude Desktop" button: read Claude
// Desktop's config, back it up, merge the dayglance entry (pure logic in
// mcpDesktopConfig.ts), write it back. Direct-download builds only.
//
// §7 COMPILE-OUT: this module and mcpDesktopConfig.ts are EXCLUDED from MAS
// packaging by the electron-builder mas.files filter, and main.ts loads this
// module dynamically so its absence is a structural no-op. Do not import
// either module statically from anything that ships on MAS, and keep every
// piece of Claude-Desktop-setup knowledge inside these two files.
//
// scripts/verify-mas-compileout.mjs asserts both absences (and the button
// string's absence) against the BUILT artifact.

import { ipcMain } from 'electron';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { homedir } from 'node:os';
import { claudeConfigPath, bridgeEntry, mergeClaudeConfig, manualEntrySnippet } from './mcpDesktopConfig.js';

export function registerMcpDesktopSetup(): void {
  ipcMain.handle('mcp-setup:claude-desktop', () => {
    const path = claudeConfigPath(process.platform, process.env, homedir());
    const entry = bridgeEntry(process.execPath, process.resourcesPath);
    if (!path) {
      return { ok: false, reason: 'unsupported_platform', manualEntry: manualEntrySnippet(entry) };
    }

    let existingText: string | null = null;
    try {
      existingText = readFileSync(path, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { ok: false, reason: 'unreadable', path, error: String((err as Error).message), manualEntry: manualEntrySnippet(entry) };
      }
    }

    const merged = mergeClaudeConfig(existingText, entry);
    if (merged.action === 'unparseable') {
      // NEVER overwrite a file we cannot parse: the user may have (broken)
      // hand-edits worth keeping, and Claude Desktop itself rewrites this
      // file when it dislikes an entry. Report and hand over the snippet.
      return { ok: false, reason: 'unparseable', path, manualEntry: manualEntrySnippet(entry) };
    }

    try {
      mkdirSync(dirname(path), { recursive: true });
      let backupPath: string | null = null;
      if (existingText !== null) {
        backupPath = `${path}.bak-dayglance-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        copyFileSync(path, backupPath);
      }
      writeFileSync(path, merged.text);
      return { ok: true, action: merged.action, path, backupPath };
    } catch (err) {
      return { ok: false, reason: 'write_failed', path, error: String((err as Error).message), manualEntry: manualEntrySnippet(entry) };
    }
  });
}
