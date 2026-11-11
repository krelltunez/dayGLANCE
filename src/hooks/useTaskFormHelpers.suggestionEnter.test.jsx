import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import useTaskFormHelpers from './useTaskFormHelpers.js';

// #2379, the inline rename (TaskTitleRenameField): Enter on a highlighted tag
// completes it instead of saving the rename; on a tag typed in full it saves;
// an input method's Enter does neither.

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup({ title, suggestions = [{ type: 'tag', value: 'work', display: '#work' }] }) {
  const deps = {
    tasks: [{ id: 't1', title: 'x', date: '2026-11-11', startTime: '09:00', duration: 30 }],
    setTasks: vi.fn(), setUnscheduledTasks: vi.fn(), setRecurringTasks: vi.fn(), pushUndo: vi.fn(),
    onboardingProgress: {}, setOnboardingProgress: vi.fn(), parseRecurringId: () => null,
    getAdjustedTimeForImportedConflicts: (id, t) => ({ adjustedStartTime: t }),
    buildSuggestions: () => [], suggestions, selectedSuggestionIndex: 0, showSuggestions: true,
    setSuggestions: vi.fn(), setSelectedSuggestionIndex: vi.fn(), setShowSuggestions: vi.fn(), setSuggestionContext: vi.fn(),
  };
  let api;
  function Harness() { api = useTaskFormHelpers(deps); return null; }
  act(() => { create(<Harness />); });
  act(() => { api.startEditingTask({ id: 't1', title }); });
  const press = (k, over = {}) => {
    const e = { key: k, nativeEvent: {}, preventDefault: vi.fn(), stopPropagation: vi.fn(),
      target: { selectionStart: title.length, setSelectionRange: () => {}, focus: () => {} }, ...over };
    act(() => { api.handleEditKeyDown(e, false); vi.runAllTimers(); });
    return e;
  };
  return { deps, press, text: () => api.editingTaskText, editing: () => api.editingTaskId };
}

describe('Enter in the inline rename (#2379)', () => {
  it('on a highlighted tag not yet typed in full, completes it and keeps renaming', () => {
    const r = setup({ title: 'Plan #wo' });
    const e = r.press('Enter');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(r.text()).toBe('Plan #work ');
    expect(r.editing()).toBe('t1');
    expect(r.deps.setTasks).not.toHaveBeenCalled();
  });

  it('on a tag typed in full, saves the rename as before', () => {
    const r = setup({ title: 'Plan #work' });
    r.press('Enter');
    expect(r.deps.setTasks).toHaveBeenCalled();
    expect(r.editing()).toBeNull();
  });

  it('with no suggestions open, saves as before', () => {
    const r = setup({ title: 'Plan', suggestions: [] });
    r.press('Enter');
    expect(r.deps.setTasks).toHaveBeenCalled();
  });

  // MUTATION: drop the guard and an input method's Enter saves the rename mid-word.
  it('an input method\'s Enter neither completes nor saves', () => {
    const r = setup({ title: 'Plan #wo' });
    r.press('Enter', { nativeEvent: { isComposing: true } });
    expect(r.text()).toBe('Plan #wo');
    expect(r.editing()).toBe('t1');
    expect(r.deps.setTasks).not.toHaveBeenCalled();
    const plain = setup({ title: '计划', suggestions: [] });
    plain.press('Enter', { nativeEvent: { keyCode: 229 } });
    expect(plain.deps.setTasks).not.toHaveBeenCalled();
  });
});
