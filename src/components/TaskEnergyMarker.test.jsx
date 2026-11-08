import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import TaskEnergyMarker from './TaskEnergyMarker.jsx';

// #2331: a timeline card's energy marker. A leaf on Restore blocks, nothing
// drawn on Effort ones; on desktop a click flips it and the tooltip says why
// it is what it is; on a phone or a tablet it only shows.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const mount = (task, { readOnly = false, ctx = { setTaskEnergy: vi.fn() } } = {}) => {
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <DayPlannerContext.Provider value={ctx}>
          <TaskEnergyMarker task={task} readOnly={readOnly} />
        </DayPlannerContext.Provider>
      </I18nextProvider>,
    );
  });
  return { root, ctx };
};
const button = (root) => root.root.findAll((n) => n.type === 'button')[0];
const task = (over = {}) => ({ id: 't1', title: 'Quarterly planning', date: '2026-11-09', startTime: '09:00', ...over });

describe('on desktop', () => {
  it('a Restore block carries a visible leaf, and the tooltip says the title made it so', () => {
    const b = button(mount(task({ title: 'Lunch with Sam' })).root);
    expect(b.props['data-energy-marker']).toBe('restore');
    expect(b.props['aria-pressed']).toBe(true);
    expect(b.props.className).toContain('opacity-90');
    expect(b.props.title).toBe('Restore, detected from the title. Click for Effort.');
  });

  it('a Chinese title detected as Restore carries the leaf too (#2331\'s reporter)', () => {
    const b = button(mount(task({ title: '中午吃饭' })).root);
    expect(b.props['data-energy-marker']).toBe('restore');
    expect(b.props.title).toBe('Restore, detected from the title. Click for Effort.');
  });

  it('the same leaf for a hand-set Restore, and the tooltip says the user set it', () => {
    const b = button(mount(task({ energy: 'restore' })).root);
    expect(b.props['data-energy-marker']).toBe('restore');
    expect(b.props.className).toContain('opacity-90');
    expect(b.props.title).toBe('Restore, set by you. Click for Effort.');
  });

  // MUTATION: drop the hover-only classes and every Effort card wears a leaf.
  it('an Effort block draws nothing until the card is hovered', () => {
    const b = button(mount(task()).root);
    expect(b.props['data-energy-marker']).toBe('effort');
    expect(b.props['aria-pressed']).toBe(false);
    expect(b.props.className).toMatch(/(^| )opacity-0( |$)/);
    expect(b.props.className).toContain('group-hover/card:opacity-40');
    expect(b.props.title).toBe('Effort (the default). Click for Restore.');
  });

  it('says so when the user set Effort on a block the title calls Restore', () => {
    expect(button(mount(task({ title: 'Lunch with investors', energy: 'effort' })).root).props.title)
      .toBe('Effort, set by you. Click for Restore.');
  });

  it('a click flips it, storing an override only where it disagrees with the title', () => {
    const lunch = mount(task({ title: 'Lunch' }));
    act(() => { button(lunch.root).props.onClick({ stopPropagation: vi.fn() }); });
    expect(lunch.ctx.setTaskEnergy).toHaveBeenCalledWith('t1', 'effort', false);

    const planning = mount(task());
    act(() => { button(planning.root).props.onClick({ stopPropagation: vi.fn() }); });
    expect(planning.ctx.setTaskEnergy).toHaveBeenCalledWith('t1', 'restore', false);

    // Back to auto: the title already says Effort.
    const marked = mount(task({ energy: 'restore' }));
    act(() => { button(marked.root).props.onClick({ stopPropagation: vi.fn() }); });
    expect(marked.ctx.setTaskEnergy).toHaveBeenCalledWith('t1', null, false);
  });

  it('a click does not reach the card', () => {
    const stopPropagation = vi.fn();
    const { root } = mount(task());
    act(() => { button(root).props.onClick({ stopPropagation }); });
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('a recurring occurrence passes its own id; setTaskEnergy routes it to the series', () => {
    const { root, ctx } = mount(task({ id: 'recurring-tpl-2026-11-09', title: 'Gym' }));
    act(() => { button(root).props.onClick({ stopPropagation: vi.fn() }); });
    expect(ctx.setTaskEnergy).toHaveBeenCalledWith('recurring-tpl-2026-11-09', 'effort', false);
  });
});

describe('on a phone or a tablet', () => {
  it('a Restore block shows a leaf that is not a control', () => {
    const { root } = mount(task({ title: 'Nap' }), { readOnly: true });
    expect(root.root.findAll((n) => n.type === 'button')).toHaveLength(0);
    expect(root.root.findAll((n) => n.props['data-energy-marker'] === 'restore' && n.props.role === 'img')).not.toHaveLength(0);
  });

  it('an Effort block shows nothing at all', () => {
    expect(mount(task(), { readOnly: true }).root.toJSON()).toBeNull();
  });
});

describe('nothing to mark', () => {
  it('an imported event, whose energy cannot be set', () => {
    expect(mount(task({ title: 'Lunch', imported: true })).root.toJSON()).toBeNull();
  });

  it('falls back to showing only, where there is no setter (a render-only surface)', () => {
    const { root } = mount(task({ title: 'Lunch' }), { ctx: {} });
    expect(root.root.findAll((n) => n.type === 'button')).toHaveLength(0);
    expect(mount(task(), { ctx: {} }).root.toJSON()).toBeNull();
  });
});
