import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import CardSubtasks from './CardSubtasks.jsx';
import { SUBTASK_ROW_PX } from '../utils/cardSubtasks.js';

// A task's subtasks on its timeline card: ticked from the card (a repeating
// task's per occurrence, which toggleSubtask decides from the id), and a
// "more" row that opens the panel when they do not all fit.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const task = (n, extra = {}) => ({
  id: 't1', title: 'Evening tasks',
  subtasks: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Step ${i + 1}`, completed: i === 0 })),
  ...extra,
});
const heightFor = (rows) => 30 + 4 + rows * SUBTASK_ROW_PX;
const mount = (props) => {
  let root;
  act(() => { root = create(<I18nextProvider i18n={i18n}><CardSubtasks reservedPx={30} {...props} /></I18nextProvider>); });
  return root;
};
const rows = (root) => root.root.findAll((n) => typeof n.type === 'string' && n.props['data-card-subtask'] !== undefined);
const text = (node) => (typeof node === 'string' ? node : (node.children || []).map(text).join(''));

describe('CardSubtasks', () => {
  it('ticks a subtask from the card, and the click stops at the card', () => {
    const onToggle = vi.fn();
    const root = mount({ task: task(3), height: heightFor(3), onToggle });
    const list = rows(root);
    expect(list.map((n) => n.props['aria-checked'])).toEqual([true, false, false]);
    const stopPropagation = vi.fn();
    act(() => { list[1].props.onClick({ stopPropagation }); });
    expect(onToggle).toHaveBeenCalledWith('s1');
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('says how many more, and opens the panel', () => {
    const onMore = vi.fn();
    const root = mount({ task: task(6), height: heightFor(3), onMore });
    expect(rows(root)).toHaveLength(2);
    const more = root.root.find((n) => n.props['data-card-subtasks-more'] !== undefined);
    expect(text(more)).toBe('+4 more');
    act(() => { more.props.onClick({ stopPropagation: vi.fn() }); });
    expect(onMore).toHaveBeenCalled();
  });

  it('with room for one row, the row counts them', () => {
    const root = mount({ task: task(5), height: heightFor(1) });
    expect(rows(root)).toHaveLength(0);
    expect(text(root.root.find((n) => n.props['data-card-subtasks-more'] !== undefined))).toBe('5 subtasks');
  });

  it('draws nothing without room', () => {
    expect(mount({ task: task(3), height: 30 }).toJSON()).toBeNull();
  });
});
