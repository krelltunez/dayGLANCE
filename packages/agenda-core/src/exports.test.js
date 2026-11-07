import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as core from './index.js';

// The declarations are hand-written (the plugin's tsc and the dayGLANCE MCP
// package's TypeScript consumers compile against them): hold them equal to
// the runtime exports, so an export added to one is not forgotten in the other.

const dts = readFileSync(fileURLToPath(new URL('../types/index.d.ts', import.meta.url)), 'utf8');
const declared = [...dts.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();

describe('types/index.d.ts', () => {
  it('declares exactly the runtime exports', () => {
    expect(declared).toEqual(Object.keys(core).sort());
  });

  it('declares functions as functions and constants as values', () => {
    for (const m of dts.matchAll(/^export function (\w+)/gm)) expect(typeof core[m[1]], m[1]).toBe('function');
    for (const m of dts.matchAll(/^export const (\w+)/gm)) expect(typeof core[m[1]], m[1]).not.toBe('function');
  });
});
