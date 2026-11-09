import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// #2347: a click on the view cycler still cycles; a right-click or a long
// press opens the list of views to jump straight to one.

vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal()), createPortal: (node) => node }));

const ctx = vi.hoisted(() => ({ value: {} }));
vi.mock('../context/DayPlannerContext.jsx', () => ({ useDayPlannerCtx: () => ctx.value }));

globalThis.document = globalThis.document || { body: {}, activeElement: null };

const { default: ViewCycler, LONG_PRESS_MS } = await import('./ViewCycler.jsx');
const { viewMenuPosition } = await import('./ViewMenu.jsx');

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

let setViewMode;
beforeEach(() => {
  vi.useFakeTimers();
  setViewMode = vi.fn();
  ctx.value = {
    setViewMode, effectiveViewMode: 'multi', textSecondary: 'text-stone-500', textPrimary: 'text-stone-900',
    cardBg: 'bg-white', borderClass: 'border-stone-200', darkMode: false,
    canShowViewCycler: true, showDayDial: false, hiddenViews: { desktop: ['jobo'] },
  };
});
afterEach(() => { vi.useRealTimers(); });

function mount() {
  let root;
  act(() => { root = create(<I18nextProvider i18n={i18n}><ViewCycler /></I18nextProvider>); });
  return root;
}
const cycler = (root) => root.root.find((n) => n.type === 'button' && n.props['aria-haspopup'] === 'menu');
const menu = (root) => root.root.findAll((n) => n.props?.['data-view-menu'] !== undefined && n.type === 'div');
const items = (root) => root.root.findAll((n) => n.type === 'button' && n.props['data-view-menu-item']);
const press = (button, over = {}) => button.props.onPointerDown({ button: 0, clientX: 10, clientY: 10, ...over });

describe('ViewCycler', () => {
  it('a click cycles to the next view and opens no menu', () => {
    const root = mount();
    act(() => { press(cycler(root)); cycler(root).props.onPointerUp(); cycler(root).props.onClick(); });
    expect(setViewMode).toHaveBeenCalledWith('day');
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(menu(root)).toHaveLength(0);
  });

  it('a right-click opens the views the click cycles through, current ticked, with their keys', () => {
    const root = mount();
    const preventDefault = vi.fn();
    act(() => { cycler(root).props.onContextMenu({ preventDefault }); });
    expect(preventDefault).toHaveBeenCalled();
    expect(menu(root)).toHaveLength(1);
    // JOBO is hidden on this device, so it is not offered here either.
    expect(items(root).map((b) => b.props['data-view-menu-item'])).toEqual(['multi', 'day', 'week', 'month', 'sched']);
    expect(items(root).map((b) => b.props['aria-checked'])).toEqual([true, false, false, false, false]);
    const keys = items(root).map((b) => b.findByType('kbd').children.join(''));
    expect(keys).toEqual(['1', '2', '3', '4', '5']);
    expect(setViewMode).not.toHaveBeenCalled();
  });

  it('picking a view sets it and closes the menu', () => {
    const root = mount();
    act(() => { cycler(root).props.onContextMenu({ preventDefault() {} }); });
    act(() => { items(root).find((b) => b.props['data-view-menu-item'] === 'month').props.onClick(); });
    expect(setViewMode).toHaveBeenCalledWith('month');
    expect(menu(root)).toHaveLength(0);
  });

  it('a long press opens the menu, and the click its release makes does not cycle', () => {
    const root = mount();
    act(() => { press(cycler(root)); });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(menu(root)).toHaveLength(1);
    act(() => { cycler(root).props.onPointerUp(); cycler(root).props.onClick(); });
    expect(setViewMode).not.toHaveBeenCalled();
    expect(menu(root)).toHaveLength(1);
  });

  it('after a long press with no click (a touch), the next click still cycles', () => {
    const root = mount();
    act(() => { press(cycler(root)); vi.advanceTimersByTime(LONG_PRESS_MS); });
    act(() => { menu(root)[0].props.onKeyDown({ key: 'Escape', preventDefault() {} }); });
    expect(menu(root)).toHaveLength(0);
    act(() => { press(cycler(root)); cycler(root).props.onPointerUp(); cycler(root).props.onClick(); });
    expect(setViewMode).toHaveBeenCalledWith('day');
  });

  it('a press that moves is not a long press', () => {
    const root = mount();
    act(() => { press(cycler(root)); cycler(root).props.onPointerMove({ clientX: 40, clientY: 10 }); });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS * 2); });
    expect(menu(root)).toHaveLength(0);
  });

  it('a press released early is a click', () => {
    const root = mount();
    act(() => { press(cycler(root)); vi.advanceTimersByTime(LONG_PRESS_MS - 100); cycler(root).props.onPointerUp(); });
    act(() => { vi.advanceTimersByTime(LONG_PRESS_MS); });
    expect(menu(root)).toHaveLength(0);
  });

  it('at a narrow width the menu offers only what the cycler does', () => {
    ctx.value = { ...ctx.value, canShowViewCycler: false, hiddenViews: { desktop: [] }, showDayDial: true };
    const root = mount();
    act(() => { cycler(root).props.onContextMenu({ preventDefault() {} }); });
    expect(items(root).map((b) => b.props['data-view-menu-item'])).toEqual(['multi', 'sched', 'jobo']);
  });

  it('the menu opens under the cycler and stays inside the window', () => {
    expect(viewMenuPosition({ left: 20, bottom: 60 }, 1200)).toEqual({ left: 20, top: 64 });
    expect(viewMenuPosition({ left: 1150, bottom: 60 }, 1200).left).toBeLessThanOrEqual(1200 - 8 - 176);
    expect(viewMenuPosition({ left: -5, bottom: 60 }, 1200).left).toBe(8);
  });
});
