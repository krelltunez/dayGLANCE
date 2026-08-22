import { describe, it, expect } from 'vitest';
import { buildObsidianOpenUri, buildObsidianOpenPathUri } from './obsidianUri.js';

// Regression tests for "Open in Obsidian" doing nothing on macOS. Two defects
// met here: the renderer's window.open('obsidian://…') was dropped by the
// http/https-only external-URL allowlist, and the renderer's Electron vault
// handle reports the placeholder name 'vault' rather than the real folder. The
// URL is therefore built in the main process, from the vault path it holds.

describe('buildObsidianOpenUri', () => {
  it('builds an open URI from the vault folder name and note name', () => {
    expect(buildObsidianOpenUri('My Vault', 'Project Notes'))
      .toBe('obsidian://open?vault=My%20Vault&file=Project%20Notes');
  });

  it('strips the [[Note#Heading]] fragment', () => {
    // Left in place it percent-encodes to `Meeting%23Agenda` and Obsidian
    // matches no such file — the button would "work" but open nothing. Matches
    // what loadWikiNote and saveWikiNote already do with the same input.
    expect(buildObsidianOpenUri('Vault', 'Meeting#Agenda'))
      .toBe('obsidian://open?vault=Vault&file=Meeting');
  });

  it('trims surrounding whitespace from both parts', () => {
    expect(buildObsidianOpenUri('  Vault  ', '  Note  '))
      .toBe('obsidian://open?vault=Vault&file=Note');
    // A wikilink written as [[Note # Heading]] leaves a trailing space.
    expect(buildObsidianOpenUri('Vault', 'Note # Heading'))
      .toBe('obsidian://open?vault=Vault&file=Note');
  });

  it('percent-encodes characters that would otherwise break the query', () => {
    // Note titles routinely contain these; unencoded, `&` and `#` would split
    // the query and `/` would be read as a path separator by some handlers.
    expect(buildObsidianOpenUri('R&D', 'Q1 / Q2 plan'))
      .toBe('obsidian://open?vault=R%26D&file=Q1%20%2F%20Q2%20plan');
  });

  it('supports notes in subfolders', () => {
    expect(buildObsidianOpenUri('Vault', 'Areas/Work/Standup'))
      .toBe('obsidian://open?vault=Vault&file=Areas%2FWork%2FStandup');
  });

  it('returns null when the note name is empty or only a heading', () => {
    expect(buildObsidianOpenUri('Vault', '')).toBeNull();
    expect(buildObsidianOpenUri('Vault', '   ')).toBeNull();
    expect(buildObsidianOpenUri('Vault', '#Heading')).toBeNull();
  });

  it('returns null when the vault name is missing', () => {
    // No vault configured, or a config whose path resolved to an empty basename.
    expect(buildObsidianOpenUri('', 'Note')).toBeNull();
    expect(buildObsidianOpenUri('   ', 'Note')).toBeNull();
  });

  it('returns null for non-string input rather than building a junk URI', () => {
    expect(buildObsidianOpenUri(undefined as unknown as string, 'Note')).toBeNull();
    expect(buildObsidianOpenUri('Vault', null as unknown as string)).toBeNull();
    expect(buildObsidianOpenUri('Vault', 42 as unknown as string)).toBeNull();
  });
});

// Launch-on-write (Phase 1): the deep link fired by the main process after the
// debounced quiet window. `path` overrides `vault` and `file`, so the URI
// carries only the absolute path resolveInVault produced.

describe('buildObsidianOpenPathUri', () => {
  it('builds a path URI from a POSIX absolute path', () => {
    expect(buildObsidianOpenPathUri('/Users/me/Vault/Daily Notes/2026-08-22.md'))
      .toBe('obsidian://open?path=%2FUsers%2Fme%2FVault%2FDaily%20Notes%2F2026-08-22.md');
  });

  it('builds a path URI from a Windows absolute path (drive colon and backslashes encoded)', () => {
    expect(buildObsidianOpenPathUri('C:\\Vault\\note.md'))
      .toBe('obsidian://open?path=C%3A%5CVault%5Cnote.md');
  });

  it('does not strip or trim — the path is a resolved filesystem path, not a wikilink', () => {
    // A pre-existing vault file may legally contain '#' (the portability
    // validator only refuses CREATING such names); the exact path must survive.
    expect(buildObsidianOpenPathUri('/v/Notes #1.md'))
      .toBe('obsidian://open?path=%2Fv%2FNotes%20%231.md');
  });

  it('returns null for empty, blank, or non-string input', () => {
    expect(buildObsidianOpenPathUri('')).toBeNull();
    expect(buildObsidianOpenPathUri('   ')).toBeNull();
    expect(buildObsidianOpenPathUri(undefined as unknown as string)).toBeNull();
    expect(buildObsidianOpenPathUri(null as unknown as string)).toBeNull();
    expect(buildObsidianOpenPathUri(42 as unknown as string)).toBeNull();
  });
});
