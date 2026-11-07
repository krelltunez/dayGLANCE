import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { loaders } from '../locales.js';
import { DayPlannerContext } from '../context/DayPlannerContext.jsx';
import { FeaturesContext } from '../context/FeaturesContext.jsx';
import { SyncContext } from '../context/SyncContext.jsx';
import { TASK_COLORS } from '../utils/colorUtils.js';
import useNewTaskInput from '../hooks/useNewTaskInput.js';
import DesktopNewTaskModal from './DesktopNewTaskModal.jsx';
import MobileNewTaskModal from './MobileNewTaskModal.jsx';

// #2308: the task editor's tag picker, in the editors themselves (the desktop
// modal and the phone's sheet, new and edit), over the real title state
// (useNewTaskInput). A tag is a #word in the title: picking one adds it to
// the title, unpicking takes it out, and nothing else on the task changes.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

// No DOM here: `document` records its listeners and the focused node.
let listeners;
beforeEach(() => {
  listeners = {};
  globalThis.document = {
    activeElement: null,
    addEventListener: (type, fn) => { (listeners[type] ||= new Set()).add(fn); },
    removeEventListener: (type, fn) => { listeners[type]?.delete(fn); },
  };
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
});
afterEach(() => { delete globalThis.document; delete globalThis.localStorage; delete globalThis.requestAnimationFrame; });

// Every ref is a mock node inside the editor; a tap outside is any other object.
const nodeMock = (element) => {
  const node = {
    inside: true,
    search: element.props['data-tag-picker-search'] === true,
    trigger: element.props['data-tag-picker-trigger'] === true,
    focus: vi.fn(() => { globalThis.document.activeElement = node; }),
    blur: vi.fn(),
    contains: (target) => !!target?.inside,
    scrollIntoView: () => {},
    setSelectionRange: () => {},
    style: {},
  };
  return node;
};

const TASKS = [
  { id: 't1', title: 'Fix the gutter #home #urgent', date: '2026-11-07', startTime: '09:00', duration: 30 },
  { id: 'e1', title: 'Standup #calendar', imported: true, date: '2026-11-07' },
];
const INBOX = [
  { id: 'u1', title: 'Plan #workshop and #work' },
  { id: 'u2', title: 'Journal #obsidian' },
];
const RECURRING = [{ id: 'r1', title: 'Water plants #Garden', recurrence: { type: 'daily' } }];

function setup({ Modal, isMobile = false, title = '', editing = null, unscheduledTasks = INBOX } = {}) {
  const addTask = vi.fn();
  const saveMobileEditTask = vi.fn();
  let state;
  function Harness() {
    const input = useNewTaskInput({ allTags: [], showAddTask: true, t: i18n.t, language: 'en', use24HourClock: false, isEditing: !!editing });
    state = input;
    const ctx = {
      ...input,
      showAddTask: true, setShowAddTask: vi.fn(),
      isMobile, isTablet: false,
      mobileEditingTask: editing, setMobileEditingTask: vi.fn(),
      mobileEditIsInbox: false, setMobileEditIsInbox: vi.fn(),
      mobileEditingNativeEvent: null, setMobileEditingNativeEvent: vi.fn(),
      selectedDate: new Date('2026-11-07T12:00:00'),
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', darkMode: false, hoverBg: 'hover:bg-stone-100',
      colors: TASK_COLORS,
      formatTime: (x) => x, use24HourClock: false,
      setShowRecurrencePicker: vi.fn(), setShowDatePicker: vi.fn(), setShowColorPicker: vi.fn(),
      setShowRecurrenceEndDatePicker: vi.fn(), setShowTimePicker: vi.fn(), setDeadlinePickerTaskId: vi.fn(),
      tasks: TASKS, unscheduledTasks, recurringTasks: RECURRING,
      addTask, saveMobileEditTask, moveToRecycleBin: vi.fn(), sendTaskToBucket: vi.fn(),
    };
    return (
      <DayPlannerContext.Provider value={ctx}>
        <Modal />
      </DayPlannerContext.Provider>
    );
  }
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <FeaturesContext.Provider value={{ aiConfig: {}, goalsProjectsEnabled: false, multiUserEnabled: false, users: [], goals: [], projects: [], areas: [] }}>
          <SyncContext.Provider value={{}}>
            <Harness />
          </SyncContext.Provider>
        </FeaturesContext.Provider>
      </I18nextProvider>,
      { createNodeMock: nodeMock },
    );
  });
  if (title) act(() => { state.setNewTask((prev) => ({ ...prev, title })); });

  const find = (props) => root.root.findAll((n) => typeof n.type === 'string' && Object.entries(props).every(([k, v]) => n.props[k] === v));
  const one = (props) => find(props)[0];
  const text = (node) => (typeof node === 'string' ? node : (node?.children || []).map(text).join(''));
  const trigger = () => one({ 'data-tag-picker-trigger': true });
  const panel = () => one({ 'data-tag-picker-panel': true });
  const search = () => one({ 'data-tag-picker-search': true });
  const chip = (tag) => one({ 'data-tag-picker-chip': tag });
  const chips = () => root.root.findAll((n) => typeof n.type === 'string' && n.props['data-tag-picker-chip'] !== undefined)
    .map((n) => n.props['data-tag-picker-chip']);
  const pressed = () => root.root.findAll((n) => typeof n.type === 'string' && n.props['data-tag-picker-chip'] !== undefined && n.props['aria-pressed'])
    .map((n) => n.props['data-tag-picker-chip']);
  const creates = () => root.root.findAll((n) => typeof n.type === 'string' && n.props['data-tag-picker-create'] !== undefined)
    .map((n) => n.props['data-tag-picker-create']);
  const click = (node) => act(() => { node.props.onClick(); });
  const type = (value) => act(() => { search().props.onChange({ target: { value } }); });
  const key = (node, k, extra = {}) => {
    const e = { key: k, target: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra };
    act(() => { node.props.onKeyDown(e); });
    return e;
  };
  const titleInput = () => root.root.findAll((n) => n.type === 'input' && n.props.type === 'text')[0];
  return {
    root, state: () => state, title: () => state.newTask.title, addTask, saveMobileEditTask,
    find, one, text, trigger, panel, search, chip, chips, pressed, creates, click, type, key, titleInput,
  };
}

const EDITORS = [
  ['the desktop editor', { Modal: DesktopNewTaskModal, isMobile: false }],
  ['the phone\'s editor sheet', { Modal: MobileNewTaskModal, isMobile: true }],
];

describe.each(EDITORS)('the tag picker in %s', (_name, editor) => {
  it('is one closed row under the title, showing the title\'s tags', () => {
    const p = setup({ ...editor, title: 'Call Bob #Home' });
    expect(p.panel()).toBeUndefined();
    expect(p.trigger().props['aria-expanded']).toBe(false);
    expect(p.text(p.one({ 'data-tag-picker-selected': true }))).toBe('#home');
    const untagged = setup({ ...editor, title: 'Call Bob' });
    expect(p.text(untagged.trigger())).toContain('No tags');
  });

  it('lists the tags in use by name, the title\'s own picked, and not #obsidian', () => {
    const p = setup({ ...editor, title: 'Call Bob #work' });
    p.click(p.trigger());
    expect(p.chips()).toEqual(['garden', 'home', 'urgent', 'work', 'workshop']);
    // MUTATION: mark a chip picked by a prefix match and #workshop is picked too.
    expect(p.pressed()).toEqual(['work']);
    expect(p.chips()).not.toContain('calendar'); // a calendar event's tag is not the user's
  });

  it('picking a tag adds it to the end of the title; picking it again takes it out', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    p.click(p.chip('home'));
    expect(p.title()).toBe('Call Bob #home');
    expect(p.pressed()).toEqual(['home']);
    p.click(p.chip('urgent'));
    expect(p.title()).toBe('Call Bob #home #urgent');
    p.click(p.chip('home'));
    expect(p.title()).toBe('Call Bob #urgent');
    expect(p.pressed()).toEqual(['urgent']);
  });

  it('unpicking a tag mid-title keeps the title whole, and a longer tag alone', () => {
    const p = setup({ ...editor, title: 'Call #Work Bob #workshop, today' });
    p.click(p.trigger());
    expect(p.pressed()).toEqual(['work', 'workshop']);
    p.click(p.chip('work'));
    expect(p.title()).toBe('Call Bob #workshop, today');
    p.click(p.chip('workshop'));
    expect(p.title()).toBe('Call Bob, today');
  });

  it('a tag typed into this title, not yet saved anywhere, shows picked and can be unpicked', () => {
    const p = setup({ ...editor, title: 'Call Bob #brandnew' });
    p.click(p.trigger());
    expect(p.pressed()).toEqual(['brandnew']);
    p.click(p.chip('brandnew'));
    expect(p.title()).toBe('Call Bob');
  });

  it('#obsidian typed into the title shows picked, and can be unpicked', () => {
    const p = setup({ ...editor, title: 'Journal #obsidian' });
    p.click(p.trigger());
    expect(p.pressed()).toEqual(['obsidian']);
    p.click(p.chip('obsidian'));
    expect(p.title()).toBe('Journal');
  });

  it('the field filters as the tag manager\'s search does', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    p.type('#WOR');
    expect(p.chips()).toEqual(['work', 'workshop']);
    p.type('zzz-nothing');
    expect(p.chips()).toEqual([]);
  });

  it('offers "Add #…" for a tag nobody uses, normalised, and adds it', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    p.type('#Errands');
    expect(p.creates()).toEqual(['errands']);
    const add = p.one({ 'data-tag-picker-create': 'errands' });
    expect(p.text(add)).toBe('Add #errands');
    p.click(add);
    expect(p.title()).toBe('Call Bob #errands');
    expect(p.search().props.value).toBe('');
    expect(p.pressed()).toEqual(['errands']);
  });

  it('offers nothing to add for a tag in use, for words that are not a tag, or for #obsidian', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    for (const q of ['work', 'two words', 'obsidian']) {
      p.type(q);
      expect(p.creates()).toEqual([]);
    }
    p.type('obsidian');
    expect(p.chips()).toEqual([]);
    expect(p.one({ 'data-tag-picker-empty': true })).toBeDefined();
  });

  it('Enter in the field adds and never submits the editor', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    p.type('wo');
    const e = p.key(p.search(), 'Enter');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(p.title()).toBe('Call Bob #work');
    expect(p.addTask).not.toHaveBeenCalled();
    p.type('work');
    p.key(p.search(), 'Enter');
    expect(p.title()).toBe('Call Bob #work');
  });

  it('with no tags in use, the field is for adding one', () => {
    const p = setup({ ...editor, title: '', unscheduledTasks: [] });
    act(() => { p.state().setNewTask((prev) => ({ ...prev, title: '' })); });
    p.click(p.trigger());
    expect(p.search().props.placeholder).toBe('Add a tag');
    expect(p.chips()).toEqual(['garden', 'home', 'urgent']);
  });

  it('Escape closes the picker and stops there, so the editor stays open', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    const e = p.key(p.panel(), 'Escape');
    expect(e.stopPropagation).toHaveBeenCalled();
    expect(p.panel()).toBeUndefined();
  });

  it('opening puts the caret in the field on desktop, not on a phone, where it would raise the keyboard', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    expect(!!globalThis.document.activeElement?.search).toBe(!editor.isMobile);
  });

  it('Escape hands the focus back to the row; adding a new tag keeps it in the field', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    p.type('errands');
    p.click(p.one({ 'data-tag-picker-create': 'errands' }));
    expect(globalThis.document.activeElement?.search).toBe(true);
    p.key(p.panel(), 'Escape');
    expect(globalThis.document.activeElement?.trigger).toBe(true);
  });

  it('a tap outside closes it', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    act(() => { for (const fn of listeners.pointerdown) fn({ target: {} }); });
    expect(p.panel()).toBeUndefined();
  });

  it('Space and Enter on a chip toggle it; Ctrl+Enter is left to the form, to save', () => {
    const p = setup({ ...editor, title: 'Call Bob' });
    p.click(p.trigger());
    const space = p.key(p.chip('home'), ' ');
    expect(space.preventDefault).toHaveBeenCalled();
    expect(p.title()).toBe('Call Bob #home');
    p.key(p.chip('home'), 'Enter');
    expect(p.title()).toBe('Call Bob');
    const save = p.key(p.chip('home'), 'Enter', { ctrlKey: true });
    expect(save.preventDefault).not.toHaveBeenCalled();
    expect(p.title()).toBe('Call Bob');
  });

  it('editing an existing task: the picker edits its title the same way', () => {
    const editing = { id: 't1', title: 'Fix the gutter #home #urgent', date: '2026-11-07' };
    const p = setup({ ...editor, editing, title: editing.title });
    p.click(p.trigger());
    expect(p.pressed()).toEqual(['home', 'urgent']);
    p.click(p.chip('home'));
    expect(p.title()).toBe('Fix the gutter #urgent');
  });
});

describe('the tag picker and the quick-add parse', () => {
  // The save strips the parsed phrases ("tomorrow") from the title by
  // position, so a tag taken out before one must move the spans with it.
  it('re-reads the title, so the phrases the save strips follow the text that moved', () => {
    const p = setup({ Modal: DesktopNewTaskModal, title: '' });
    act(() => { p.titleInput().props.onChange({ target: { value: '#home Call Bob tomorrow', selectionStart: 23 } }); });
    const before = p.state().newTask.nlSpans.find((s) => s.type === 'date');
    expect(before).toBeDefined();
    p.click(p.trigger());
    p.click(p.chip('home'));
    expect(p.title()).toBe('Call Bob tomorrow');
    const after = p.state().newTask.nlSpans.find((s) => s.type === 'date');
    expect(p.title().slice(after.start, after.end)).toBe('tomorrow');
  });
});
