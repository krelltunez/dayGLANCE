#!/usr/bin/env node
// Filtered `npm audit` — surfaces only advisories we have NOT already triaged.
//
// npm's own CLI can't ignore specific advisories, so this wraps
// `npm audit --json` and applies an explicit, reviewed allowlist. Every entry
// has a disposition, a reason, and a review date:
//
//   - 'defer'  : a real issue we intend to fix later (printed as a reminder)
//   - 'accept' : dev/build-only, no clean fix, negligible real risk (suppressed)
//
// Anything NOT in the list is treated as NEW and fails the check (exit 1), so a
// genuinely new vulnerability still gets attention instead of hiding in the
// dev-tooling noise. Past-due review dates print a nudge but do not fail.
//
// Run with:  npm run audit
//
// All of these are build/dev-time only (bundler, linter, desktop packager) and
// never ship to users or the Docker runtime — see the reasons below.

import { spawnSync } from 'node:child_process';

const ACK = {
  // GHSA-mh99-v99m-4gvg (brace-expansion) was accepted here while no in-major
  // patch existed. Its bypass advisory (GHSA-rgw5-rvv9-x895) shipped in-major
  // fixes for BOTH (1.1.18 / 2.1.4 / 5.0.9), now forced via package.json
  // per-major overrides — so both advisories are FIXED, not acknowledged.
  //
  // GHSA-frvp-7c67-39w9 (@hono/node-server serve-static path traversal, via
  // @modelcontextprotocol/node) is FIXED the same way: the SDK pins ^1.19.9,
  // the fix landed in 2.0.5, and a package.json override forces >=2.0.5. The
  // SDK only imports getRequestListener (verified compatible across the major;
  // the vulnerable serve-static subpath was never even loaded), so drop the
  // override when @modelcontextprotocol/node's own range moves to ^2.
  'GHSA-fx2h-pf6j-xcff': {
    disposition: 'defer', pkg: 'vite',
    reason: 'Dev-server `server.fs.deny` bypass (Windows only). Fix with the vite 5->8 upgrade.',
    review: '2026-12-31',
  },
  'GHSA-4w7w-66w2-5vf9': {
    disposition: 'defer', pkg: 'vite',
    reason: 'Dev optimized-deps `.map` path traversal. Fix with the vite 5->8 upgrade.',
    review: '2026-12-31',
  },
  'GHSA-v6wh-96g9-6wx3': {
    disposition: 'defer', pkg: 'launch-editor (via vite)',
    reason: 'NTLMv2 hash disclosure (Windows only). Fix with the vite 5->8 upgrade.',
    review: '2026-12-31',
  },
  'GHSA-67mh-4wv8-2f99': {
    disposition: 'defer', pkg: 'esbuild',
    reason: 'Dev-server request/response exposure to any website. Fix with the vite 5->8 upgrade.',
    review: '2026-12-31',
  },
};

const res = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
let data;
try {
  data = JSON.parse(res.stdout);
} catch {
  console.error('Could not parse `npm audit --json` output:\n' + (res.stderr || res.stdout));
  process.exit(2);
}

// Collapse the per-package vulnerability list into unique advisories.
const present = new Map(); // id -> { severity, title, pkgs:Set }
for (const [pkg, info] of Object.entries(data.vulnerabilities ?? {})) {
  for (const v of info.via ?? []) {
    if (typeof v !== 'object') continue;
    const id = (v.url ?? '').split('/').pop() || v.title;
    if (!id) continue;
    const e = present.get(id) ?? { severity: v.severity, title: v.title, pkgs: new Set() };
    e.pkgs.add(v.name ?? pkg);
    present.set(id, e);
  }
}

const today = new Date().toISOString().slice(0, 10);
const rank = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };
const overdue = (r) => r && r < today;
const line = (id, e) =>
  `  [${String(e.severity || '?').padEnd(8)}] ${id}  (${[...e.pkgs].join(', ')})\n` +
  `            ${e.title || ''}`;

const unacked = [], deferred = [], accepted = [];
for (const [id, e] of present) {
  const ack = ACK[id];
  if (!ack) unacked.push([id, e]);
  else if (ack.disposition === 'defer') deferred.push([id, e, ack]);
  else accepted.push([id, e, ack]);
}

if (deferred.length) {
  console.log(`\nDeferred — intend to fix (${deferred.length}):`);
  for (const [id, e, ack] of deferred) {
    console.log(line(id, e));
    console.log(`            -> ${ack.reason}` + (overdue(ack.review) ? `  [review overdue: ${ack.review}]` : ''));
  }
}

if (accepted.length) {
  console.log(`\nAccepted — dev/build-only, no clean fix (${accepted.length}, suppressed):`);
  for (const [id, , ack] of accepted) {
    console.log(`  ${id} (${ack.pkg})` + (overdue(ack.review) ? `  [review overdue: ${ack.review}]` : ''));
  }
}

if (unacked.length) {
  unacked.sort((a, b) => (rank[b[1].severity] || 0) - (rank[a[1].severity] || 0));
  console.log(`\n[FAIL] NEW / untriaged advisories (${unacked.length}) — review these:`);
  for (const [id, e] of unacked) console.log(line(id, e));
  console.log(
    `\nEach must be fixed, or added to the ACK list in scripts/audit-check.mjs\n` +
    `with a disposition, reason, and review date once triaged.`,
  );
  process.exit(1);
}

console.log(`\n[OK] No untriaged advisories. (${deferred.length} deferred, ${accepted.length} accepted)`);
process.exit(0);
