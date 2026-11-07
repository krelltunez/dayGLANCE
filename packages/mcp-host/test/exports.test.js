// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as kit from '../src/index.js';
import * as dates from '../src/dates.js';

// The declarations are hand-written: a TypeScript host compiles against them,
// so a runtime export they forget is invisible to it, and a declared one the
// JavaScript lacks fails at run time. Hold the two lists equal.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const declaredIn = (text) => [...text.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
// index.d.ts re-exports the date rules from dates.d.ts (the ./dates entry).
const datesDts = read('../types/dates.d.ts');
const dts = `${read('../types/index.d.ts')}\n${datesDts}`;
const declared = declaredIn(dts);

describe('types/index.d.ts', () => {
  it('declares exactly the runtime exports', () => {
    expect(declared).toEqual(Object.keys(kit).sort());
  });

  it('declares functions as functions and constants as values', () => {
    for (const m of dts.matchAll(/^export function (\w+)/gm)) expect(typeof kit[m[1]], m[1]).toBe('function');
    for (const m of dts.matchAll(/^export const (\w+)/gm)) expect(typeof kit[m[1]], m[1]).not.toBe('function');
  });
});

describe('the ./dates entry point', () => {
  const pkg = JSON.parse(read('../package.json'));

  it('is mapped in exports, beside the root, with its own declarations', () => {
    expect(pkg.exports['.']).toEqual({ types: './types/index.d.ts', default: './src/index.js' });
    expect(pkg.exports['./dates']).toEqual({ types: './types/dates.d.ts', default: './src/dates.js' });
    // Electron's tsc resolves the root without exports (moduleResolution node).
    expect(pkg.main).toBe('src/index.js');
    expect(pkg.types).toBe('types/index.d.ts');
    expect(read('../types/index.d.ts')).toMatch(/^export \* from '\.\/dates';$/m);
  });

  it('declares exactly what src/dates.js exports', () => {
    expect(declaredIn(datesDts)).toEqual(Object.keys(dates).sort());
  });

  it('imports nothing, so a browser bundle can load it (the root loads node:http)', () => {
    expect(read('../src/dates.js')).not.toMatch(/^\s*(?:import|export) [^;]*? from /m);
  });
});

