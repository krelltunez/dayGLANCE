import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CI cannot compile the Android app, but the string resources are plain XML —
 * so the mistakes that would break the next local build (or silently ship
 * English) are checked here: a locale key absent from the base file (aapt
 * error), a %1$d placeholder dropped in translation (getString crashes), an
 * unescaped apostrophe (aapt error), or a translatable key missing from a
 * locale (silently English). Plurals are validated item-by-item.
 */
const RES = join(dirname(fileURLToPath(import.meta.url)), '../dayglance-android/app/src/main/res');

const UNTRANSLATED = new Set(['app_name']);

function parseStrings(path) {
  const xml = readFileSync(path, 'utf8');
  const out = new Map();
  for (const m of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) out.set(m[1], m[2]);
  for (const m of xml.matchAll(/<plurals name="([^"]+)">([\s\S]*?)<\/plurals>/g)) {
    for (const item of m[2].matchAll(/<item quantity="(\w+)">([\s\S]*?)<\/item>/g)) {
      out.set(`${m[1]}#${item[1]}`, item[2]);
    }
  }
  return out;
}

const base = parseStrings(join(RES, 'values/strings.xml'));
const locales = readdirSync(RES).filter((d) => /^values-[a-z]{2}(-r[A-Z]{2})?$/.test(d));
const placeholders = (v) => (v.match(/%(\d\$)?[sd]/g) ?? []).sort().join(',');

describe('Android string resources', () => {
  it('found the locale directories', () => {
    expect(locales.length).toBeGreaterThanOrEqual(5);
  });

  it.each(locales)('%s carries no keys absent from the base file', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'));
    expect(strings.size).toBeGreaterThan(0);
    const extra = [...strings.keys()].filter((k) => !base.has(k));
    expect(extra, `${loc} has keys aapt would reject`).toEqual([]);
  });

  it.each(locales)('%s translates every translatable key', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'));
    const missing = [...base.keys()].filter((k) => !UNTRANSLATED.has(k.split('#')[0]) && !strings.has(k));
    expect(missing, `${loc} would silently render these in English`).toEqual([]);
  });

  it.each(locales)('%s keeps every format placeholder', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'));
    const mismatched = [...strings]
      .filter(([k, v]) => placeholders(v) !== placeholders(base.get(k) ?? ''))
      .map(([k]) => k);
    expect(mismatched, `${loc} placeholder mismatches crash getString at runtime`).toEqual([]);
  });

  it.each(locales)('%s escapes apostrophes for aapt', (loc) => {
    const strings = parseStrings(join(RES, loc, 'strings.xml'));
    const bad = [...strings].filter(([, v]) => /(^|[^\\])'/.test(v)).map(([k]) => k);
    expect(bad, `${loc} unescaped apostrophes fail the resource compile`).toEqual([]);
  });

  it('layout files reference only strings that exist', () => {
    const layouts = join(RES, 'layout');
    const missing = [];
    for (const f of readdirSync(layouts).filter((f) => f.endsWith('.xml'))) {
      const xml = readFileSync(join(layouts, f), 'utf8');
      for (const m of xml.matchAll(/@string\/(\w+)/g)) {
        if (!base.has(m[1])) missing.push(`${f}: @string/${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
