import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assemble, mirrorPackageJson, PACKAGES } from './assemble.mjs';

// The public mirror of the bridge plugin is built from this repo by
// assemble.mjs. What it must hold: Obsidian reads manifest.json, README and
// LICENSE at the root, and the source has to build there without this repo.

const repoRoot = resolve(import.meta.dirname, '..', '..');

describe('mirrorPackageJson', () => {
  it('points file: links to the copies under ./packages', () => {
    const out = mirrorPackageJson({
      dependencies: { '@glance-apps/agenda-core': 'file:../packages/agenda-core', '@glance-apps/sync': '2.3.0' },
      devDependencies: { typescript: '^5.4.0' },
    });
    expect(out.dependencies).toEqual({ '@glance-apps/agenda-core': 'file:./packages/agenda-core', '@glance-apps/sync': '2.3.0' });
    expect(out.devDependencies).toEqual({ typescript: '^5.4.0' });
  });

  it('does not change its input', () => {
    const pkg = { dependencies: { '@glance-apps/obsidian-format': 'file:../packages/obsidian-format' } };
    mirrorPackageJson(pkg);
    expect(pkg.dependencies['@glance-apps/obsidian-format']).toBe('file:../packages/obsidian-format');
  });

  it('refuses a file: link to a package the mirror does not copy', () => {
    expect(() => mirrorPackageJson({ dependencies: { x: 'file:../packages/not-copied' } })).toThrow(/cannot resolve/);
    expect(() => mirrorPackageJson({ dependencies: { x: 'file:../../elsewhere' } })).toThrow(/cannot resolve/);
  });
});

describe('assemble (from this repository)', () => {
  let out;
  beforeAll(() => {
    out = join(mkdtempSync(join(tmpdir(), 'bridge-mirror-')), 'tree');
    assemble(repoRoot, out);
  });
  afterAll(() => rmSync(resolve(out, '..'), { recursive: true, force: true }));

  const has = (rel) => existsSync(join(out, rel));
  const json = (rel) => JSON.parse(readFileSync(join(out, rel), 'utf8'));

  it('puts the plugin at the root, as Obsidian reads it', () => {
    for (const f of ['manifest.json', 'versions.json', 'styles.css', 'README.md', 'package.json', 'tsconfig.json', 'esbuild.config.mjs', 'eslint.config.mjs', '.npmrc', 'src/main.ts']) {
      expect(has(f), f).toBe(true);
    }
    expect(json('manifest.json')).toEqual(JSON.parse(readFileSync(join(repoRoot, 'dayglance-obsidian-plugin/manifest.json'), 'utf8')));
  });

  it('carries every package the plugin links to, and the links resolve to them', () => {
    const deps = json('package.json').dependencies;
    const linked = Object.values(deps).filter((spec) => spec.startsWith('file:'));
    expect(linked.length).toBe(PACKAGES.length);
    for (const spec of linked) {
      const dir = spec.slice('file:'.length);
      expect(has(join(dir, 'package.json')), spec).toBe(true);
      expect(has(join(dir, 'src/index.js')), spec).toBe(true);
    }
  });

  it('adds the mirror-only files at the root', () => {
    expect(has('.github/workflows/release.yml')).toBe(true);
    expect(has('.github/workflows/publish-manifest.yml')).toBe(true);
    expect(has('.github/scripts/publish-manifest.sh')).toBe(true);
    expect(has('.gitignore')).toBe(true);
    expect(has('CONTRIBUTING.md')).toBe(true);
    expect(has('mirror')).toBe(false);
  });

  it('leaves out what only builds here, and never writes LICENSE', () => {
    for (const f of ['test', 'node_modules', 'main.js', 'package-lock.json', 'LICENSE', 'packages/agenda-core/node_modules']) {
      expect(has(f), f).toBe(false);
    }
  });
});
