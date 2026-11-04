// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as root from '../src/index.js';
import * as model from '../src/model.js';

// The declarations are hand-written: a TypeScript host compiles against them,
// so a runtime export they forget is invisible to it, and a declared one the
// JavaScript lacks fails at run time. Hold the lists equal, for both entries:
// the root (types/index.d.ts, which re-exports model.d.ts) and ./model.

const read = (f) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
const names = (dts, kind = '(?:function|const)') => [...dts.matchAll(new RegExp(`^export ${kind} (\\w+)`, 'gm'))].map((m) => m[1]);
const modelDts = read('types/model.d.ts');
const indexDts = read('types/index.d.ts');

describe('types', () => {
  it('model.d.ts declares exactly the ./model runtime exports', () => {
    expect(names(modelDts).sort()).toEqual(Object.keys(model).sort());
  });

  it('index.d.ts (with model.d.ts) declares exactly the root runtime exports', () => {
    expect(indexDts).toMatch(/^export \* from '\.\/model\.js';$/m);
    expect([...names(indexDts), ...names(modelDts)].sort()).toEqual(Object.keys(root).sort());
  });

  it('declares functions as functions and constants as values', () => {
    for (const dts of [modelDts, indexDts]) {
      for (const n of names(dts, 'function')) expect(typeof root[n], n).toBe('function');
      for (const n of names(dts, 'const')) expect(typeof root[n], n).not.toBe('function');
    }
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(read('package.json'));

  it('maps each entry to its module and its declarations', () => {
    expect(pkg.exports['.']).toEqual({ types: './types/index.d.ts', default: './src/index.js' });
    expect(pkg.exports['./model']).toEqual({ types: './types/model.d.ts', default: './src/model.js' });
    expect(pkg.main).toBe('src/index.js');
    expect(pkg.types).toBe('types/index.d.ts');
  });

  it('keeps ./model free of the MCP SDK, zod and the HTTP listener, so a browser can bundle it', () => {
    // The app's renderer imports ./model. The tool registration (zod, the
    // SDK) and the kit's root (node:http) must not be reachable from it.
    const seen = new Set();
    const walk = (f) => {
      if (seen.has(f)) return;
      seen.add(f);
      for (const [, spec] of read(`src/${f}`).matchAll(/^(?:import|export) [^;]*? from '([^']+)';/gms)) {
        if (spec.startsWith('./')) walk(spec.slice(2));
        else expect(['@glance-apps/agenda-core', '@glance-apps/mcp-host/src/dates.js'], `${f} imports ${spec}`).toContain(spec);
      }
    };
    walk('model.js');
    expect([...seen].sort()).toEqual(['frames.js', 'model.js', 'readModel.js', 'readState.js', 'repeat.js', 'wireStamp.js']);
  });
});
