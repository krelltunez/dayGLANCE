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
import { DEFAULT_TASK_DURATION_KEY } from '../utils/defaultTaskDuration.js';
import useNewTaskInput from '../hooks/useNewTaskInput.js';
import { DurationField } from './TaskTimeFields.jsx';
import DesktopNewTaskModal from './DesktopNewTaskModal.jsx';
import MobileNewTaskModal from './MobileNewTaskModal.jsx';

// #2367: an Inbox task's length can be set in the editor on desktop as on the
// phone (it is the block the task takes when dragged onto the timeline), and
// a new task's form starts at the default task duration.

let i18n;
beforeAll(async () => {
  const bundle = await loaders.en();
  i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', fallbackLng: false, resources: { en: { translation: bundle } }, interpolation: { escapeValue: false } });
});

let stored;
beforeEach(() => {
  stored = {};
  globalThis.document = { activeElement: null, addEventListener: () => {}, removeEventListener: () => {} };
  globalThis.localStorage = {
    getItem: (k) => (k in stored ? stored[k] : null),
    setItem: (k, v) => { stored[k] = String(v); },
    removeItem: (k) => { delete stored[k]; },
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
});
afterEach(() => { delete globalThis.document; delete globalThis.localStorage; delete globalThis.requestAnimationFrame; });

const nodeMock = () => ({ focus: () => {}, blur: () => {}, contains: () => true, scrollIntoView: () => {}, setSelectionRange: () => {}, style: {} });

function setup({ Modal, isMobile = false, editing = null, inbox = true }) {
  let state;
  function Harness() {
    const input = useNewTaskInput({ allTags: [], showAddTask: true, t: i18n.t, language: 'en', use24HourClock: false, isEditing: !!editing });
    state = input;
    const ctx = {
      ...input,
      showAddTask: true, setShowAddTask: vi.fn(),
      isMobile, isTablet: false,
      mobileEditingTask: editing, setMobileEditingTask: vi.fn(),
      mobileEditIsInbox: inbox, setMobileEditIsInbox: vi.fn(),
      mobileEditingNativeEvent: null, setMobileEditingNativeEvent: vi.fn(),
      selectedDate: new Date('2026-11-07T12:00:00'),
      cardBg: 'bg-white', borderClass: 'border-stone-200', textPrimary: 'text-stone-900', textSecondary: 'text-stone-500', darkMode: false, hoverBg: 'hover:bg-stone-100',
      colors: TASK_COLORS,
      formatTime: (x) => x, use24HourClock: false,
      setShowRecurrencePicker: vi.fn(), setShowDatePicker: vi.fn(), setShowColorPicker: vi.fn(),
      setShowRecurrenceEndDatePicker: vi.fn(), setShowTimePicker: vi.fn(), setDeadlinePickerTaskId: vi.fn(),
      tasks: [], unscheduledTasks: [], recurringTasks: [],
      addTask: vi.fn(), saveMobileEditTask: vi.fn(), moveToRecycleBin: vi.fn(), sendTaskToBucket: vi.fn(),
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
  if (inbox) act(() => { state.setNewTask((prev) => ({ ...prev, title: 'Sort the receipts', openInInbox: true })); });
  return { root, state: () => state };
}

describe('the desktop Inbox editor has a duration (#2367)', () => {
  it('shows the duration field for an Inbox task, and setting it sets the task\'s length', () => {
    const p = setup({ Modal: DesktopNewTaskModal });
    const fields = p.root.root.findAllByType(DurationField);
    expect(fields).toHaveLength(1);
    act(() => { fields[0].props.onChange(90); });
    expect(p.state().newTask.duration).toBe(90);
  });

  it('a Bucket item has it once, in place of priority and deadline', () => {
    const p = setup({ Modal: DesktopNewTaskModal, editing: { id: 'b1', title: 'Learn to sail', bucketId: 'list-1' } });
    expect(p.root.root.findAllByType(DurationField)).toHaveLength(1);
  });

  it('as on the phone', () => {
    const p = setup({ Modal: MobileNewTaskModal, isMobile: true });
    expect(p.root.root.findAllByType(DurationField)).toHaveLength(1);
  });
});

describe('a new task\'s form starts at the default task duration (#2367)', () => {
  it('30 minutes until one is chosen', () => {
    const p = setup({ Modal: DesktopNewTaskModal });
    expect(p.state().newTask.duration).toBe(30);
  });

  it('the chosen default, read when the form is made', () => {
    stored[DEFAULT_TASK_DURATION_KEY] = '60';
    const p = setup({ Modal: DesktopNewTaskModal });
    expect(p.state().newTask.duration).toBe(60);
  });
});
