import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Every @glance-apps package here that names another as a peer (or a
// dependency) must accept that package's CURRENT version. npm reads caret
// ranges on 0.x versions narrowly — "^0.1.0" means 0.1.x only — so bumping a
// package's minor version without widening the ranges that name it gives an
// ERESOLVE warning on `npm ci` here, and a real conflict for anyone
// installing the published packages (mcp-host 0.2.0 vs dayglance-mcp's
// "^0.1.0", November 2026).

const root = resolve(import.meta.dirname);
const packages = readdirSync(root, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(root, d.name, 'package.json')))
  .map((d) => JSON.parse(readFileSync(join(root, d.name, 'package.json'), 'utf8')));
const versions = Object.fromEntries(packages.map((p) => [p.name, p.version]));

const parse = (v) => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not a plain x.y.z version: ${v}`);
  return m.slice(1).map(Number);
};
// The caret rule as npm applies it, for the ranges these packages use
// ("^x.y.z", joined with "||"); anything else fails loudly rather than
// passing unchecked.
export function caretAccepts(range, version) {
  const [a, b, c] = parse(version);
  return range.split('||').map((r) => r.trim()).some((r) => {
    if (!r.startsWith('^')) throw new Error(`unsupported range "${r}": use ^x.y.z (joined with ||)`);
    const [x, y, z] = parse(r.slice(1));
    if (x > 0) return a === x && (b > y || (b === y && c >= z));
    if (y > 0) return a === 0 && b === y && c >= z;
    return a === 0 && b === 0 && c === z;
  });
}

describe('the caret rule', () => {
  it('reads 0.x ranges as narrowly as npm does', () => {
    expect(caretAccepts('^0.1.0', '0.1.5')).toBe(true);
    expect(caretAccepts('^0.1.0', '0.2.0')).toBe(false);
    expect(caretAccepts('^0.1.0 || ^0.2.0', '0.2.0')).toBe(true);
    expect(caretAccepts('^2.4.0', '2.9.1')).toBe(true);
    expect(caretAccepts('^2.4.0', '3.0.0')).toBe(false);
    expect(() => caretAccepts('>=0.1.0', '0.2.0')).toThrow(/unsupported/);
  });
});

describe('@glance-apps packages accept each other\'s current versions', () => {
  for (const pkg of packages) {
    const ranges = { ...(pkg.peerDependencies ?? {}), ...(pkg.dependencies ?? {}) };
    for (const [name, range] of Object.entries(ranges)) {
      if (!versions[name] || range.startsWith('file:')) continue;
      it(`${pkg.name} accepts ${name}@${versions[name]} (${range})`, () => {
        expect(caretAccepts(range, versions[name])).toBe(true);
      });
    }
  }
});
