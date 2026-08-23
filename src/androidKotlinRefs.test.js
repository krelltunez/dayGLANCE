import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CI cannot compile the Android app, so two compile-error classes that the
 * localization work actually shipped are caught here instead of on someone's
 * machine mid-release.
 *
 * Both come from the same move: replacing a hardcoded literal with
 * `context.getString(R.string.x)`. That needs a `context` in scope and an `x`
 * in strings.xml, and neither is checked by anything else in this repo.
 * `androidStrings.test.js` validates the resources and the layout @string
 * references; these are the Kotlin-side references it does not cover.
 *
 * Deliberately conservative. A missed break costs a build cycle; a false
 * positive blocks a green build, so every check below is written to stay quiet
 * unless it is certain.
 */
const ANDROID = join(
  dirname(fileURLToPath(import.meta.url)),
  '../dayglance-android/app/src/main',
);

/** Every .kt file under the app source tree. */
function kotlinFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...kotlinFiles(full));
    else if (entry.name.endsWith('.kt')) out.push(full);
  }
  return out;
}

const SOURCES = kotlinFiles(join(ANDROID, 'java')).map((path) => ({
  rel: relative(ANDROID, path),
  src: readFileSync(path, 'utf8'),
}));

/** Names defined in the base strings.xml, including plurals and arrays. */
function definedStringNames() {
  const xml = readFileSync(join(ANDROID, 'res/values/strings.xml'), 'utf8');
  return new Set([...xml.matchAll(/<(?:string|plurals|string-array)\s+name="([^"]+)"/g)].map((m) => m[1]));
}

/**
 * Member functions that call `context.something` without a `context` in scope.
 *
 * Scope is satisfied by a `context: Context` parameter, a class-level context
 * property, or a local `val context`. Anything else is a genuine unresolved
 * reference, which is exactly how ProjectWidget.bindProjectViews shipped broken:
 * the literal became context.getString(...) but the signature was never threaded.
 */
function unresolvedContextUses({ rel, src }) {
  const hits = [];
  const classHoldsContext = /class \w+[^{]*\bval context: Context/.test(src);
  if (classHoldsContext) return hits;

  const headers = [...src.matchAll(/^[ \t]*(?:override |private |internal |public |suspend )*fun (\w+)\s*\(/gm)];
  for (const [index, header] of headers.entries()) {
    // Signature spans to its matching close paren, so multi-line ones are handled.
    let i = src.indexOf('(', header.index + header[0].length - 1);
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    const signature = src.slice(i, j + 1);
    const bodyEnd = headers[index + 1]?.index ?? src.length;
    const body = src.slice(j, bodyEnd);

    if (!/\bcontext\s*\./.test(body)) continue;
    if (/\bcontext\s*:\s*Context/.test(signature)) continue;
    if (/\bval context\b/.test(body)) continue;

    const line = src.slice(0, j).split('\n').length;
    hits.push(`${rel}:${line} fun ${header[1]}()`);
  }
  return hits;
}

describe('Android Kotlin references (CI cannot compile these)', () => {
  it('finds the Kotlin sources', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  it('resolves every R.string and R.plurals reference in Kotlin', () => {
    const defined = definedStringNames();
    expect(defined.size).toBeGreaterThan(0);

    const missing = [];
    for (const { rel, src } of SOURCES) {
      for (const m of src.matchAll(/R\.(?:string|plurals)\.(\w+)/g)) {
        if (!defined.has(m[1])) missing.push(`${rel}: R.string.${m[1]}`);
      }
    }
    expect(missing, 'these would fail to compile: no such entry in values/strings.xml').toEqual([]);
  });

  it('keeps a context in scope wherever Kotlin calls context.*', () => {
    const broken = SOURCES.flatMap(unresolvedContextUses);
    expect(
      broken,
      'these functions call context.* with no context parameter, class property, ' +
        'or local val in scope, which is an Unresolved reference at compile time',
    ).toEqual([]);
  });
});
