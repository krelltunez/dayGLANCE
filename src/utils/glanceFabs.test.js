import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  GLANCE_FABS_KEY,
  readGlanceFabsCollapsed,
  writeGlanceFabsCollapsed,
  glanceFabVisibilityClass,
  glanceFabStagger,
} from './glanceFabs.js';

describe('glanceFabs persistence', () => {
  let store;

  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to expanded when nothing is stored', () => {
    expect(readGlanceFabsCollapsed()).toBe(false);
  });

  it('round-trips both states', () => {
    writeGlanceFabsCollapsed(true);
    expect(store[GLANCE_FABS_KEY]).toBe('1');
    expect(readGlanceFabsCollapsed()).toBe(true);

    writeGlanceFabsCollapsed(false);
    expect(store[GLANCE_FABS_KEY]).toBe('0');
    expect(readGlanceFabsCollapsed()).toBe(false);
  });

  it('treats any other stored value as expanded', () => {
    // Only '1' collapses — a stale or corrupt value must not hide the buttons.
    for (const v of ['0', 'true', '', 'yes']) {
      store[GLANCE_FABS_KEY] = v;
      expect(readGlanceFabsCollapsed()).toBe(false);
    }
  });

  it('survives storage that throws (private mode)', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(readGlanceFabsCollapsed()).toBe(false);
    expect(() => writeGlanceFabsCollapsed(true)).not.toThrow();
  });
});

describe('glanceFabVisibilityClass', () => {
  it('makes hidden buttons click-through, not just invisible', () => {
    expect(glanceFabVisibilityClass(true)).toContain('pointer-events-none');
    expect(glanceFabVisibilityClass(true)).toContain('opacity-0');
    expect(glanceFabVisibilityClass(false)).toContain('pointer-events-auto');
    expect(glanceFabVisibilityClass(false)).toContain('opacity-100');
  });
});

describe('glanceFabStagger', () => {
  it('leads with the button nearest the handle when expanding', () => {
    expect(glanceFabStagger(false, 0, 3)).toBe(0);
    expect(glanceFabStagger(false, 1, 3)).toBe(50);
    expect(glanceFabStagger(false, 2, 3)).toBe(100);
  });

  it('reverses when collapsing, so the far end leaves first', () => {
    expect(glanceFabStagger(true, 2, 3)).toBe(0);
    expect(glanceFabStagger(true, 1, 3)).toBe(50);
    expect(glanceFabStagger(true, 0, 3)).toBe(100);
  });

  it('adapts to a column that lost a button', () => {
    // Recycle bin emptied: the same two survivors re-index against count 2, so
    // collapsing still ends on the button beside the handle.
    expect(glanceFabStagger(true, 1, 2)).toBe(0);
    expect(glanceFabStagger(true, 0, 2)).toBe(50);
  });

  it('never delays a lone button', () => {
    expect(glanceFabStagger(false, 0, 1)).toBe(0);
    expect(glanceFabStagger(true, 0, 1)).toBe(0);
  });

  it('clamps an index outside the column', () => {
    expect(glanceFabStagger(false, 9, 3)).toBe(100);
    expect(glanceFabStagger(false, -1, 3)).toBe(0);
    expect(glanceFabStagger(true, 0, 0)).toBe(0);
  });
});
