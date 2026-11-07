import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The mirror's release timing, end to end on throwaway repositories:
// scripts/bridge-mirror/sync.sh (this repo's mirror workflow) and the
// mirror's own publish-manifest.sh. The rule they hold together: the
// mirror's main names the PUBLISHED version in manifest.json and
// versions.json, which Obsidian's directory and BRAT read, so a merged
// version bump never advertises a release that is still a draft.

const repoRoot = resolve(import.meta.dirname, '..', '..');
const SYNC = join(repoRoot, 'scripts/bridge-mirror/sync.sh');
const PUBLISH = join(repoRoot, 'dayglance-obsidian-plugin/mirror/.github/scripts/publish-manifest.sh');

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8' }).trim();
const sh = (cwd, script, ...args) => execFileSync('bash', [script, ...args], { cwd, env, encoding: 'utf8' });

let dir;
let origin;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bridge-sync-'));
  origin = join(dir, 'origin.git');
  git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  // The mirror as it stands: 1.0.1 published, its own LICENSE.
  const seed = join(dir, 'seed');
  git(dir, 'clone', '-q', origin, seed);
  writeTree(seed, { version: '1.0.1', versions: { '1.0.1': '1.7.2' }, code: 'old' });
  writeFileSync(join(seed, 'LICENSE'), 'mirror licence\n');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'tag', '1.0.1');
  git(seed, 'push', '-q', 'origin', 'HEAD:main', 'refs/tags/1.0.1');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function writeTree(at, { version, versions, code }) {
  mkdirSync(join(at, 'src'), { recursive: true });
  writeFileSync(join(at, 'manifest.json'), JSON.stringify({ id: 'dayglance-bridge', version }, null, 2) + '\n');
  writeFileSync(join(at, 'versions.json'), JSON.stringify(versions, null, 2) + '\n');
  writeFileSync(join(at, 'src/main.ts'), `// ${code}\n`);
  mkdirSync(join(at, '.github/scripts'), { recursive: true });
  cpSync(PUBLISH, join(at, '.github/scripts/publish-manifest.sh'));
}

/** This repo's mirror workflow on a merge: assemble `tree`, clone the mirror, sync. */
function merge(name, tree) {
  const t = join(dir, `tree-${name}`);
  writeTree(t, tree);
  const m = join(dir, `mirror-${name}`);
  git(dir, 'clone', '-q', origin, m);
  return sh(dir, SYNC, t, m, 'a'.repeat(40));
}

/** The mirror's publish-manifest workflow, on a release published for `tag`. */
function publish(name, tag) {
  const c = join(dir, `publish-${name}`);
  git(dir, 'clone', '-q', origin, c);
  return sh(c, '.github/scripts/publish-manifest.sh', tag);
}

const at = (ref, file) => git(dir, `--git-dir=${origin}`, 'show', `${ref}:${file}`);
const versionAt = (ref) => JSON.parse(at(ref, 'manifest.json')).version;
const versionsAt = (ref) => JSON.parse(at(ref, 'versions.json'));
const tags = () => git(dir, `--git-dir=${origin}`, 'tag', '--list').split('\n').filter(Boolean).sort();

describe('the mirror names a version only once its release is published', () => {
  it('a merged bump: main gets the code but keeps the published manifest; the tag carries the new one, one commit past main', () => {
    const out = merge('bump', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'new' });
    expect(out).toMatch(/Tagged 1\.1\.0/);
    expect(at('main', 'src/main.ts')).toBe('// new');
    expect(versionAt('main')).toBe('1.0.1');
    expect(versionsAt('main')).toEqual({ '1.0.1': '1.7.2' });
    expect(at('main', 'LICENSE')).toBe('mirror licence');
    // The release's commit: the same code, the new files, its parent main.
    expect(versionAt('1.1.0')).toBe('1.1.0');
    expect(versionsAt('1.1.0')).toEqual({ '1.0.1': '1.7.2', '1.1.0': '1.7.2' });
    expect(at('1.1.0', 'src/main.ts')).toBe('// new');
    expect(git(dir, `--git-dir=${origin}`, 'rev-parse', '1.1.0^')).toBe(git(dir, `--git-dir=${origin}`, 'rev-parse', 'main'));
    expect(git(dir, `--git-dir=${origin}`, 'branch', '--contains', '1.1.0')).toBe('');
  });

  it('more code merged before the publish: main follows it, still naming the published version; the tag stays put', () => {
    merge('bump', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'new' });
    const tagged = git(dir, `--git-dir=${origin}`, 'rev-parse', '1.1.0');
    const out = merge('more', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'newer' });
    expect(out).toMatch(/already tagged/);
    expect(at('main', 'src/main.ts')).toBe('// newer');
    expect(versionAt('main')).toBe('1.0.1');
    expect(git(dir, `--git-dir=${origin}`, 'rev-parse', '1.1.0')).toBe(tagged);
  });

  it('publishing moves main to the release, keeping the newest code; a later sync keeps it there', () => {
    merge('bump', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'new' });
    merge('more', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'newer' });
    expect(publish('p', '1.1.0')).toMatch(/main now names 1\.1\.0/);
    expect(versionAt('main')).toBe('1.1.0');
    expect(versionsAt('main')).toEqual({ '1.0.1': '1.7.2', '1.1.0': '1.7.2' });
    expect(at('main', 'src/main.ts')).toBe('// newer');
    // The next merge with no bump changes nothing about the version.
    merge('after', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'later' });
    expect(versionAt('main')).toBe('1.1.0');
    expect(at('main', 'src/main.ts')).toBe('// later');
    expect(tags()).toEqual(['1.0.1', '1.1.0']);
  });

  it('the next bump waits for its own publish', () => {
    merge('bump', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'new' });
    publish('p', '1.1.0');
    merge('bump2', { version: '1.2.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2', '1.2.0': '1.8.7' }, code: 'two' });
    expect(versionAt('main')).toBe('1.1.0');
    expect(versionAt('1.2.0')).toBe('1.2.0');
    publish('p2', '1.2.0');
    expect(versionAt('main')).toBe('1.2.0');
    expect(versionsAt('main')['1.2.0']).toBe('1.8.7');
  });

  it('publishing a release that is not newer than main changes nothing', () => {
    merge('bump', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'new' });
    publish('p', '1.1.0');
    const head = git(dir, `--git-dir=${origin}`, 'rev-parse', 'main');
    expect(publish('old', '1.0.1')).toMatch(/not newer/);
    expect(publish('again', '1.1.0')).toMatch(/not newer/);
    expect(git(dir, `--git-dir=${origin}`, 'rev-parse', 'main')).toBe(head);
    expect(versionAt('main')).toBe('1.1.0');
  });

  it('compares versions as numbers, not text (1.10.0 is newer than 1.9.0)', () => {
    merge('nine', { version: '1.9.0', versions: { '1.9.0': '1.7.2' }, code: 'nine' });
    publish('p9', '1.9.0');
    merge('ten', { version: '1.10.0', versions: { '1.9.0': '1.7.2', '1.10.0': '1.7.2' }, code: 'ten' });
    expect(publish('p10', '1.10.0')).toMatch(/main now names 1\.10\.0/);
    expect(versionAt('main')).toBe('1.10.0');
  });

  it('a sync that lands after the publish checkout was made is kept', () => {
    merge('bump', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'new' });
    const c = join(dir, 'publish-race');
    git(dir, 'clone', '-q', origin, c);
    // A sync lands after this checkout was made.
    merge('race', { version: '1.1.0', versions: { '1.0.1': '1.7.2', '1.1.0': '1.7.2' }, code: 'raced' });
    expect(sh(c, '.github/scripts/publish-manifest.sh', '1.1.0')).toMatch(/main now names 1\.1\.0/);
    expect(versionAt('main')).toBe('1.1.0');
    expect(at('main', 'src/main.ts')).toBe('// raced');
  });

  it('the mirror carries the publish workflow and its script', () => {
    const wf = readFileSync(join(repoRoot, 'dayglance-obsidian-plugin/mirror/.github/workflows/publish-manifest.yml'), 'utf8');
    expect(wf).toMatch(/release:\s*\n\s*types: \[published\]/);
    expect(wf).toMatch(/!github\.event\.release\.prerelease/);
    expect(wf).toMatch(/bash \.github\/scripts\/publish-manifest\.sh "\$TAG"/);
  });
});
