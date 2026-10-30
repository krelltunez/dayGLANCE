import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// #2143: the tablet's and phone's Inbox row, memoized as the desktop row is.
// An unrelated render leaves it alone, and a row that skipped renders still
// calls the latest handler.

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../utils/textFormatting.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, renderTitle: (title) => { renders.count += 1; return real.renderTitle(title); } };
});
const { default: TouchInboxTaskRow } = await import('./TouchInboxTaskRow.jsx');

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const TASK = { id: 'u1', title: 'Paint fence', color: 'bg-green-500', duration: 30, priority: 0, subtasks: [] };
const base = (actions, over = {}) => ({
  task: TASK, actions, notesOpen: false, deadlinePickerOpen: false, pendingPriority: undefined,
  project: null, projectFilterActive: false, darkMode: false, ...over,
});

function mount(props) {
  let root;
  const tree = (p) => <I18nextProvider i18n={i18n}><TouchInboxTaskRow {...p} /></I18nextProvider>;
  act(() => { root = create(tree(props)); });
  return { root, update: (p) => act(() => { root.update(tree(p)); }) };
}

describe('TouchInboxTaskRow', () => {
  it('a parent render with the same props does not re-render the row; a change to its task does', () => {
    const actions = { current: {} };
    const { update } = mount(base(actions));
    const after = renders.count;
    update(base(actions));
    expect(renders.count).toBe(after);
    update(base(actions, { task: { ...TASK, title: 'Paint the fence' } }));
    expect(renders.count).toBe(after + 1);
  });

  it('a row that skipped renders calls the latest handler', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const actions = { current: { toggleComplete: first } };
    const { root, update } = mount(base(actions));
    actions.current = { toggleComplete: latest };
    update(base(actions));
    act(() => { root.root.findAllByType('button')[0].props.onClick(); });
    expect(latest).toHaveBeenCalledWith('u1', true);
    expect(first).not.toHaveBeenCalled();
  });

  it('shows its strings in the user\'s language (the phone row had them in English)', () => {
    const { root } = mount(base({ current: {} }));
    expect(JSON.stringify(root.toJSON())).toContain('30 min');
  });

  it('has no double-click rename, since it draws no rename field (#2263)', () => {
    const startEditingTask = vi.fn();
    const { root } = mount(base({ current: { startEditingTask } }));
    expect(root.root.findAll((node) => typeof node.props?.onDoubleClick === 'function')).toHaveLength(0);
  });
});
