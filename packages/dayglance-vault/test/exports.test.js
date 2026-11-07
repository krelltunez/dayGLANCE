// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as root from '../src/index.js';

// The declarations are hand-written: a TypeScript host compiles against them,
// so a runtime export they forget is invisible to it, and a declared one the
// JavaScript lacks fails at run time. Hold the lists equal.

const read = (f) => readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), 'utf8');
const names = (dts, kind = '(?:function|const)') => [...dts.matchAll(new RegExp(`^export ${kind} (\\w+)`, 'gm'))].map((m) => m[1]);
const dts = read('types/index.d.ts');

describe('types', () => {
  it('index.d.ts declares exactly the root runtime exports', () => {
    expect(names(dts).sort()).toEqual(Object.keys(root).sort());
  });

  it('declares functions as functions and constants as values', () => {
    for (const n of names(dts, 'function')) expect(typeof root[n], n).toBe('function');
    for (const n of names(dts, 'const')) expect(typeof root[n], n).not.toBe('function');
  });
});

describe('package', () => {
  const pkg = JSON.parse(read('package.json'));

  it('points main and types at the entry and its declarations', () => {
    expect(pkg.main).toBe('src/index.js');
    expect(pkg.types).toBe('types/index.d.ts');
  });

  it('imports nothing but its own modules and its three peers', () => {
    // The app and a host must share ONE copy of the engine's module state
    // (the root key, the vault client's brake), so the package never brings
    // its own: it is a peer, as the adapter's mergeRoutineDefinitions comes
    // from it. @glance-apps/obsidian-format is the one SSE frame parser the
    // event client reads the /events stream with (the bridge plugin reads
    // it with the same one); a peer too, since every consumer already has
    // it and one wire format should have one parser in a process.
    // @glance-apps/agenda-core holds what counts as a recorded plan-trail
    // stop (planTrailStops), which the trail merge cleans with and every
    // reader of the trail (the app's panel, the MCP read surface) counts
    // with: one rule, so a stop the merge keeps is one every reader shows.
    const PEERS = ['@glance-apps/agenda-core', '@glance-apps/obsidian-format', '@glance-apps/sync'];
    expect(Object.keys(pkg.peerDependencies || {}).sort()).toEqual(PEERS);
    expect(pkg.dependencies).toBeUndefined();
    for (const f of readdirSync(fileURLToPath(new URL('../src', import.meta.url)))) {
      for (const [, spec] of read(`src/${f}`).matchAll(/^(?:import|export) [^;]*? from '([^']+)';/gms)) {
        if (!spec.startsWith('./')) expect(PEERS, `${f} imports ${spec}`).toContain(spec);
      }
    }
  });

  it('touches no browser global, so a Node host can run it', () => {
    for (const f of readdirSync(fileURLToPath(new URL('../src', import.meta.url)))) {
      const code = read(`src/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/\b(?:window|document|localStorage|sessionStorage|indexedDB|navigator)\s*[.[]/);
    }
  });
});
