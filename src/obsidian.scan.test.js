import { describe, it, expect } from 'vitest';
import { scanVaultNotes } from './obsidian.js';

// scanVaultNotes drives BOTH outputs of the one vault traversal: the wikilink
// autocomplete candidates (names, unchanged behavior from the original
// listVaultNotes) and the issue #1358 unportable-name listing, computed in
// the same pass so the Settings -> Obsidian panel costs no traversal of its
// own. The fake handles below mirror the FileSystemDirectoryHandle surface
// the scan uses: kind + async entries().

const file = (name) => [name, { kind: 'file' }];
const dir = (name, children) => [name, {
  kind: 'directory',
  entries: async function* entries() { yield* children; },
}];
const rootOf = (children) => ({ entries: async function* entries() { yield* children; } });

describe('scanVaultNotes', () => {
  it('collects sorted bare note names and unportable entries in one pass', async () => {
    const root = rootOf([
      file('Zebra.md'),
      file('Alpha.md'),
      file('plans?.md'),
      file('notes.png'),
      dir('Daily', [file('2026-08-16.md'), file('Meeting notes .md')]),
    ]);
    const { names, unportable } = await scanVaultNotes(root);
    expect(names).toEqual(['2026-08-16', 'Alpha', 'Meeting notes ', 'plans?', 'Zebra']);
    expect(unportable).toEqual([
      { path: 'Daily/Meeting notes .md', reason: expect.stringMatching(/space just before its extension/) },
      { path: 'plans?.md', reason: expect.stringMatching(/"\?"/) },
    ]);
  });

  it('reports vault-relative paths, so nested findings are locatable', async () => {
    const root = rootOf([
      dir('Projects', [dir('2026', [file('CON.md')])]),
    ]);
    const { unportable } = await scanVaultNotes(root);
    expect(unportable).toEqual([
      { path: 'Projects/2026/CON.md', reason: expect.stringMatching(/reserved device name/) },
    ]);
  });

  it('reports an unportable folder once and still scans inside it', async () => {
    const root = rootOf([
      dir('Bad|Folder', [file('fine.md'), file('also bad?.md')]),
    ]);
    const { names, unportable } = await scanVaultNotes(root);
    expect(names).toEqual(['also bad?', 'fine']);
    expect(unportable.map((e) => e.path)).toEqual(['Bad|Folder/', 'Bad|Folder/also bad?.md']);
    // The folder entry carries its own reason; the fine.md inside it is not
    // re-reported (one finding per offending NAME, not per affected path).
    expect(unportable[0].reason).toMatch(/"\|"/);
  });

  it('never enters hidden directories and never reports hidden files', async () => {
    const root = rootOf([
      dir('.obsidian', [file('bad:config.md')]),
      file('.DS_Store'),
      file('ok.md'),
    ]);
    const { names, unportable } = await scanVaultNotes(root);
    expect(names).toEqual(['ok']);
    expect(unportable).toEqual([]);
  });

  it('clean vaults produce an empty listing (the panel renders nothing)', async () => {
    const root = rootOf([file('A.md'), dir('Daily', [file('2026-01-01.md')])]);
    const { unportable } = await scanVaultNotes(root);
    expect(unportable).toEqual([]);
  });
});
