#!/usr/bin/env node
//
// dayGLANCE version bumper.
//
// Sets the app's marketing version everywhere it is hard-coded, in one shot,
// so a release never ships with mismatched numbers across platforms.
//
// package.json "version" is the source of truth. The iOS project
// (CFBundleShortVersionString / MARKETING_VERSION) and the Electron desktop
// build (CFBundleShortVersionString) both read package.json at build time
// — see scripts/gen-ios-project.sh and electron-builder — so those need no
// direct edit here. The locations this script rewrites are the ones that do
// NOT derive from package.json automatically:
//
//   1. package.json               "version"      (the source of truth)
//   2. dayglance-android build.gradle.kts  versionName  (string, set to x.y.z)
//                                          versionCode  (integer, +1 each bump)
//   3. README.md                  shields.io version badge URL
//
// Behavior:
//   node scripts/bump-version.mjs 4.0.0            # bump for real
//   node scripts/bump-version.mjs 4.0.0 --dry-run  # print, write nothing
//   node scripts/bump-version.mjs --code-only      # bump ONLY the Android
//                                                  # versionCode (+1), for
//                                                  # test-track uploads
//
// --code-only takes no version argument and touches nothing but the Android
// versionCode. Use it for internal-test-track builds that need a fresh
// versionCode without disturbing the marketing version across platforms.
//
// It validates the arg is semver x.y.z, prints every change old -> new, and
// ERRORS loudly if any expected pattern is missing rather than silently
// no-op'ing. It does NOT git-commit or tag — that stays a human step.
//
// Usage:  npm run bump 4.0.0   (alias for this script)
//         npm run bump -- --code-only

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ── Args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const codeOnly = args.includes('--code-only');
const version = args.find((a) => !a.startsWith('--'));

function die(msg) {
  console.error(`bump-version: ${msg}`);
  process.exit(1);
}

if (codeOnly) {
  if (version) {
    die('--code-only bumps only the Android versionCode and takes no version argument.');
  }
} else {
  if (!version) {
    die('missing version argument. Usage: node scripts/bump-version.mjs X.Y.Z [--dry-run] | --code-only');
  }
  // Strict semver x.y.z — no prerelease/build metadata, no leading "v".
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    die(`"${version}" is not a valid X.Y.Z version (expected e.g. 4.0.0).`);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────
const changes = []; // { file, label, from, to }

function read(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) die(`expected file not found: ${rel}`);
  return { abs, text: fs.readFileSync(abs, 'utf8') };
}

// Apply a single regex substitution; ERROR if the pattern is not found so a
// drifted file can never be silently skipped. `re` MUST be shaped
// (prefix)(value)(suffix) — group 2 is the old value used in the report.
function sub(text, re, replacer, { file, label, to }) {
  const m = text.match(re);
  if (!m) {
    die(`could not find ${label} in ${file} (pattern ${re}). Aborting — no files written.`);
  }
  const from = m[2];
  const next = text.replace(re, replacer);
  changes.push({ file, label, from, to });
  return next;
}

// Bump the Android versionCode (monotonic integer for the Play Store) by 1.
// Shared by the full bump and --code-only. Returns the rewritten gradle text.
const codeRe = /(versionCode\s*=\s*)(\d+)/;
function bumpVersionCode(gradleRel, gradleTextIn) {
  const codeMatch = gradleTextIn.match(codeRe);
  if (!codeMatch) {
    die(`could not find versionCode in ${gradleRel}. Aborting — no files written.`);
  }
  const oldCode = parseInt(codeMatch[2], 10);
  const newCode = oldCode + 1;
  changes.push({ file: gradleRel, label: 'versionCode', from: String(oldCode), to: String(newCode) });
  return gradleTextIn.replace(codeRe, (_all, pre) => `${pre}${newCode}`);
}

// ── --code-only: bump the Android versionCode and stop ────────────────────
const gradleRel = 'dayglance-android/app/build.gradle.kts';

if (codeOnly) {
  const gradle = read(gradleRel);
  const gradleText = bumpVersionCode(gradleRel, gradle.text);

  console.log(`bump-version: bumping Android versionCode only${dryRun ? '  (dry run — nothing written)' : ''}\n`);
  for (const c of changes) {
    console.log(`  ${c.file}`);
    console.log(`    ${c.label}: ${c.from} -> ${c.to}`);
  }
  console.log('');

  if (dryRun) {
    console.log('Dry run complete. Re-run without --dry-run to write this change.');
    process.exit(0);
  }
  fs.writeFileSync(gradle.abs, gradleText);
  console.log('File written.\n');
  console.log('The marketing version is unchanged; only the Android versionCode moved.');
  console.log('Build the release AAB/APK for your internal test track as usual.');
  process.exit(0);
}

// ── 1. package.json ──────────────────────────────────────────────────────
const pkg = read('package.json');
const pkgText = sub(
  pkg.text,
  /("version":\s*")(\d+\.\d+\.\d+)(")/,
  (_all, pre, _old, post) => `${pre}${version}${post}`,
  { file: 'package.json', label: 'version', to: version },
);

// ── 2. dayglance-android/app/build.gradle.kts ─────────────────────────────
// versionName is unified to the full x.y.z. It had previously been "3.10"
// (no patch component), which drifts from package.json's x.y.z and makes the
// Play Store listing look out of step with iOS/Electron. Always write x.y.z.
const gradle = read(gradleRel);
let gradleText = sub(
  gradle.text,
  /(versionName\s*=\s*")([^"]+)(")/,
  (_all, pre, _old, post) => `${pre}${version}${post}`,
  { file: gradleRel, label: 'versionName', to: version },
);

// versionCode is a monotonically increasing integer for the Play Store;
// increment it by 1 rather than deriving it from the marketing version.
gradleText = bumpVersionCode(gradleRel, gradleText);

// ── 3. README.md shields.io badge ─────────────────────────────────────────
// e.g.  https://img.shields.io/badge/version-3.10.0-green.svg
const readme = read('README.md');
const readmeText = sub(
  readme.text,
  /(shields\.io\/badge\/version-)(\d+\.\d+\.\d+)(-)/,
  (_all, pre, _old, post) => `${pre}${version}${post}`,
  { file: 'README.md', label: 'version badge', to: version },
);

// ── Report ────────────────────────────────────────────────────────────────
console.log(`bump-version: setting version to ${version}${dryRun ? '  (dry run — nothing written)' : ''}\n`);
for (const c of changes) {
  console.log(`  ${c.file}`);
  console.log(`    ${c.label}: ${c.from} -> ${c.to}`);
}
console.log('');

if (dryRun) {
  console.log('Dry run complete. Re-run without --dry-run to write these changes.');
  process.exit(0);
}

// ── Write ─────────────────────────────────────────────────────────────────
fs.writeFileSync(pkg.abs, pkgText);
fs.writeFileSync(gradle.abs, gradleText);
fs.writeFileSync(readme.abs, readmeText);

console.log('Files written.\n');
console.log('Next steps:');
console.log('  1. Review the diff:   git diff');
console.log('  2. Commit the bump:   git add -A && git commit');
console.log('  3. Regenerate the iOS project so MARKETING_VERSION updates BEFORE archiving:');
console.log('       npm run ios:generate');
console.log('  4. Follow RELEASING.md for the full tag / build / publish sequence.');
