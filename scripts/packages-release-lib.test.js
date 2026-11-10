import { describe, expect, it } from 'vitest';
import {
  compareVersions, isTestPath, latestRelease, localRequirements, nextVersion, packageAction,
  parseVersion, publishOrder, requirementProblems, satisfies, tagName, withLockVersion,
} from './packages-release-lib.mjs';

// The release tool for the shared @glance-apps/* packages
// (scripts/packages-release.mjs). These are the rules it decides with.

describe('versions', () => {
  it('reads x.y.z only, so a prerelease such as 0.0.0-stage is not a release', () => {
    expect(parseVersion('0.2.1')).toEqual([0, 2, 1]);
    expect(parseVersion('0.0.0-stage')).toBeNull();
    expect(parseVersion('v1.0.0')).toBeNull();
  });

  it('orders numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.1', '0.2.1')).toBe(0);
    expect(latestRelease(['0.0.0-stage', '0.1.0', '0.10.0', '0.9.3'])).toBe('0.10.0');
    expect(latestRelease(['0.0.0-stage'])).toBeNull();
  });

  it('steps patch, minor and major, and takes an explicit version only when it is higher', () => {
    expect(nextVersion('0.2.0', 'patch')).toBe('0.2.1');
    expect(nextVersion('0.2.3', 'minor')).toBe('0.3.0');
    expect(nextVersion('0.2.3', 'major')).toBe('1.0.0');
    expect(nextVersion('0.2.0', '0.2.5')).toBe('0.2.5');
    expect(() => nextVersion('0.2.1', '0.2.1')).toThrow(/not above/);
    expect(() => nextVersion('0.2.1', 'next')).toThrow(/not patch/);
  });
});

describe('ranges, with npm\'s rule for 0.x carets', () => {
  it('^0.2.0 accepts 0.2.x from 0.2.0 up, not 0.3.0', () => {
    expect(satisfies('0.2.0', '^0.2.0')).toBe(true);
    expect(satisfies('0.2.7', '^0.2.0')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false);
    expect(satisfies('0.1.9', '^0.2.0')).toBe(false);
  });

  it('^1.2.0 accepts 1.x from 1.2.0; ^0.0.3 only 0.0.3; >= and exact; alternatives with ||', () => {
    expect(satisfies('1.9.0', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
    expect(satisfies('2.5.0', '>=2.4.0')).toBe(true);
    expect(satisfies('0.2.0', '0.2.0')).toBe(true);
    expect(satisfies('0.2.0', '^0.1.0 || ^0.2.0')).toBe(true);
    expect(satisfies('0.3.0', '^0.1.0 || ^0.2.0')).toBe(false);
  });

  it('reports a range it does not understand as unsatisfied, rather than guessing', () => {
    expect(satisfies('0.2.0', '~0.2.0')).toBe(false);
    expect(satisfies('0.2.0', '*')).toBe(false);
  });
});

// The packages as they stand, in miniature.
const manifests = {
  '@glance-apps/agenda-core': { version: '0.2.1' },
  '@glance-apps/obsidian-format': { version: '0.1.1' },
  '@glance-apps/mcp-host': { version: '0.2.0' },
  '@glance-apps/dayglance-vault': {
    version: '0.2.1',
    peerDependencies: { '@glance-apps/agenda-core': '^0.2.0', '@glance-apps/obsidian-format': '^0.1.0', '@glance-apps/sync': '^2.4.0' },
  },
  '@glance-apps/dayglance-mcp': {
    version: '0.2.2',
    peerDependencies: { '@glance-apps/agenda-core': '^0.2.0', '@glance-apps/mcp-host': '^0.1.0 || ^0.2.0', zod: '^4.6.7' },
  },
};
const local = new Set(Object.keys(manifests));

describe('what a package requires of the others', () => {
  it('only the local packages, from dependencies and peers alike', () => {
    expect(localRequirements(manifests['@glance-apps/dayglance-vault'], local)).toEqual({
      '@glance-apps/agenda-core': '^0.2.0', '@glance-apps/obsidian-format': '^0.1.0',
    });
  });

  // MUTATION: drop the visit of a requirement and dayglance-vault goes before agenda-core.
  it('publishes what is required first, keeping the given order otherwise', () => {
    const order = publishOrder(['@glance-apps/dayglance-vault', '@glance-apps/dayglance-mcp', '@glance-apps/agenda-core', '@glance-apps/obsidian-format'], manifests);
    expect(order.indexOf('@glance-apps/agenda-core')).toBeLessThan(order.indexOf('@glance-apps/dayglance-vault'));
    expect(order.indexOf('@glance-apps/obsidian-format')).toBeLessThan(order.indexOf('@glance-apps/dayglance-vault'));
    expect(order.indexOf('@glance-apps/agenda-core')).toBeLessThan(order.indexOf('@glance-apps/dayglance-mcp'));
    expect(order).toHaveLength(4);
  });

  it('refuses a cycle', () => {
    const cyc = { a: { version: '1.0.0', peerDependencies: { b: '^1.0.0' } }, b: { version: '1.0.0', peerDependencies: { a: '^1.0.0' } } };
    expect(() => publishOrder(['a', 'b'], cyc)).toThrow(/cycle/);
  });

  it('a requirement on a version npm does not have is a problem unless the same run publishes it', () => {
    const npm = { '@glance-apps/agenda-core': ['0.2.0'], '@glance-apps/obsidian-format': ['0.1.0'], '@glance-apps/mcp-host': ['0.2.0'] };
    const vaultOnly = requirementProblems(manifests, npm, new Set(['@glance-apps/dayglance-vault']), ['@glance-apps/dayglance-vault']);
    expect(vaultOnly.map((p) => p.dep)).toEqual(['@glance-apps/agenda-core', '@glance-apps/obsidian-format']);
    const together = requirementProblems(manifests, npm, new Set(['@glance-apps/dayglance-vault', '@glance-apps/agenda-core', '@glance-apps/obsidian-format']), ['@glance-apps/dayglance-vault']);
    expect(together).toEqual([]);
  });

  it('a local version outside the range is a problem whatever npm has', () => {
    const moved = { ...manifests, '@glance-apps/agenda-core': { version: '0.3.0' } };
    const problems = requirementProblems(moved, {}, new Set(Object.keys(moved)), ['@glance-apps/dayglance-mcp']);
    expect(problems).toEqual([expect.objectContaining({ dep: '@glance-apps/agenda-core', range: '^0.2.0', version: '0.3.0' })]);
  });
});

describe('what each package needs', () => {
  it('publish when its version is not on npm', () => {
    expect(packageAction({ version: '0.2.1', npmVersions: ['0.1.0', '0.2.0'] }).action).toBe('publish');
  });

  it('tag when npm has it and git does not', () => {
    expect(packageAction({ version: '0.2.1', npmVersions: ['0.2.1'], tagged: false }).action).toBe('tag');
  });

  // MUTATION: drop the changed-files check and a change made after the release reads "ok".
  it('bump when the source changed after the published version, so the change can be released', () => {
    const r = packageAction({ version: '0.2.0', npmVersions: ['0.2.0'], tagged: true, changedSinceRelease: ['src/adapter.js'] });
    expect(r).toEqual({ action: 'bump', detail: 'changed since 0.2.0: src/adapter.js' });
  });

  it('a change outranks a missing tag: the tag can follow, the change cannot ship without a bump', () => {
    expect(packageAction({ version: '0.2.1', npmVersions: ['0.2.1'], tagged: false, changedSinceRelease: ['src/readModel.js'] }).action).toBe('bump');
  });

  it('ok when published, tagged, and nothing outside the tests changed', () => {
    expect(packageAction({ version: '0.2.0', npmVersions: ['0.2.0'], tagged: true, changedSinceRelease: [] }).action).toBe('ok');
  });

  it('tests and fixtures never need a release', () => {
    expect(isTestPath('test/listener.test.js')).toBe(true);
    expect(isTestPath('src/overnight.test.js')).toBe(true);
    expect(isTestPath('src/overnight.js')).toBe(false);
    expect(isTestPath('types/index.d.ts')).toBe(false);
  });
});

describe('the record a bump and a release write', () => {
  it('tags are <dir>@<version>, as every release so far', () => {
    expect(tagName('dayglance-vault', '0.2.1')).toBe('dayglance-vault@0.2.1');
  });

  it('sets the version on the local package\'s lockfile entry, and leaves a lockfile without one alone', () => {
    const lock = { lockfileVersion: 3, packages: { '': { name: 'x' }, 'packages/agenda-core': { version: '0.2.1' } } };
    const next = withLockVersion(lock, 'packages/agenda-core', '0.2.2');
    expect(next.packages['packages/agenda-core']).toEqual({ version: '0.2.2' });
    expect(lock.packages['packages/agenda-core'].version).toBe('0.2.1');
    expect(withLockVersion(lock, '../packages/agenda-core', '0.2.2')).toBe(lock);
  });
});
