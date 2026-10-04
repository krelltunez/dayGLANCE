import { describe, expect, it, vi } from 'vitest';
import { attachBackClose } from './useBackClose.js';
import { attachMobileTabBack } from './useMobileTabBack.js';

// A history stack with the browser's shape: back() is asynchronous and lands
// as a popstate event carrying the state below; pushState fires nothing.
function fakeWindow(initialState = null) {
  const stack = [initialState];
  let index = 0;
  const listeners = new Set();
  const timers = [];
  const pops = [];
  const win = {
    history: {
      get state() { return stack[index]; },
      pushState(state) { stack.splice(index + 1); stack.push(state); index += 1; },
      back() { pops.push(() => { if (index > 0) index -= 1; listeners.forEach((fn) => fn({ state: stack[index] })); }); },
    },
    addEventListener: (type, fn) => { if (type === 'popstate') listeners.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'popstate') listeners.delete(fn); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: (id) => { timers[id - 1] = null; },
  };
  const flush = () => {
    while (timers.some(Boolean) || pops.length) {
      const due = timers.splice(0).filter(Boolean);
      due.forEach((fn) => fn());
      pops.splice(0).forEach((fn) => fn());
    }
  };
  return { win, flush, depth: () => index, listeners };
}

describe('attachBackClose', () => {
  it('closes the overlay on back, leaving the tab underneath where it was', () => {
    const { win, flush, depth } = fakeWindow();
    const setTab = vi.fn();
    attachMobileTabBack({ tab: 'goals', setTab, win });
    const onClose = vi.fn();
    attachBackClose({ key: 'plannerSheet', onClose, win });
    expect(depth()).toBe(2);
    win.history.back();
    flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(setTab).not.toHaveBeenCalled(); // still on Goals
    expect(depth()).toBe(1);
  });

  it('pops its own entry when closed another way, so the next back is not swallowed', () => {
    const { win, flush, depth } = fakeWindow({ appTab: 'goals' });
    const onClose = vi.fn();
    const detach = attachBackClose({ key: 'plannerSheet', onClose, win });
    expect(depth()).toBe(1);
    detach(); // the X, Escape or the backdrop closed it
    flush();
    expect(depth()).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not pop twice after a back already closed it', () => {
    const { win, flush, depth } = fakeWindow({ appTab: 'goals' });
    const detach = attachBackClose({ key: 'bucketList', onClose: () => detach(), win });
    win.history.back();
    flush();
    expect(depth()).toBe(0);
  });

  it('survives an immediate remount (React StrictMode) without closing or stacking entries', () => {
    const { win, flush, depth } = fakeWindow({ appTab: 'goals' });
    const onClose = vi.fn();
    const detach = attachBackClose({ key: 'plannerSheet', onClose, win });
    detach();
    attachBackClose({ key: 'plannerSheet', onClose, win });
    flush();
    expect(depth()).toBe(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('nests: back closes the inner page first, then the overlay', () => {
    const { win, flush, depth } = fakeWindow({ appTab: 'goals' });
    const closePlanner = vi.fn();
    const closePage = vi.fn();
    attachBackClose({ key: 'plannerSheet', onClose: closePlanner, win });
    attachBackClose({ key: 'plannerHyperglance', onClose: closePage, win });
    expect(depth()).toBe(2);
    win.history.back();
    flush();
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closePlanner).not.toHaveBeenCalled();
    win.history.back();
    flush();
    expect(closePlanner).toHaveBeenCalledTimes(1);
  });

  it('closing the overlay with its inner page open pops both entries', () => {
    const { win, flush, depth } = fakeWindow({ appTab: 'goals' });
    const detachPlanner = attachBackClose({ key: 'plannerSheet', onClose: vi.fn(), win });
    const detachPage = attachBackClose({ key: 'plannerHyperglance', onClose: vi.fn(), win });
    detachPage();
    detachPlanner();
    flush();
    expect(depth()).toBe(0);
  });

  it('does not close the overlay under a task editor; back does nothing there', () => {
    const { win, flush, depth } = fakeWindow({ appTab: 'goals' });
    const onClose = vi.fn();
    let editorOpen = true;
    attachBackClose({ key: 'plannerSheet', onClose, isCovered: () => editorOpen, win });
    win.history.back();
    flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(depth()).toBe(1); // the entry is back, so the next press still works
    editorOpen = false;
    win.history.back();
    flush();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('an editor over PLANNER: back closes the editor, and saving it leaves PLANNER open', () => {
    const { win, flush, depth } = fakeWindow({ appTab: 'goals' });
    const closePlanner = vi.fn();
    const closeEditor = vi.fn();
    attachBackClose({ key: 'dgPlannerSheet', onClose: closePlanner, win });
    attachBackClose({ key: 'dgTaskEditor', onClose: closeEditor, win });
    win.history.back();
    flush();
    expect(closeEditor).toHaveBeenCalledTimes(1);
    expect(closePlanner).not.toHaveBeenCalled();
    // reopen the editor, then close it with Save: its own entry is popped for it
    const detachEditor = attachBackClose({ key: 'dgTaskEditor', onClose: closeEditor, win });
    expect(depth()).toBe(2);
    detachEditor();
    flush();
    expect(depth()).toBe(1);
    expect(closePlanner).not.toHaveBeenCalled();
  });
});
