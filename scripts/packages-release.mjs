#!/usr/bin/env node
//
// Release tool for the shared @glance-apps/* packages in packages/.
//
// These packages are linked into the app with file: and published to npm for
// anyone building on them outside this repo (an external MCP server, a
// GLANCEvault-client host). A release is an npm publish plus a git tag
// <dir>@<version> on the commit it was published from. npm is the source of
// truth for what is out; the tag marks where it came from. The rules are pure,
// in scripts/packages-release-lib.mjs.
//
//   npm run packages                         status of every package (read-only)
//   npm run packages -- bump <pkg> <patch|minor|major|x.y.z> [--dry-run] [--update-dependents]
//   npm run packages -- publish [--yes]      publish what is not on npm yet, then tag
//   npm run packages -- tag-missing [--yes]  tag versions on npm that have no git tag
//
// <pkg> is the directory name under packages/ (agenda-core, dayglance-vault…).
//
// `publish` and `tag-missing` only print what they would do unless given
// --yes. `publish` first checks: a clean tree on main, level with
// origin/main; every package it publishes passes its tests and `npm publish
// --dry-run`; and every local package it requires is satisfied by the local
// version and is on npm or published in the same run. It publishes in
// dependency order, tags each package as it goes, and pushes the tags.
//
// `bump` sets a package's version in its package.json and in both lockfiles
// (the root's and the Obsidian plugin's). It refuses when a package that
// requires it would no longer accept the new version, unless given
// --update-dependents, which moves their range to ^<new> (they then need a
// bump of their own, which it says).

import fs from 'fs';
import path from 'path';
import { execFileSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  isTestPath, latestRelease, localRequirements, nextVersion, packageAction, publishOrder,
  requirementProblems, satisfies, tagName, withLockVersion,
} from './packages-release-lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
// Lockfiles that record the local packages, and the prefix of their entries.
const LOCKFILES = [
  { file: path.join(ROOT, 'package-lock.json'), prefix: 'packages/' },
  { file: path.join(ROOT, 'dayglance-obsidian-plugin', 'package-lock.json'), prefix: '../packages/' },
];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [command = 'status', ...rest] = args.filter((a) => !a.startsWith('--'));

function die(message) {
  console.error(`packages: ${message}`);
  process.exit(1);
}

const run = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
const git = (...a) => run('git', a);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, data) => fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);

// ── What is here ──────────────────────────────────────────────────────────

/** Every package under packages/: { dir, name, file, manifest }. */
function localPackages() {
  return fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(PACKAGES_DIR, d.name, 'package.json')))
    .map((d) => {
      const file = path.join(PACKAGES_DIR, d.name, 'package.json');
      const manifest = readJson(file);
      return { dir: d.name, name: manifest.name, file, manifest };
    })
    .filter((p) => !p.manifest.private)
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

/** The versions of `name` on npm; [] for a package npm does not have yet. */
function npmVersions(name) {
  const r = spawnSync('npm', ['view', name, 'versions', '--json'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) {
    if (/E404|404 Not Found/.test(`${r.stdout}${r.stderr}`)) return [];
    die(`npm view ${name} failed:\n${r.stderr || r.stdout}`);
  }
  const parsed = JSON.parse(r.stdout || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

const tags = () => new Set(git('tag', '-l').split('\n').filter(Boolean));

/** Source files of a package changed between `ref` and HEAD, tests excluded. */
function changedSince(ref, dir) {
  const out = git('diff', '--name-only', ref, 'HEAD', '--', `packages/${dir}`);
  return out.split('\n').filter(Boolean)
    .map((f) => f.slice(`packages/${dir}/`.length))
    .filter((f) => !isTestPath(f));
}

function gather() {
  const pkgs = localPackages();
  const allTags = tags();
  const npm = Object.fromEntries(pkgs.map((p) => [p.name, npmVersions(p.name)]));
  return pkgs.map((p) => {
    const version = p.manifest.version;
    const published = npm[p.name];
    const tagged = allTags.has(tagName(p.dir, version));
    const latest = latestRelease(published);
    // Where the version on npm came from: its tag, else the commit that set it.
    const latestTag = latest ? tagName(p.dir, latest) : null;
    const releaseRef = latestTag && allTags.has(latestTag) ? latestTag : (latest ? commitSettingVersion(p.dir, latest) : null);
    const changedSinceRelease = releaseRef ? changedSince(releaseRef, p.dir) : null;
    const untagged = published.filter((v) => latestRelease([v]) && !allTags.has(tagName(p.dir, v)));
    return { ...p, version, published, latest, tagged, untagged, ...packageAction({ version, npmVersions: published, tagged, changedSinceRelease }) };
  });
}

// ── status ────────────────────────────────────────────────────────────────

function status() {
  const rows = gather();
  const width = Math.max(...rows.map((r) => r.dir.length));
  console.log(`${'package'.padEnd(width)}  local    npm      action`);
  for (const r of rows) {
    console.log(`${r.dir.padEnd(width)}  ${r.version.padEnd(7)}  ${(r.latest || '-').padEnd(7)}  ${r.action}: ${r.detail}`);
    if (r.untagged.length) console.log(`${''.padEnd(width)}  ${''.padEnd(16)}  also untagged on npm: ${r.untagged.join(', ')}`);
  }
  const next = [];
  if (rows.some((r) => r.action === 'bump')) next.push('npm run packages -- bump <pkg> <patch|minor|x.y.z>   for each "bump" row');
  if (rows.some((r) => r.action === 'publish')) next.push('npm run packages -- publish        (then again with --yes)');
  if (rows.some((r) => r.untagged.length || r.action === 'tag')) next.push('npm run packages -- tag-missing    (then again with --yes)');
  if (next.length) console.log(`\nNext:\n  ${next.join('\n  ')}`);
  else console.log('\nEverything is published and tagged.');
}

// ── bump ──────────────────────────────────────────────────────────────────

function bump() {
  const [dir, step] = rest;
  if (!dir || !step) die('usage: npm run packages -- bump <pkg> <patch|minor|major|x.y.z> [--dry-run] [--update-dependents]');
  const pkgs = localPackages();
  const target = pkgs.find((p) => p.dir === dir);
  if (!target) die(`no package ${dir} in packages/ (have: ${pkgs.map((p) => p.dir).join(', ')})`);
  let next;
  try { next = nextVersion(target.manifest.version, step); } catch (e) { die(e.message); }
  const dryRun = flags.has('--dry-run');
  const say = (msg) => console.log(`${dryRun ? '[dry-run] ' : ''}${msg}`);

  // Packages that require this one and would no longer accept `next`.
  const local = new Set(pkgs.map((p) => p.name));
  const broken = pkgs.filter((p) => p !== target)
    .map((p) => ({ p, range: localRequirements(p.manifest, local)[target.name] }))
    .filter(({ range }) => range && !satisfies(next, range));
  if (broken.length && !flags.has('--update-dependents')) {
    die(`${target.dir} ${next} would break: ${broken.map(({ p, range }) => `${p.dir} requires ${range}`).join('; ')}.\n` +
      'Re-run with --update-dependents to move their ranges to ^' + next + ' (they then need a bump of their own).');
  }

  say(`${target.dir}: ${target.manifest.version} -> ${next}`);
  if (!dryRun) {
    const text = fs.readFileSync(target.file, 'utf8');
    const replaced = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${next}$2`);
    if (replaced === text) die(`could not find "version" in ${target.file}`);
    fs.writeFileSync(target.file, replaced);
  }
  for (const { file, prefix } of LOCKFILES) {
    if (!fs.existsSync(file)) continue;
    const lock = readJson(file);
    const entry = `${prefix}${target.dir}`;
    const updated = withLockVersion(lock, entry, next);
    if (updated === lock) continue;
    say(`  ${path.relative(ROOT, file)}: ${entry} -> ${next}`);
    if (!dryRun) writeJson(file, updated);
  }
  for (const { p } of broken) {
    say(`  ${p.dir}: requires ${target.name} ^${next} (bump ${p.dir} too before publishing)`);
    if (dryRun) continue;
    const manifest = readJson(p.file);
    for (const field of ['dependencies', 'peerDependencies']) {
      if (manifest[field]?.[target.name]) manifest[field][target.name] = `^${next}`;
    }
    writeJson(p.file, manifest);
  }
  if (!dryRun) console.log('\nReview the diff and commit it; publish from main once it is merged.');
}

// ── publish ───────────────────────────────────────────────────────────────

function checkTree() {
  if (git('status', '--porcelain')) die('the working tree has changes; publish from a clean checkout of main.');
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (branch !== 'main') die(`on ${branch}; publish from main, after the bump is merged.`);
  git('fetch', '--quiet', 'origin', 'main');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) die('main is not level with origin/main; pull (or push) first.');
}

function publish() {
  const yes = flags.has('--yes');
  const rows = gather();
  const bumpFirst = rows.filter((r) => r.action === 'bump');
  if (bumpFirst.length) {
    console.log(`Not published here, since their version was not raised (bump them first):\n${bumpFirst.map((r) => `  ${r.dir}: ${r.detail}`).join('\n')}\n`);
  }
  const todo = rows.filter((r) => r.action === 'publish');
  if (!todo.length) {
    console.log('Nothing to publish: every local version is on npm.');
    return;
  }
  const manifests = Object.fromEntries(rows.map((r) => [r.name, r.manifest]));
  const npm = Object.fromEntries(rows.map((r) => [r.name, r.published]));
  const order = publishOrder(todo.map((r) => r.name), manifests);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

  console.log(`To publish, in this order:\n${order.map((n) => `  ${byName[n].dir} ${byName[n].version}${byName[n].latest ? ` (npm has ${byName[n].latest})` : ''}`).join('\n')}\n`);

  const problems = requirementProblems(manifests, npm, new Set(order), order);
  if (problems.length) die(`requirements that would not install:\n${problems.map((p) => `  ${p.name}: ${p.reason}`).join('\n')}`);

  checkTree();
  console.log('Tree: clean, on main, level with origin/main.');

  for (const name of order) {
    const r = byName[name];
    process.stdout.write(`Testing ${r.dir}… `);
    const test = spawnSync('npx', ['vitest', 'run', `packages/${r.dir}`], { cwd: ROOT, encoding: 'utf8' });
    if (test.status !== 0) die(`tests failed for ${r.dir}:\n${test.stdout}\n${test.stderr}`);
    const dry = spawnSync('npm', ['publish', '--dry-run'], { cwd: path.join(PACKAGES_DIR, r.dir), encoding: 'utf8' });
    if (dry.status !== 0) die(`npm publish --dry-run failed for ${r.dir}:\n${dry.stderr || dry.stdout}`);
    console.log('tests and dry run pass.');
  }

  if (!yes) {
    console.log('\nDry run only. Re-run with --yes to publish, tag each package, and push the tags:');
    for (const name of order) console.log(`  npm publish (packages/${byName[name].dir}), then git tag ${tagName(byName[name].dir, byName[name].version)}`);
    return;
  }

  const who = spawnSync('npm', ['whoami'], { cwd: ROOT, encoding: 'utf8' });
  if (who.status !== 0) die('not logged in to npm (npm login), so nothing was published.');

  const created = [];
  const pushTags = () => {
    if (created.length) {
      git('push', 'origin', ...created);
      console.log(`Pushed tags: ${created.join(', ')}`);
    }
  };
  for (const name of order) {
    const r = byName[name];
    console.log(`Publishing ${r.name}@${r.version}…`);
    const pub = spawnSync('npm', ['publish'], { cwd: path.join(PACKAGES_DIR, r.dir), stdio: 'inherit' });
    if (pub.status !== 0) {
      pushTags();
      die(`npm publish failed for ${r.dir}. Published and tagged so far: ${created.join(', ') || 'nothing'}. Fix it and run publish again; it picks up from here.`);
    }
    const tag = tagName(r.dir, r.version);
    git('tag', tag);
    created.push(tag);
  }
  pushTags();
  console.log('\nDone.');
}

// ── tag-missing ───────────────────────────────────────────────────────────

/** The first commit at which packages/<dir>/package.json has `version`, or null. */
function commitSettingVersion(dir, version) {
  const file = `packages/${dir}/package.json`;
  const commits = git('log', '--reverse', '--format=%H', '--', file).split('\n').filter(Boolean);
  for (const c of commits) {
    try {
      if (JSON.parse(git('show', `${c}:${file}`)).version === version) return c;
    } catch { /* the file did not exist at that commit */ }
  }
  return null;
}

function tagMissing() {
  const yes = flags.has('--yes');
  const rows = gather();
  const plan = [];
  for (const r of rows) {
    for (const v of r.untagged) {
      const commit = commitSettingVersion(r.dir, v);
      plan.push({ tag: tagName(r.dir, v), commit });
    }
  }
  if (!plan.length) {
    console.log('Every version on npm has its git tag.');
    return;
  }
  for (const { tag, commit } of plan) {
    console.log(commit ? `${tag} -> ${commit.slice(0, 10)} (${git('log', '-1', '--format=%ad %s', '--date=short', commit)})` : `${tag}: no commit sets this version; tag it by hand`);
  }
  const ready = plan.filter((p) => p.commit);
  if (!yes) {
    console.log('\nDry run only. Re-run with --yes to create these tags and push them.');
    return;
  }
  for (const { tag, commit } of ready) git('tag', tag, commit);
  if (ready.length) git('push', 'origin', ...ready.map((p) => p.tag));
  console.log(`Created and pushed: ${ready.map((p) => p.tag).join(', ')}`);
}

// ── main ──────────────────────────────────────────────────────────────────

const commands = { status, bump, publish, 'tag-missing': tagMissing };
if (!commands[command]) die(`unknown command ${command}. Use status, bump, publish or tag-missing.`);
commands[command]();
