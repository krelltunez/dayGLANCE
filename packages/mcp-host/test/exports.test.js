// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as kit from '../src/index.js';

// The declarations are hand-written: a TypeScript host compiles against them,
// so a runtime export they forget is invisible to it, and a declared one the
// JavaScript lacks fails at run time. Hold the two lists equal.

const dts = readFileSync(fileURLToPath(new URL('../types/index.d.ts', import.meta.url)), 'utf8');
const declared = [...dts.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();

describe('types/index.d.ts', () => {
  it('declares exactly the runtime exports', () => {
    expect(declared).toEqual(Object.keys(kit).sort());
  });

  it('declares functions as functions and constants as values', () => {
    for (const m of dts.matchAll(/^export function (\w+)/gm)) expect(typeof kit[m[1]], m[1]).toBe('function');
    for (const m of dts.matchAll(/^export const (\w+)/gm)) expect(typeof kit[m[1]], m[1]).not.toBe('function');
  });
});
