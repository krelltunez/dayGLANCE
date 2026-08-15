import { describe, it, expect } from 'vitest';
import { resolveInboxFilter } from './mcpInboxFilter.js';

// The canonicalization contract: defaults resolve BEFORE anything compares
// or encodes, so semantically identical requests always produce identical
// tuples — omitted-vs-explicit defaults can never mismatch across pages.

describe('resolveInboxFilter', () => {
  it('resolves defaults: scope all, include_completed true', () => {
    const r = resolveInboxFilter({});
    expect(r).toEqual({
      ok: true,
      filter: { scope: 'all', includeCompleted: true, key: 'scope=all;completed=1' },
    });
  });

  it('omitted and explicit defaults produce IDENTICAL canonical keys', () => {
    const omitted = resolveInboxFilter({});
    const explicit = resolveInboxFilter({ scope: 'all', include_completed: true });
    if (!omitted.ok || !explicit.ok) throw new Error('expected ok');
    expect(omitted.filter.key).toBe(explicit.filter.key);
  });

  it('each scope and completion combination has a distinct stable key', () => {
    const keys = new Set<string>();
    for (const scope of ['all', 'standalone', 'project'] as const) {
      for (const include_completed of [true, false]) {
        const r = resolveInboxFilter({ scope, include_completed });
        if (!r.ok) throw new Error(r.message);
        keys.add(r.filter.key);
      }
    }
    expect(keys.size).toBe(6);
    expect(keys.has('scope=standalone;completed=0')).toBe(true);
  });

  it('rejects unknown scopes, naming the valid set (no bucket scope by design)', () => {
    for (const bad of ['bucket', 'inbox', '', 42, null]) {
      const r = resolveInboxFilter({ scope: bad });
      expect(r.ok, `scope ${String(bad)}`).toBe(false);
      if (!r.ok) expect(r.message).toContain('"standalone"');
    }
  });

  it('rejects non-boolean include_completed', () => {
    for (const bad of ['true', 1, 0, null]) {
      expect(resolveInboxFilter({ include_completed: bad }).ok, String(bad)).toBe(false);
    }
  });
});
