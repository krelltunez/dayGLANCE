import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// #2331: every path that builds a task from another one writes the new row
// field by field, and each one that forgot `energy` dropped the user's
// override (a series turned into a one-off and back, an occurrence moved to
// another date or postponed). Those paths already carry `createdAt` with
// carryCreatedAt, so the one rule held at the source: wherever a task is built
// with `...carryCreatedAt(x)`, `...carryEnergy(x)` follows it. A new
// conversion that carries one and not the other fails here. Read at the
// source level like the other App.jsx tests (the editor's save needs most of
// App's state to run); the postpone path is also driven for real in
// useTaskActions.postpone.test.js.

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return sources(path);
  return /\.(js|jsx)$/.test(entry.name) && !/\.test\.(js|jsx)$/.test(entry.name) ? [path] : [];
});

const SPREAD = /\.\.\.carryCreatedAt\((.*)\),\n(\s*)(.*)/g;

describe('carryEnergy beside carryCreatedAt', () => {
  const sites = sources(root).flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    return [...text.matchAll(SPREAD)].map(([, arg, , next]) => ({ file: file.slice(root.length), arg, next }));
  });

  it('finds the conversion paths it guards', () => {
    // The editor's three (series → one-off, an occurrence moved to another
    // date, one-off → series), the recurrence modal's "convert to regular",
    // and postponing an occurrence.
    expect(sites.map((s) => s.file).sort()).toEqual([
      'App.jsx', 'App.jsx', 'App.jsx', 'components/EditRecurrenceModal.jsx', 'hooks/useTaskActions.js',
    ]);
  });

  it('carries the energy override from the same source wherever a task carries its creation', () => {
    for (const { file, arg, next } of sites) {
      expect(next, `${file}: ...carryCreatedAt(${arg})`).toBe(`...carryEnergy(${arg}),`);
    }
  });
});
