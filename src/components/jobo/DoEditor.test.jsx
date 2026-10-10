import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoRecord } from '../../jobo/core.js';
import { DayPlannerContext } from '../../context/DayPlannerContext.jsx';

// Only the portal is flattened for server rendering; the editor and its
// eligibility rules are real. Pointer/selection transitions run in Chromium.
vi.mock('react-dom', async importOriginal => ({ ...await importOriginal(), createPortal: node => node }));
import DoEditor, { makeTaskAfterClose } from './DoEditor.jsx';

const date = '2026-09-28';
const stamp = `${date}T10:00:00+08:00`;
const record = (over = {}) => createDoRecord({
  id: 'manual:1', taskId: null, source: 'manual', title: 'Work', progress: 'partial',
  timing: 'timed', date, startTime: '09:00', endDate: date, endTime: '10:00', planSnapshot: null,
  createdAt: stamp, updatedAt: stamp, observedAt: stamp, ...over,
});
afterEach(() => vi.unstubAllGlobals());
const render = (props = {}) => {
  vi.stubGlobal('document', { body: {} });
  const write = vi.fn();
  const html = renderToStaticMarkup(
    <DayPlannerContext.Provider value={{ formatTime: value => value, use24HourClock: true }}>
      <DoEditor initial={{ date, startMinute: 540, title: 'Work' }} records={props.record ? [props.record] : []}
        writable recordJobo={write} onClose={() => {}} t={key => key}
        cardBg="bg-white" borderClass="border-stone-200" textPrimary="text-stone-900" {...props} />
    </DayPlannerContext.Provider>,
  );
  expect(write).not.toHaveBeenCalled();
  return html;
};
const hasCompleted = html => /<option[^>]*value="completed"/.test(html);

describe('Do editor Completed eligibility', () => {
  it('offers Completed on new and existing unlinked manual work', () => {
    expect(hasCompleted(render())).toBe(true);
    expect(hasCompleted(render({ record: record() }))).toBe(true);
  });
  it.each([false, true])('does not grant a linked manual Do completion power (taskCompleted=%s)', taskCompleted => {
    const task = { id: 't1', title: 'Task', completed: taskCompleted };
    expect(hasCompleted(render({ initial: { date, startMinute: 540, title: 'Task', task }, taskCompleted }))).toBe(false);
    expect(hasCompleted(render({ record: record({ taskId: 't1' }), taskCompleted }))).toBe(false);
  });
  it('offers restoration only while the completion-source task remains completed', () => {
    const completion = record({ id: `do:t1:${stamp}`, taskId: 't1', source: 'completion' });
    expect(hasCompleted(render({ record: completion, taskCompleted: true }))).toBe(true);
    expect(hasCompleted(render({ record: completion, taskCompleted: false }))).toBe(false);
  });
  it('explains a now-invalid selected Completed without silently changing it', () => {
    const html = render({ initial: { date, startMinute: 540, title: 'Work', task: { id: 't1' }, patch: { progress: 'completed' } } });
    expect(html).toMatch(/<option[^>]*value="completed"[^>]*disabled=""[^>]*selected=""/);
    expect(html).toContain('role="status">jobo.view.completionUnavailable');
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
  // The hint under Progress appears only when Completed is out of reach, and
  // says what to do instead (#1726 wording pass).
  const hint = (html) => html.match(/data-jobo-progress-hint[^>]*>([^<]*)</)?.[1] ?? null;
  it('says nothing when Completed is available', () => {
    expect(hint(render({ record: record() }))).toBeNull();
    const completion = record({ id: `do:t1:${stamp}`, taskId: 't1', source: 'completion' });
    expect(hint(render({ record: completion, taskCompleted: true }))).toBeNull();
    expect(render({ record: record() })).not.toContain('jobo.view.completedByCompletion');
  });
  it('points a linked Do at its task, by the task\'s state', () => {
    const linked = record({ taskId: 't1' });
    expect(hint(render({ record: linked, onCompleteTask: () => {} }))).toBe('jobo.view.completeTaskInstead');
    expect(hint(render({ record: linked, taskCompleted: true }))).toBe('jobo.view.taskAlreadyDone');
    expect(hint(render({ record: linked }))).toBe('jobo.view.linkedNoCompletion');
  });
  it('asks for the task to be checked again on a completion record whose task is open', () => {
    const completion = record({ id: `do:t1:${stamp}`, taskId: 't1', source: 'completion' });
    expect(hint(render({ record: completion, taskCompleted: false }))).toBe('jobo.view.checkTaskAgain');
  });
  it('keeps the reassurance on a Completed record', () => {
    expect(hint(render({ record: record({ progress: 'completed' }) }))).toBe('jobo.view.completedStays');
  });
  it('does not mistake keeping an existing Completed value for a new reassessment', () => {
    const html = render({ record: record({ source: 'completion', taskId: 'missing', progress: 'completed' }) });
    expect(hasCompleted(html)).toBe(true);
    expect(html).not.toContain('role="status">jobo.view.completionUnavailable');
    expect(html).not.toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
  });
});

// "Complete task" is the linked task's checkbox, placed in the editor: shown
// when JoboView hands it a handler, which it does only for a linked manual Do
// whose task is not done (offersCompleteTask). It never writes the record.
describe('Complete task in the Do editor', () => {
  it('shows the action only when there is a task to complete', () => {
    const linked = record({ taskId: 't1' });
    const html = render({ record: linked, onCompleteTask: () => {} });
    expect(html).toContain('data-jobo-complete-task');
    expect(html).toContain('jobo.view.completeTask');
    expect(html).toContain('jobo.view.completeTaskHint');
    expect(render({ record: linked })).not.toContain('data-jobo-complete-task');
  });
  it('sits inside the form, so a read-only ledger disables it with the rest', () => {
    const html = render({ record: record({ taskId: 't1' }), onCompleteTask: () => {}, writable: false });
    expect(html).toMatch(/<fieldset disabled=""[\s\S]*data-jobo-complete-task[\s\S]*<\/fieldset>/);
  });
});

// "Make a task" from an unlinked Do: offered when the hook passes it
// (useJoboDoActions, from canLinkDo and the app's opener), inside the form.
describe('Make a task in the Do editor', () => {
  it('shows the action only when it is offered', () => {
    const html = render({ record: record(), onMakeTask: () => {} });
    expect(html).toContain('data-jobo-make-task');
    expect(html).toContain('jobo.makeTask');
    expect(html).toContain('jobo.makeTaskHint');
    expect(render({ record: record() })).not.toContain('data-jobo-make-task');
  });
  it('opens the form at once from the dialog; from a sheet, after its back entry is popped', () => {
    const order = [];
    makeTaskAfterClose({ sheet: false, onClose: () => order.push('close'), onMakeTask: () => order.push('form') });
    expect(order).toEqual(['close', 'form']);
    // MUTATION: open the form at once from a sheet and the late pop closes it.
    const listeners = {}; const timers = [];
    const win = {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      removeEventListener: (type) => { delete listeners[type]; },
      setTimeout: (fn) => timers.push(fn),
    };
    const onMakeTask = vi.fn();
    makeTaskAfterClose({ sheet: true, onClose: () => {}, onMakeTask, win });
    expect(onMakeTask).not.toHaveBeenCalled();
    listeners.popstate();
    timers.forEach(fn => fn());
    expect(onMakeTask).toHaveBeenCalledTimes(1);
    expect(listeners.popstate).toBeUndefined();
    // No entry to pop: the fallback opens it.
    const late = vi.fn();
    makeTaskAfterClose({ sheet: true, onClose: () => {}, onMakeTask: late, win: { ...win, setTimeout: fn => fn() } });
    expect(late).toHaveBeenCalledTimes(1);
  });
  it('sits inside the form, so a read-only ledger disables it with the rest', () => {
    const html = render({ record: record(), onMakeTask: () => {}, writable: false });
    expect(html).toMatch(/<fieldset disabled=""[\s\S]*data-jobo-make-task[\s\S]*<\/fieldset>/);
  });
});

// The phone's form (JOBO slice 8, step 2): a sheet from the bottom, with no
// keyboard hints, since a phone has no Enter or Escape keys to point at.
describe('Do editor as a sheet', () => {
  it('rises from the bottom with a grabber, and drops the keyboard hints', () => {
    const html = render({ sheet: true });
    expect(html).toContain('data-jobo-do-editor="sheet"');
    expect(html).toContain('items-end');
    expect(html).toContain('rounded-t-2xl');
    expect(html).not.toContain('<kbd');
  });
  it('stays the centred dialog elsewhere', () => {
    const html = render();
    expect(html).toContain('data-jobo-do-editor="dialog"');
    expect(html).toContain('items-center');
    expect(html).toContain('<kbd');
  });
});
