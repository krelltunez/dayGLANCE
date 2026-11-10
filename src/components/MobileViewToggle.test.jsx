import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// #2362: the phone and portrait-tablet view button. A tap still cycles; a long
// press opens the list of the phone's views to jump straight to one, as the
// desktop cycler's does (#2347), with the same touch fix (#2361).

vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));

const ctx = vi.hoisted(() => ({ value: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ctx.value }));

globalThis.document = globalThis.document || { body: {}, activeElement: null };

const { default: MobileViewToggle } = await import('./MobileViewToggle.jsx');
const { LONG_PRESS_MS } = await import('../hooks/useViewListPress.js');
const { viewMenuPosition } = await import('./ViewMenu.jsx');

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

let setMobileViewMode;
beforeEach(() => {
  vi.useFakeTimers();
  setMobileViewMode = vi.fn();
  ctx.value = {
    mobileViewMode: 'grid', setMobileViewMode, textSecondary: 'text-stone-500', textPrimary: 'text-stone-900',
    cardBg: 'bg-white', borderClass: 'border-stone-200', darkMode: false,
    showDayDial: false, hiddenViews: { mobile: ['jobo'] },
  };
});
afterEach(() => { vi.useRealTimers(); });

function mount() {
  let root;
  act(() => { root = create(<I18nextProvider i18n={i18n}><MobileViewToggle /></I18nextProvider>); });
  return root;
}
const toggle = (root) => root.root.find((n) => n.type === 'button' && n.props['aria-haspopup'] === 'menu');
const menu = (root) => root.root.findAll((n) => n.type === 'div' && n.props?.['data-view-menu'] !== undefined);
const items = (root) => root.root.findAll((n) => n.type === 'button' && n.props['data-view-menu-item']);
const backdrop = (root) => root.root.find((n) => n.type === 'div' && n.props['data-view-menu-backdrop'] !== undefined);
const press = (button) => button.props.onPointerDown({ button: 0, clientX: 10, clientY: 10 });
const longPress = (root) => act(() => { press(toggle(root)); vi.advanceTimersByTime(LONG_PRESS_MS); });

describe('MobileViewToggle', () => {
  it('a tap cycles to the next view, as before, and opens nothing', () => {
    const root = mount();
    act(() => { press(toggle(root)); toggle(root).props.onPointerUp(); toggle(root).props.onClick(); });
    expect(setMobileViewMode).toHaveBeenCalledWith('list');
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(menu(root)).toHaveLength(0);
  });

  // MUTATION: drop the long press from the toggle and none of this opens.
  it('a long press opens the phone\'s views, named as the toggle names them, the current ticked, with no keys', () => {
    const root = mount();
    longPress(root);
    expect(menu(root)).toHaveLength(1);
    // JOBO is hidden on this device, so it is not offered here either.
    expect(items(root).map((b) => b.props['data-view-menu-item'])).toEqual(['grid', 'list', 'month', 'sched']);
    expect(items(root).map((b) => b.props['aria-checked'])).toEqual([true, false, false, false]);
    expect(items(root).map((b) => b.findAllByType('span')[0].children.join(''))).toEqual(['GRID', 'LIST', 'MONTH', 'SCHED']);
    expect(root.root.findAllByType('kbd')).toHaveLength(0);
  });

  it('the long press\'s release neither cycles nor closes the list; a view tapped in it switches to it', () => {
    const root = mount();
    longPress(root);
    act(() => { toggle(root).props.onPointerUp(); toggle(root).props.onClick(); backdrop(root).props.onClick(); });
    expect(setMobileViewMode).not.toHaveBeenCalled();
    expect(menu(root)).toHaveLength(1);
    act(() => { items(root).find((b) => b.props['data-view-menu-item'] === 'month').props.onClick(); });
    expect(setMobileViewMode).toHaveBeenCalledWith('month');
    expect(menu(root)).toHaveLength(0);
  });

  it('a tap outside closes the list, and the next tap on the toggle cycles again', () => {
    const root = mount();
    longPress(root);
    act(() => { backdrop(root).props.onPointerDown(); backdrop(root).props.onClick(); });
    expect(menu(root)).toHaveLength(0);
    act(() => { press(toggle(root)); toggle(root).props.onPointerUp(); toggle(root).props.onClick(); });
    expect(setMobileViewMode).toHaveBeenCalledWith('list');
  });

  it('a press that moves is a scroll, not a long press', () => {
    const root = mount();
    act(() => { press(toggle(root)); toggle(root).props.onPointerMove({ clientX: 10, clientY: 40 }); });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(menu(root)).toHaveLength(0);
  });
});

describe('where the list opens', () => {
  it('under the button when it fits, above it when it would run off the bottom', () => {
    expect(viewMenuPosition({ left: 0, top: 50, bottom: 90 }, 400, 800, 4).top).toBe(94);
    // Near the bottom of an 800px screen: 4 rows do not fit below.
    const low = viewMenuPosition({ left: 0, top: 700, bottom: 740 }, 400, 800, 4);
    expect(low.top).toBeLessThan(700);
    expect(low.top + 4 * 32 + 8).toBeLessThanOrEqual(700);
    // No room above either: stays below rather than going off the top.
    expect(viewMenuPosition({ left: 0, top: 20, bottom: 790 }, 400, 800, 4).top).toBe(794);
  });
});
