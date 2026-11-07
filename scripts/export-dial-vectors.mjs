#!/usr/bin/env node
// Writes the Day Dial fixtures under dayglance-ios/TestFixtures/:
//   dayDial.vectors.json      geometry vectors (src/utils/dayDialVectors.js)
//   widgetSnapshot.live.json  a live-shaped widget snapshot
//                             (src/utils/widgetSnapshotFixture.js)
//   overnight.vectors.json    the overnight carry rule over launcher snapshot
//                             rows (src/utils/overnightVectors.js, #2278)
// dayDialVectors.test.js, widgetSnapshotFixture.test.js and
// overnightVectors.test.js fail when a committed file no longer matches, so
// run this after any change to dayDial.js's geometry, to what the snapshot
// carries or to agenda-core's overnight.js, and commit.
//
// Usage: npm run ios:vectors

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

import { buildDialVectors, VECTORS_PATH, VECTORS_TIMEZONE } from '../src/utils/dayDialVectors.js';
import { buildLiveWidgetSnapshot, LIVE_SNAPSHOT_PATH, LIVE_SNAPSHOT_TIMEZONE } from '../src/utils/widgetSnapshotFixture.js';
import { buildOvernightVectors, OVERNIGHT_VECTORS_PATH } from '../src/utils/overnightVectors.js';

// The sky section reads the host clock's zone; pin it before building. Node
// re-reads TZ on assignment, and the builder constructs every Date at call
// time, so this is enough — no re-exec.
process.env.TZ = VECTORS_TIMEZONE;

const vectors = buildDialVectors();
const out = resolve(root, VECTORS_PATH);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(vectors, null, 2)}\n`);
console.log(`export-dial-vectors: wrote ${VECTORS_PATH} — ${vectors.counts.geometry} geometry + ${vectors.counts.sky} sky + ${vectors.counts.snapshot} snapshot cases (TZ=${VECTORS_TIMEZONE})`);

process.env.TZ = LIVE_SNAPSHOT_TIMEZONE;
const snapshot = buildLiveWidgetSnapshot();
const snapshotOut = resolve(root, LIVE_SNAPSHOT_PATH);
writeFileSync(snapshotOut, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`export-dial-vectors: wrote ${LIVE_SNAPSHOT_PATH} — ${snapshot.date} + ${snapshot.days.length} projected days, sky ${snapshot.sky ? 'present' : 'ABSENT'} (TZ=${LIVE_SNAPSHOT_TIMEZONE})`);

// Zone-free: dates and minutes only.
const overnight = buildOvernightVectors();
writeFileSync(resolve(root, OVERNIGHT_VECTORS_PATH), `${JSON.stringify(overnight, null, 2)}\n`);
console.log(`export-dial-vectors: wrote ${OVERNIGHT_VECTORS_PATH} — ${overnight.spill.cases.length} spill + ${overnight.continuations.cases.length} continuation + ${overnight.frameSlots.cases.length} frame cases`);
