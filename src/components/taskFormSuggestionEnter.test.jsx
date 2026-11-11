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

// #2379, the task form (new and edit): Enter on a highlighted tag completes it
// instead of saving and closing the form; on a tag typed in full it saves.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});
beforeEach(() => {
  vi.useFakeTimers();
  globalThis.document = { activeElement: null, addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
});
afterEach(() => { vi.useRealTimers(); delete globalThis.document; delete globalThis.localStorage; delete globalThis.requestAnimationFrame; });

function setup() {
  let state;
  function Harness() {
    const input = useNewTaskInput({ allTags: ['work', 'workshop', 'home'], showAddTask: true, t: i18n.t, language: 'en', use24HourClock: false, isEditing: false });
    state = input;
    const ctx = {
      ...input,
      showAddTask: true, setShowAddTask: vi.fn(), isMobile: false, isTablet: false,
      mobileEditingTask: null, setMobileEditingTask: vi.fn(), mobileEditIsInbox: false, setMobileEditIsInbox: vi.fn(),
      mobileEditingNativeEvent: null, setMobileEditingNativeEvent: vi.fn(),
      selectedDate: new Date('2026-11-11T12:00:00'),
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', darkMode: false, hoverBg: 'hover:bg-stone-100',
      colors: TASK_COLORS, formatTime: (x) => x, use24HourClock: false,
      setShowRecurrencePicker: vi.fn(), setShowDatePicker: vi.fn(), setShowColorPicker: vi.fn(),
      setShowRecurrenceEndDatePicker: vi.fn(), setShowTimePicker: vi.fn(), setDeadlinePickerTaskId: vi.fn(),
      tasks: [], unscheduledTasks: [], recurringTasks: [],
      addTask: vi.fn(), saveMobileEditTask: vi.fn(), moveToRecycleBin: vi.fn(), sendTaskToBucket: vi.fn(),
    };
    return <DayPlannerContext.Provider value={ctx}><DesktopNewTaskModal /></DayPlannerContext.Provider>;
  }
  let root;
  act(() => {
    root = create(
      <I18nextProvider i18n={i18n}>
        <FeaturesContext.Provider value={{ aiConfig: {}, goalsProjectsEnabled: false, multiUserEnabled: false, users: [], goals: [], projects: [], areas: [] }}>
          <SyncContext.Provider value={{}}><Harness /></SyncContext.Provider>
        </FeaturesContext.Provider>
      </I18nextProvider>,
      { createNodeMock: () => ({ focus: () => {}, blur: () => {}, setSelectionRange: () => {}, style: {} }) },
    );
  });
  const input = () => root.root.findAll((n) => n.type === 'input' && n.props.type === 'text')[0];
  const type = (value) => act(() => { input().props.onChange({ target: { value, selectionStart: value.length } }); });
  const press = (k, over = {}) => {
    const e = { key: k, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(), target: { selectionStart: state.newTask.title.length }, ...over };
    act(() => { input().props.onKeyDown(e); vi.runAllTimers(); });
    return e;
  };
  return { state: () => state, type, press };
}

describe('Enter in the task form\'s title (#2379)', () => {
  it('on a highlighted tag not yet typed in full, completes it, and the form is not submitted', () => {
    const p = setup();
    p.type('Plan #wo');
    expect(p.state().showSuggestions).toBe(true);
    const e = p.press('Enter');
    expect(e.preventDefault).toHaveBeenCalled(); // no implicit submit
    expect(p.state().newTask.title).toBe('Plan #work ');
    expect(p.state().showSuggestions).toBe(false);
  });

  it('on a tag typed in full, Enter is left to submit the form, as before', () => {
    const p = setup();
    p.type('Plan #work');
    expect(p.state().showSuggestions).toBe(true); // #work and #workshop
    const e = p.press('Enter');
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(p.state().newTask.title).toBe('Plan #work');
  });

  it('Down then Enter takes the suggestion arrowed to', () => {
    const p = setup();
    p.type('Plan #wo');
    p.press('ArrowDown');
    p.press('Enter');
    expect(p.state().newTask.title).toBe('Plan #workshop ');
  });

  it('an input method\'s Enter is left alone', () => {
    const p = setup();
    p.type('Plan #wo');
    const e = p.press('Enter', { nativeEvent: { isComposing: true } });
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(p.state().newTask.title).toBe('Plan #wo');
  });
});
