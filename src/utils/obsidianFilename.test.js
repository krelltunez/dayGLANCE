import { describe, it, expect } from 'vitest';
import {
  validateVaultNameSegment,
  validateWikiNoteName,
  validateVaultFolderSetting,
  validateDailyNotePattern,
} from './obsidianFilename.js';
import { formatDatePattern } from '../obsidian.js';

// The union rule under test: refuse anything unusable on ANY platform an
// Obsidian vault can sync to. Load-bearing nuance: ? * " < > are LEGAL on
// macOS/Linux and Obsidian will create such notes there — the refusal is on
// portability grounds, and the messages must say so, never claim Obsidian
// rejects them.

describe('validateVaultNameSegment — accepts', () => {
  it('ordinary names, unicode, internal dots and spaces', () => {
    for (const name of [
      'Meeting notes', '2026-08-10', 'emails urgent', 'Björn plans',
      'v1.2 release notes', 'draft (2)', "client's brief", 'a', '日記',
      'CONTRACT', 'console', 'COM10', 'LPT0', 'nulled',
    ]) {
      expect(validateVaultNameSegment(name), name).toBeNull();
    }
  });
});

describe('validateVaultNameSegment — refuses the union set', () => {
  it('every character in the union set, message naming the character', () => {
    for (const ch of ['[', ']', '#', '^', '|', '*', '"', '\\', '/', ':', '?', '<', '>']) {
      const reason = validateVaultNameSegment(`emails ${ch} urgent`);
      expect(reason, ch).not.toBeNull();
      expect(reason, ch).toContain(ch === '\\' ? '\\' : ch);
    }
  });

  it('the message states portability grounds, not that Obsidian refuses', () => {
    const reason = validateVaultNameSegment('emails urgent?');
    expect(reason).toContain('"?"');
    expect(reason).toMatch(/portable|platforms/i);
    expect(reason).not.toMatch(/obsidian (would|rejects|refuses)/i);
  });

  it('control characters', () => {
    expect(validateVaultNameSegment('a\x00b')).toContain('control character');
    expect(validateVaultNameSegment('a\x1fb')).toContain('control character');
    expect(validateVaultNameSegment('tab\there')).toContain('control character');
  });

  it('leading dot; trailing dot; trailing space', () => {
    expect(validateVaultNameSegment('.hidden')).toContain('starts with');
    expect(validateVaultNameSegment('notes.')).toContain('dot');
    expect(validateVaultNameSegment('notes ')).toContain('space');
  });

  it('Windows reserved device names, case-insensitive, with and without extension', () => {
    for (const name of ['CON', 'con', 'Con', 'PRN', 'AUX', 'NUL', 'COM1', 'com9', 'LPT1', 'lpt9']) {
      expect(validateVaultNameSegment(name), name).toContain('reserved');
    }
    // Reserved WITH an extension: the stem before the first dot is what Windows reserves.
    expect(validateVaultNameSegment('CON.md')).toContain('reserved');
    expect(validateVaultNameSegment('con.backup.md')).toContain('reserved');
    expect(validateVaultNameSegment('NUL.txt')).toContain('reserved');
  });

  it('empty and non-string', () => {
    expect(validateVaultNameSegment('')).not.toBeNull();
    expect(validateVaultNameSegment(undefined)).not.toBeNull();
  });
});

describe('validateWikiNoteName — Folder/Name support preserved', () => {
  it('validates each / segment separately, so folder links stay legal', () => {
    expect(validateWikiNoteName('Projects/Q3 planning')).toBeNull();
    expect(validateWikiNoteName('a/b/c')).toBeNull();
  });

  it('rejects when any segment violates the set', () => {
    expect(validateWikiNoteName('Projects/emails: urgent')).toContain(':');
    expect(validateWikiNoteName('CON/notes')).toContain('reserved');
    expect(validateWikiNoteName('ok/notes.')).toContain('dot');
  });

  it('rejects empty targets', () => {
    expect(validateWikiNoteName('')).not.toBeNull();
    expect(validateWikiNoteName('///')).not.toBeNull();
  });
});

describe('validateVaultFolderSetting', () => {
  it('empty means vault root and is valid; normal folders pass', () => {
    expect(validateVaultFolderSetting('')).toBeNull();
    expect(validateVaultFolderSetting(undefined)).toBeNull();
    expect(validateVaultFolderSetting('dayGLANCE')).toBeNull();
    expect(validateVaultFolderSetting('notes/from dayGLANCE')).toBeNull();
  });

  it('rejects illegal segments', () => {
    expect(validateVaultFolderSetting('notes?')).toContain('?');
    expect(validateVaultFolderSetting('a/COM1/b')).toContain('reserved');
  });
});

describe('validateDailyNotePattern — validates the RENDERED output', () => {
  it('the default and common patterns pass', () => {
    expect(validateDailyNotePattern('yyyy-MM-dd', formatDatePattern)).toBeNull();
    expect(validateDailyNotePattern('dd MMM yyyy', formatDatePattern)).toBeNull();
    expect(validateDailyNotePattern('', formatDatePattern)).toBeNull(); // falls back to default
  });

  it('a pattern whose rendered output contains an illegal literal is rejected', () => {
    expect(validateDailyNotePattern('notes: yyyy-MM-dd', formatDatePattern)).toContain(':');
    expect(validateDailyNotePattern('yyyy/MM/dd', formatDatePattern)).toContain('/');
    expect(validateDailyNotePattern('yyyy-MM-dd?', formatDatePattern)).toContain('?');
  });

  it('format tokens themselves are not treated as literals (M vs MM padding cannot mask)', () => {
    // Rendered against 2026-12-31: double-digit month and day.
    expect(validateDailyNotePattern('M-d-yy', formatDatePattern)).toBeNull();
  });
});
