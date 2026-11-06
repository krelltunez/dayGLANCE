#!/usr/bin/env node
// Build the Obsidian bridge plugin and install it into a vault, for testing a
// build before it is released:
//
//   npm run bridge:install                 # the owner's vault (below)
//   npm run bridge:install -- "/path/to/Vault"
//
// The build is `build:stamped`, so the plugin's settings tab shows the build
// time beside the version: that is how to tell this build from the released
// one. Then turn dayGLANCE Bridge off and on in Obsidian (Settings, Community
// plugins), or restart Obsidian.
//
// This lives here rather than in dayglance-obsidian-plugin/ because that
// directory is copied to the public mirror (scripts/bridge-mirror/assemble.mjs).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_VAULT = "/Users/krell/Documents/Jason's Vault";
const PLUGIN_ID = 'dayglance-bridge';
// All three ship: a copy without styles.css shows ^dg- block ids again.
const FILES = ['main.js', 'manifest.json', 'styles.css'];

const pluginSrc = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dayglance-obsidian-plugin');
const vault = resolve(process.argv[2] || DEFAULT_VAULT);

if (!existsSync(join(vault, '.obsidian'))) {
  console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);
  console.error('Pass the vault path: npm run bridge:install -- "/path/to/Vault"');
  process.exit(1);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (args) => execFileSync(npm, args, { cwd: pluginSrc, stdio: 'inherit' });

if (!existsSync(join(pluginSrc, 'node_modules'))) {
  console.log('Installing the plugin\'s dependencies…');
  run(['ci', '--no-audit', '--no-fund']);
}
console.log('Building…');
run(['run', '-s', 'build:stamped']);

const dest = join(vault, '.obsidian', 'plugins', PLUGIN_ID);
mkdirSync(dest, { recursive: true });
for (const f of FILES) copyFileSync(join(pluginSrc, f), join(dest, f));

const { version } = JSON.parse(readFileSync(join(pluginSrc, 'manifest.json'), 'utf8'));
console.log(`\nInstalled dayGLANCE Bridge ${version} into ${dest}`);
console.log('In Obsidian: Settings → Community plugins → turn dayGLANCE Bridge off and on (or restart Obsidian).');
console.log('The plugin\'s settings tab shows the build time, so you can tell this build from a released one.');
