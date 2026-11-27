import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';

// #2143: an Inbox of a few thousand tasks answered every keystroke anywhere in
// the app slowly, because every row re-rendered on every App render. The row
// is memoized now and reads no app context; these pin the two properties that
// make that safe: an unrelated render leaves the row alone, and a row that
// skipped renders still calls the latest handler, never a stale one.

const renders = vi.hoisted(() => ({ count: 0 }));
vi.mock('../utils/textFormatting.jsx', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, renderTitle: (title) => { renders.count += 1; return real.renderTitle(title); } };
});
const { default: InboxTaskRow } = await import('./InboxTaskRow.jsx');

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

const TASK = { id: 'u1', title: 'Paint fence', color: 'bg-green-500', duration: 30, priority: 0, subtasks: [] };
const base = (actions, over = {}) => ({
  task: TASK, actions,
  isEditing: false, editingText: '', showSuggestions: false, suggestions: null, selectedSuggestionIndex: 0, suggestionContext: null,
  notesOpen: false, deadlinePickerOpen: false, pendingPriority: undefined, project: null, projectFilterActive: false,
  darkMode: false, cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', hoverBg: 'hover:bg-stone-100',
  aiConfig: null, aiSubtasksLoadingForTask: null,
  ...over,
});

function mount(props) {
  let root;
  const tree = (p) => <I18nextProvider i18n={i18n}><InboxTaskRow {...p} /></I18nextProvider>;
  act(() => { root = create(tree(props)); });
  return { root, update: (p) => act(() => { root.update(tree(p)); }) };
}

describe('InboxTaskRow', () => {
  it('a parent render with the same props does not re-render the row; a change to its task does', () => {
    const actions = { current: {} };
    const { update } = mount(base(actions));
    const after = renders.count;
    update(base(actions));
    update(base(actions));
    expect(renders.count).toBe(after);
    update(base(actions, { task: { ...TASK, title: 'Paint the fence' } }));
    expect(renders.count).toBe(after + 1);
  });

  it('a row that skipped renders calls the latest handler, not the one it first saw', () => {
    const first = vi.fn();
    const latest = vi.fn();
    const actions = { current: { toggleComplete: first } };
    const { root, update } = mount(base(actions));
    actions.current = { toggleComplete: latest };
    update(base(actions));
    const checkbox = root.root.findAllByType('button')[0];
    act(() => { checkbox.props.onClick(); });
    expect(latest).toHaveBeenCalledWith('u1', true);
    expect(first).not.toHaveBeenCalled();
  });

  it('a task whose project is missing shows the badge, and Unlink calls the action with the task id', () => {
    const unlink = vi.fn();
    const actions = { current: { unlinkMissingProject: unlink } };
    const { root } = mount(base(actions, { task: { ...TASK, projectId: 'gone' }, projectMissing: true }));
    const badge = root.root.findByProps({ 'data-testid': 'missing-project-badge' });
    expect(badge.props.title).toContain("doesn't have");
    act(() => { badge.findByType('button').props.onClick({ stopPropagation() {} }); });
    expect(unlink).toHaveBeenCalledWith('u1');
  });

  it('no badge when the project is not missing', () => {
    const { root } = mount(base({ current: {} }));
    expect(root.root.findAllByProps({ 'data-testid': 'missing-project-badge' })).toHaveLength(0);
  });
});
