import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// Every caller of agenda-core's frameInstancesForDate passes the frame sets
// (#2305). A caller that forgets them is not an error anywhere: it shows every
// set's frames on every date, so the timeline, dial, launcher, widgets, MCP
// and JOBO would disagree about which frames a date holds, and nothing else
// would notice. The behaviour of each surface has its own scenario; this is
// the net under all of them, so a NEW caller cannot slip past.
//
// Scope: files that import frameInstancesForDate from agenda-core. Files that
// receive an injected `frameInstancesForDate` (utils/launcherSnapshot.js) call
// whatever the root built, which is pinned at the root.

const ROOTS = ['src', 'packages/dayglance-mcp/src', 'electron'];
const IMPORT = /import\s*\{[^}]*\bframeInstancesForDate\b[^}]*\}\s*from\s*['"]@glance-apps\/agenda-core['"]/;

function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') sources(path, out); }
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(path);
  }
  return out;
}

/** The argument text of each `frameInstancesForDate(` call in `source`. */
function callArguments(source) {
  const calls = [];
  const re = /\bframeInstancesForDate\(/g;
  let m;
  while ((m = re.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
    }
    calls.push(source.slice(start, i - 1));
  }
  return calls;
}

describe('every frameInstancesForDate caller passes the frame sets', () => {
  const root = process.cwd();
  const files = ROOTS.flatMap((r) => sources(join(root, r))).filter((f) => IMPORT.test(readFileSync(f, 'utf8')));

  it('finds the callers (so an empty scan cannot pass)', () => {
    const names = files.map((f) => relative(root, f)).sort();
    expect(names).toEqual(expect.arrayContaining([
      'src/App.jsx',
      'src/headless/HeadlessRefresh.jsx',
      'packages/dayglance-mcp/src/frames.js',
    ]));
  });

  it.each(ROOTS)('in %s, each call names frameSets', (dir) => {
    const offenders = [];
    for (const file of files.filter((f) => relative(root, f).startsWith(dir))) {
      for (const args of callArguments(readFileSync(file, 'utf8'))) {
        if (!/\bframeSets\b/.test(args)) offenders.push(`${relative(root, file)}: frameInstancesForDate(${args.replace(/\s+/g, ' ').trim()})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads the argument list of a nested call whole', () => {
    expect(callArguments('x(frameInstancesForDate(a.filter((f) => g(f)), d, { frameSets }))')).toEqual(['a.filter((f) => g(f)), d, { frameSets }']);
  });
});
