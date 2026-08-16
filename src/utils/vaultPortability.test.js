import { describe, it, expect } from 'vitest';
import { unportableEntryReason, classifyVaultPaths, isHiddenName } from './vaultPortability.js';

// The audit-side twin of the creation gate (obsidianFilename.js, PR #1357):
// existing vault names classified against the same portability union, for the
// read-only Settings -> Obsidian listing (issue #1358). The union: the
// character set [ ] # ^ | * " \ / : ? < >, control characters, leading dot,
// trailing dot or space including before the extension, and Windows reserved
// device names case-insensitively, with or without an extension.

describe('unportableEntryReason: the union rules on file names', () => {
  it('flags every refused character', () => {
    for (const name of [
      'plan [draft].md', 'notes#1.md', 'block^ref.md', 'a|b.md', 'star*.md',
      'quo"te.md', 'back\\slash.md', 'sla/sh.md', 'co:lon.md', 'what?.md',
      'le<ss.md', 'gr>eater.md',
    ]) {
      expect(unportableEntryReason(name, 'file'), name).toBeTruthy();
    }
  });

  it('flags control characters', () => {
    expect(unportableEntryReason('bad\x07name.md', 'file')).toMatch(/control character/);
  });

  it('flags Windows reserved device names, case-insensitive, with or without extensions', () => {
    expect(unportableEntryReason('CON.md', 'file')).toMatch(/reserved device name/);
    expect(unportableEntryReason('con.md', 'file')).toMatch(/reserved device name/);
    expect(unportableEntryReason('COM3.md', 'file')).toMatch(/reserved device name/);
    expect(unportableEntryReason('LPT9.backup.md', 'file')).toMatch(/reserved device name/);
    expect(unportableEntryReason('aux', 'directory')).toMatch(/reserved device name/);
  });

  it('flags a trailing dot or space on the full name (extensionless files)', () => {
    expect(unportableEntryReason('notes ', 'file')).toMatch(/space/);
    expect(unportableEntryReason('notes.', 'file')).toMatch(/dot/);
  });

  it('flags a trailing dot or space BEFORE the extension', () => {
    expect(unportableEntryReason('Meeting notes .md', 'file')).toMatch(/space just before its extension/);
    expect(unportableEntryReason('notes..md', 'file')).toMatch(/dot just before its extension/);
    // Multi-dot names must derive the stem from the LAST dot: resolving at
    // the first dot would call the stem "Draft v1" and miss the space.
    expect(unportableEntryReason('Draft v1.2 .md', 'file')).toMatch(/space just before its extension/);
    // Attachments sync too; the rule is not .md-specific.
    expect(unportableEntryReason('screenshot .png', 'file')).toMatch(/space just before its extension/);
  });

  it('flags unportable directory names (the folder poisons every path under it)', () => {
    expect(unportableEntryReason('Projects?', 'directory')).toBeTruthy();
    expect(unportableEntryReason('2026: plans', 'directory')).toBeTruthy();
  });

  it('accepts ordinary portable names', () => {
    for (const name of [
      'Plan.md', 'Résumé.md', 'foo-bar (draft).md', 'a.b.md', '2026-08-16.md',
      'CONTINUE.md', 'constants.md', 'notes.png', 'Projects',
    ]) {
      expect(unportableEntryReason(name, name === 'Projects' ? 'directory' : 'file'), name).toBeNull();
    }
  });

  it('skips hidden entries: Obsidian never syncs dotfiles, so they cannot break sync', () => {
    // Deliberate narrowing of the union's leading-dot rule for the AUDIT
    // only: reporting .DS_Store on every macOS vault would bury the real
    // findings, and the creation gate still refuses leading dots.
    expect(unportableEntryReason('.DS_Store', 'file')).toBeNull();
    expect(unportableEntryReason('.hidden note?.md', 'file')).toBeNull();
    expect(unportableEntryReason('.obsidian', 'directory')).toBeNull();
    expect(isHiddenName('.trash')).toBe(true);
    expect(isHiddenName('trash')).toBe(false);
  });

  it('tolerates junk input', () => {
    expect(unportableEntryReason('', 'file')).toBeNull();
    expect(unportableEntryReason(null, 'file')).toBeNull();
    expect(unportableEntryReason(undefined, 'directory')).toBeNull();
  });
});

describe('classifyVaultPaths: the native (Android/iOS) vault index shape', () => {
  it('checks folder segments as directories and the last segment as a file', () => {
    const out = classifyVaultPaths([
      'Daily/2026-08-16.md',
      'Bad?Folder/fine.md',
      'Folder/bad:note.md',
      'Deep/Nested/what?.md',
    ]);
    expect(out.map((e) => e.path)).toEqual(['Bad?Folder/fine.md', 'Deep/Nested/what?.md', 'Folder/bad:note.md']);
    // A folder problem is reported with the folder's reason, so the user
    // knows which segment to fix.
    expect(out[0].reason).toMatch(/"\?"/);
  });

  it('reports the trailing-space-before-extension shape on native paths too', () => {
    const out = classifyVaultPaths(['Daily/Meeting notes .md']);
    expect(out).toHaveLength(1);
    expect(out[0].reason).toMatch(/space just before its extension/);
  });

  it('skips anything under a hidden segment and tolerates junk', () => {
    expect(classifyVaultPaths(['.obsidian/plugins/x?.md', '.trash/bad:name.md'])).toEqual([]);
    expect(classifyVaultPaths(null)).toEqual([]);
    expect(classifyVaultPaths(['', 42, {}])).toEqual([]);
  });

  it('returns entries sorted by path', () => {
    const out = classifyVaultPaths(['z?.md', 'a?.md']);
    expect(out.map((e) => e.path)).toEqual(['a?.md', 'z?.md']);
  });
});
