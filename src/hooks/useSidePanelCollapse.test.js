import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Render-free: state lives in a slot the test re-reads, as a re-render would.
let slot;
vi.mock('react', () => ({
  useState: (init) => {
    if (slot === undefined) slot = { value: typeof init === 'function' ? init() : init };
    return [slot.value, (next) => { slot.value = typeof next === 'function' ? next(slot.value) : next; }];
  },
  useCallback: (fn) => fn,
}));

const { default: useSidePanelCollapse, readSidePanelCollapsed, SIDE_PANEL_COLLAPSED_KEY } = await import('./useSidePanelCollapse.js');

describe('useSidePanelCollapse (#2407)', () => {
  let store;
  beforeEach(() => {
    slot = undefined;
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((k) => store[k] ?? null),
      setItem: vi.fn((k, v) => { store[k] = String(v); }),
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const useRendered = (enabled = true) => useSidePanelCollapse({ enabled });

  it('starts open, and says whether it can be hidden at all', () => {
    expect(useRendered()).toMatchObject({ sidePanelCollapsed: false, sidePanelCollapsible: true });
    expect(useRendered(false)).toMatchObject({ sidePanelCollapsed: false, sidePanelCollapsible: false });
  });

  it('toggles, and remembers it on this device', () => {
    useRendered().toggleSidePanel();
    expect(useRendered().sidePanelCollapsed).toBe(true);
    expect(store[SIDE_PANEL_COLLAPSED_KEY]).toBe('true');
    useRendered().toggleSidePanel();
    expect(useRendered().sidePanelCollapsed).toBe(false);
    expect(store[SIDE_PANEL_COLLAPSED_KEY]).toBe('false');
  });

  it('comes back as it was left', () => {
    store[SIDE_PANEL_COLLAPSED_KEY] = 'true';
    expect(readSidePanelCollapsed()).toBe(true);
    expect(useRendered().sidePanelCollapsed).toBe(true);
  });

  it('expands, and writes nothing when it was already open', () => {
    store[SIDE_PANEL_COLLAPSED_KEY] = 'true';
    useRendered().expandSidePanel();
    expect(useRendered().sidePanelCollapsed).toBe(false);
    expect(store[SIDE_PANEL_COLLAPSED_KEY]).toBe('false');
    localStorage.setItem.mockClear();
    useRendered().expandSidePanel();
    expect(localStorage.setItem).not.toHaveBeenCalled();
  });

  it('is never collapsed on a tablet or a phone, whatever was stored, and cannot be toggled there', () => {
    store[SIDE_PANEL_COLLAPSED_KEY] = 'true';
    const panel = useRendered(false);
    expect(panel.sidePanelCollapsed).toBe(false);
    panel.toggleSidePanel();
    expect(store[SIDE_PANEL_COLLAPSED_KEY]).toBe('true');
    expect(useRendered(false).sidePanelCollapsed).toBe(false);
  });

  it('works without storage, for the session', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(readSidePanelCollapsed()).toBe(false);
    expect(() => useRendered().toggleSidePanel()).not.toThrow();
    expect(useRendered().sidePanelCollapsed).toBe(true);
  });

  it('is a per-device preference: the sync payload does not carry it', async () => {
    const { readFileSync } = await import('node:fs');
    const payload = readFileSync(new URL('./useSyncEngineData.js', import.meta.url), 'utf8');
    expect(payload).not.toContain('side-panel');
    expect(payload).not.toContain('sidePanel');
  });
});
