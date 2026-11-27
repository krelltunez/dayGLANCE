import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

let cleanup;
vi.mock('react', () => ({
  useEffect: (fn) => { cleanup = fn(); },
}));

const { default: useSidePanelOverlayEscape, overlayEscapeApplies, SIDE_PANEL_OVERLAY_SELECTOR } =
  await import('./useSidePanelOverlayEscape.js');

const key = (over = {}) => ({ key: 'Escape', defaultPrevented: false, target: { tagName: 'BODY' }, preventDefault: vi.fn(), ...over });
const doc = (selection = false) => ({ querySelector: (sel) => (selection && sel === '[data-timeline-selection]' ? {} : null) });

describe('overlayEscapeApplies', () => {
  it('a bare Escape on the page closes the overlay', () => {
    expect(overlayEscapeApplies(key(), doc())).toBe(true);
  });

  // MUTATION: drop the defaultPrevented check and one press closes a modal
  // and the panel behind it together.
  it('not when something else already handled it', () => {
    expect(overlayEscapeApplies(key({ defaultPrevented: true }), doc())).toBe(false);
  });

  it('not from a text field, where Escape cancels editing', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(overlayEscapeApplies(key({ target: { tagName } }), doc())).toBe(false);
    }
    expect(overlayEscapeApplies(key({ target: { tagName: 'DIV', isContentEditable: true } }), doc())).toBe(false);
  });

  it('not while a timeline range is selected: that press clears the range', () => {
    expect(overlayEscapeApplies(key(), doc(true))).toBe(false);
  });

  it('not for other keys or modified Escape', () => {
    expect(overlayEscapeApplies(key({ key: 'Enter' }), doc())).toBe(false);
    expect(overlayEscapeApplies(key({ shiftKey: true }), doc())).toBe(false);
    expect(overlayEscapeApplies(key({ metaKey: true }), doc())).toBe(false);
  });
});

describe('useSidePanelOverlayEscape', () => {
  let listeners;
  const stub = () => {
    listeners = new Set();
    vi.stubGlobal('window', {
      addEventListener: (type, fn) => { if (type === 'keydown') listeners.add(fn); },
      removeEventListener: (type, fn) => { if (type === 'keydown') listeners.delete(fn); },
    });
    vi.stubGlobal('document', doc());
  };
  const press = (e) => { for (const fn of listeners) fn(e); };
  afterEach(() => { cleanup = undefined; vi.unstubAllGlobals(); });

  it('listens only while the panel is overlaid, and closes it on Escape', () => {
    stub();
    const close = vi.fn();
    useSidePanelOverlayEscape({ active: false, close });
    expect(listeners.size).toBe(0);

    useSidePanelOverlayEscape({ active: true, close });
    const e = key();
    press(e);
    expect(close).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();

    cleanup();
    expect(listeners.size).toBe(0);
  });
});

describe('wiring', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it('App closes the overlaid panel, and only the overlaid one', () => {
    expect(read('../App.jsx')).toContain("useSidePanelOverlayEscape({ active: sidePanelMode === 'overlay', close: collapseSidePanel });");
  });

  it('the selector matches the frame SidePanelFrame renders when overlaid', () => {
    expect(SIDE_PANEL_OVERLAY_SELECTOR).toBe('[data-side-panel-frame="overlay"]');
    expect(read('../components/SidePanelFrame.jsx')).toContain("data-side-panel-frame={collapsed ? 'collapsed' : overlay ? 'overlay' : 'open'}");
  });

  // MUTATION: drop the check and an Escape in macOS fullscreen closes the
  // panel and leaves fullscreen in one press.
  it('Electron fullscreen stands back while the overlay is up', () => {
    expect(read('./useFullscreenEscape.js')).toContain('if (document.querySelector(SIDE_PANEL_OVERLAY_SELECTOR)) return;');
  });
});
