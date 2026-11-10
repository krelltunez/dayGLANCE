// The rules behind scripts/packages-release.mjs, the release tool for the
// shared @glance-apps/* packages in packages/. Pure: no git, npm or files
// here, so every rule is testable (packages-release-lib.test.js).
//
// A package is released when its version is on npm AND tagged in git as
// <name>@<version> (e.g. dayglance-vault@0.2.1), the convention every release
// so far has followed. npm is what an outside consumer installs, so npm is the
// source of truth for "published"; the tag marks the commit it came from.

/** `x.y.z` as numbers, or null for anything else (prereleases such as 0.0.0-stage included). */
export function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative, zero or positive, as a sorts before, equals or after b. Invalid versions sort first. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The highest release version in `versions`, ignoring prereleases; null when there is none. */
export function latestRelease(versions = []) {
  const releases = versions.filter((v) => parseVersion(v));
  return releases.length ? releases.sort(compareVersions).at(-1) : null;
}

/**
 * The version after `current` for a `patch` or `minor` step, or `next` itself
 * when it is an explicit x.y.z above `current`. Throws on anything else.
 */
export function nextVersion(current, next) {
  const c = parseVersion(current);
  if (!c) throw new Error(`current version ${JSON.stringify(current)} is not x.y.z`);
  if (next === 'patch') return `${c[0]}.${c[1]}.${c[2] + 1}`;
  if (next === 'minor') return `${c[0]}.${c[1] + 1}.0`;
  if (next === 'major') return `${c[0] + 1}.0.0`;
  if (!parseVersion(next)) throw new Error(`${JSON.stringify(next)} is not patch, minor, major or x.y.z`);
  if (compareVersions(next, current) <= 0) throw new Error(`${next} is not above the current ${current}`);
  return next;
}

/**
 * Whether `version` satisfies `range`. Handles what these packages use: exact
 * versions, `^x.y.z` (with npm's 0.x rule: ^0.2.0 means >=0.2.0 <0.3.0, and
 * ^0.0.3 means exactly 0.0.3), `>=x.y.z`, and alternatives joined by `||`.
 * Anything else is reported as unsatisfied rather than guessed at.
 */
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return false;
  return String(range).split('||').map((r) => r.trim()).some((r) => {
    if (r.startsWith('^')) {
      const base = parseVersion(r.slice(1));
      if (!base || compareVersions(version, r.slice(1)) < 0) return false;
      if (base[0] > 0) return v[0] === base[0];
      if (base[1] > 0) return v[0] === 0 && v[1] === base[1];
      return v[0] === 0 && v[1] === 0 && v[2] === base[2];
    }
    if (r.startsWith('>=')) return parseVersion(r.slice(2)) ? compareVersions(version, r.slice(2)) >= 0 : false;
    return parseVersion(r) ? compareVersions(version, r) === 0 : false;
  });
}

/** A package's @glance-apps/* dependencies and peers, as { [name]: range }, local packages only. */
export function localRequirements(pkg, localNames) {
  const out = {};
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(pkg?.[field] || {})) {
      if (localNames.has(name)) out[name] = range;
    }
  }
  return out;
}

/**
 * `names` in an order where every package comes after the local packages it
 * requires, so each is published only once what it needs is on npm. Ties keep
 * the given order. Throws on a cycle.
 */
export function publishOrder(names, manifests) {
  const local = new Set(Object.keys(manifests));
  const wanted = new Set(names);
  const out = [];
  const state = new Map(); // name -> 'visiting' | 'done'
  const visit = (name, trail) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') throw new Error(`dependency cycle: ${[...trail, name].join(' -> ')}`);
    state.set(name, 'visiting');
    for (const dep of Object.keys(localRequirements(manifests[name], local))) {
      if (wanted.has(dep)) visit(dep, [...trail, name]);
    }
    state.set(name, 'done');
    out.push(name);
  };
  for (const name of names) visit(name, []);
  return out;
}

/**
 * Every local requirement that the version it will be installed against does
 * not satisfy. Each package is checked against the local version of what it
 * requires (what its tests ran against), which must also be on npm already or
 * be published in the same run, or the published package could not install.
 *
 * @param {Record<string, object>} manifests  name -> package.json
 * @param {Record<string, string[]>} npmVersions  name -> versions on npm
 * @param {Set<string>} publishing  names this run publishes
 * @param {string[]} [only]  check only these packages (default: all)
 * @returns {{ name: string, dep: string, range: string, version: string, reason: string }[]}
 */
export function requirementProblems(manifests, npmVersions, publishing, only = Object.keys(manifests)) {
  const local = new Set(Object.keys(manifests));
  const problems = [];
  for (const name of only) {
    for (const [dep, range] of Object.entries(localRequirements(manifests[name], local))) {
      const version = manifests[dep]?.version;
      if (!satisfies(version, range)) {
        problems.push({ name, dep, range, version, reason: `requires ${dep} ${range}, but the local ${dep} is ${version}` });
      } else if (!publishing.has(dep) && !(npmVersions[dep] || []).includes(version)) {
        problems.push({ name, dep, range, version, reason: `requires ${dep} ${version}, which is not on npm and not published in this run` });
      }
    }
  }
  return problems;
}

/**
 * What a package needs, from what is known about it, most pressing first:
 *   publish        its version is not on npm yet
 *   bump           its source changed after the published version, but the
 *                  version was not raised, so the change cannot be published
 *                  (it outranks a missing tag: the tag can follow any time)
 *   tag            the published version has no git tag
 *   ok             nothing to do
 * `changedSinceRelease` is the list of source files (tests excluded) changed
 * since the commit the published version came from (its tag, else the commit
 * that set that version); null when that commit is not known.
 */
export function packageAction({ version, npmVersions = [], tagged = false, changedSinceRelease = null }) {
  if (!npmVersions.includes(version)) return { action: 'publish', detail: `${version} is not on npm` };
  if (changedSinceRelease && changedSinceRelease.length) {
    return { action: 'bump', detail: `changed since ${version}: ${changedSinceRelease.join(', ')}` };
  }
  if (!tagged) return { action: 'tag', detail: `${version} is on npm but has no git tag` };
  return { action: 'ok', detail: `${version} is on npm and tagged` };
}

/** Whether a path inside a package is a test or fixture, which never needs a release. */
export const isTestPath = (file) => /(^|\/)test\//.test(file) || /\.test\.[cm]?[jt]sx?$/.test(file);

/** The git tag a package version is released under. */
export const tagName = (shortName, version) => `${shortName}@${version}`;

/**
 * A lockfile with the version of the local package at `entryPath` (e.g.
 * 'packages/dayglance-vault', or '../packages/agenda-core' in the Obsidian
 * plugin's) set to `version`. The same object when it has no such entry.
 */
export function withLockVersion(lock, entryPath, version) {
  if (!lock?.packages?.[entryPath]) return lock;
  return { ...lock, packages: { ...lock.packages, [entryPath]: { ...lock.packages[entryPath], version } } };
}
