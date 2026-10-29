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
  // the fix landed in 2.0.5, and a package.json override forces it. The
  // SDK only imports getRequestListener (verified compatible across the major;
  // the vulnerable serve-static subpath was never even loaded), so drop the
  // override when @modelcontextprotocol/node's own range moves to ^2.
  //
  // RUNTIME COROLLARY of that override: @hono/node-server 2.x imports
  // "hono/ws" at module load, and hono is only its PEER dependency — npm
  // installs it in dev, but electron-builder's production-dependency walker
  // does not collect peer-installed packages into app.asar, which crashed
  // every packaged build at startup (ERR_MODULE_NOT_FOUND: hono). That is why
  // "hono" is a DIRECT dependency in package.json — do not remove it as
  // unused while the override keeps @hono/node-server on 2.x.
  //
  // GHSA-rmxm-3fg6-px4f (@hono/node-server serveStatic decodes the path twice,
  // published 2026-10-28) is FIXED the same way: the override's floor is now
  // >=2.1.3. GHSA-3cmx-xjww-583x and GHSA-9jhj-wvmw-cfx5 (i18next-http-backend
  // query injection through lng, and a protocol-relative URL from ns) are gone
  // with the package: it loaded translations over HTTP for one day in June
  // 2026 (189a11f6), until they were bundled at build time (d7f1ebe6), and
  // nothing has imported it since.
  //
  // The vite 5 dev-server advisories (GHSA-fx2h-pf6j-xcff, GHSA-4w7w-66w2-5vf9,
  // GHSA-rq7h-c2jc-7f22, GHSA-9jrq-w75r-8gcw), the launch-editor ones it pulled
  // in (GHSA-v6wh-96g9-6wx3, GHSA-587h-7wmj-h5pm, GHSA-698v-4r3x-3vcv,
  // GHSA-r825-w8mm-5pxw) and esbuild's (GHSA-67mh-4wv8-2f99) were deferred here
  // until the vite 5 -> 8 upgrade. They are FIXED by it: vite 8.3.5 is patched,
  // and it builds with rolldown, so esbuild is no longer in the tree.

  // Both published 2026-10 with no patched release (every version affected),
  // so there is nothing to upgrade or override to yet. Both are build-time
  // only: `npm ls --omit=dev` finds neither. Revisit when a fix ships.
  'GHSA-vfj7-8cjw-p6xm': {
    disposition: 'accept', pkg: 'braces (via tailwindcss: chokidar, micromatch)',
    reason: 'Stack-exhaustion DoS from deeply nested patterns. Tailwind runs at build time on the glob patterns in our own config, never on outside input. No patched version (all <=3.0.3).',
    review: '2026-11-30',
  },
  'GHSA-ch52-4w7c-c8xp': {
    disposition: 'accept', pkg: 'http-cache-semantics (via electron-builder: @electron/get, got, cacheable-request)',
    reason: 'max-stale handling can serve one user\'s cached response to another. Only the desktop packager uses it, to download Electron on the build machine: a single user, no shared cache. No patched version (all <=4.2.0).',
    review: '2026-11-30',
  },
  // Published 2026-10-06. GHSA-68fv-2mgg-jv7q (source-map-js, via postcss) is
  // FIXED by the package.json override to ^1.2.2 (postcss 8.5 asks for
  // ^1.2.1, so the pin is in-major). These two have no in-major fix:
  'GHSA-rj75-hqrm-r3gf': {
    disposition: 'accept', pkg: 'postcss-selector-parser (via tailwindcss 3: postcss-nested)',
    reason: 'Quadratic selector parsing can exhaust CPU. Tailwind 3 runs at build time over our own stylesheets, never over outside input. The fix is 7.1.6, a major above the ^6 tailwindcss 3 depends on; revisit with the tailwind 4 upgrade.',
    review: '2026-12-31',
  },
  // Published 2026-10-28, every release affected (latest is 4.3.1, from 2023).
  'GHSA-gcqx-w48m-w2h4': {
    disposition: 'accept', pkg: 'deepmerge (via vite-plugin-pwa: workbox-build, @rollup/plugin-node-resolve)',
    reason: 'mergeObject() can return objects with a poisoned prototype. Only the PWA build uses it, merging rollup\'s own resolver options on the build machine, never outside input; `npm ls --omit=dev` finds none. No patched version (all >=4.2.0 <=4.3.1); npm\'s only offer is vite-plugin-pwa 0.2.1, a major downgrade.',
    review: '2026-12-31',
  },
  'GHSA-hp3w-g68c-fv3c': {
    disposition: 'accept', pkg: 'sprintf-js (via electron-builder: @electron/get, global-agent, roarr)',
    reason: 'Unbounded precision specifiers in a format string can hang the process. Only the desktop packager\'s logger uses it, on the build machine, with its own format strings. No patched version (every release affected).',
    review: '2026-12-31',
  },
  // GHSA-mrhx-c7xc-m3w5 (zod, published 2026-10-23) is FIXED: the zod that
  // ships (MCP server, intents) is on ^4.6.7, and the only zod 3 copies came
  // from jimp, an unused devDependency (it made the iOS icons once, ad hoc),
  // now removed; scripts/gen-ios-icons.sh does that job with macOS's sips.
  // GHSA-x562-297c-g43g (electron), published the same day, is FIXED by the
  // move to ^43.7.6; GHSA-jr5w-w6x2-84p9 (electron, high, the compromised
  // eMudhra intermediates), published hours later, by ^43.8.1 (43.8.3 resolved).
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
