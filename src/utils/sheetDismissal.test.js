import { describe, it, expect, vi } from 'vitest';
import {
  createSheetController, shouldDismissPull, shouldDismissEdgeSwipe, dragAxis, pageDirection,
  SHEET_PULL_DISMISS_PX, SHEET_EDGE_DISMISS_PX, SHEET_EDGE_START_PX, SHEET_AXIS_LOCK_PX, SHEET_PAGE_SWIPE_PX,
} from './sheetDismissal.js';

function fakeWindow({ hasInnerOverlay = false } = {}) {
  const listeners = {};
  const win = {
    history: {
      state: null,
      entries: [],
      pushState: vi.fn((state) => { win.history.entries.push(win.history.state); win.history.state = state; }),
      back: vi.fn(() => { win.history.state = win.history.entries.pop() ?? null; (listeners.popstate || []).forEach((fn) => fn({ state: win.history.state })); }),
    },
    addEventListener: vi.fn((type, fn) => { (listeners[type] ||= []).push(fn); }),
    removeEventListener: vi.fn((type, fn) => { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); }),
    hasInnerOverlay: () => hasInnerOverlay,
    fire: (type, event) => (listeners[type] || []).forEach((fn) => fn(event)),
    listenerCount: (type) => (listeners[type] || []).length,
  };
  return win;
}

const setup = (opts) => {
  const win = fakeWindow(opts);
  const onClose = vi.fn();
  const onPage = vi.fn();
  const ctl = createSheetController({ key: 'monthDaySheet', onClose, onPage, win });
  ctl.open();
  return { win, onClose, onPage, ctl };
};

describe('sheet dismissal controller', () => {
  it('pushes a history entry on open so the browser and Android back close the sheet', () => {
    const { win, onClose } = setup();
    expect(win.history.pushState).toHaveBeenCalledTimes(1);
    expect(win.history.state).toEqual({ monthDaySheet: true });
    expect(onClose).not.toHaveBeenCalled();
    win.history.back();
    expect(onClose).toHaveBeenCalledWith('back');
  });

  it('stays open when an overlay opened over it (the task editor) is popped', () => {
    const { win, onClose } = setup();
    // the editor's entry copies the sheet's (hooks/useBackClose.js)
    win.history.pushState({ ...win.history.state, dgTaskEditor: true }, '');
    win.history.back();
    expect(onClose).not.toHaveBeenCalled();
    win.history.back();
    expect(onClose).toHaveBeenCalledWith('back');
  });

  it('pushes once even when opened twice on the same entry (StrictMode double effects)', () => {
    const win = fakeWindow();
    const first = createSheetController({ key: 'monthDaySheet', onClose: vi.fn(), win });
    first.open(); first.dispose();
    const onClose = vi.fn();
    const second = createSheetController({ key: 'monthDaySheet', onClose, win });
    second.open();
    expect(win.history.pushState).toHaveBeenCalledTimes(1);
    expect(win.history.entries).toHaveLength(1);
    win.fire('keydown', { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(win.history.state).toBeNull(); // the stack is back where it started
  });

  it('closes on Escape by unwinding its own history entry, closing exactly once', () => {
    const { win, onClose } = setup();
    win.fire('keydown', { key: 'Escape' });
    expect(win.history.back).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith('back');
    expect(win.history.state).toBeNull();
  });

  it('ignores other keys, an already-handled Escape, and Escape while an inner overlay is open', () => {
    const { win, onClose } = setup();
    win.fire('keydown', { key: 'Enter' });
    win.fire('keydown', { key: 'Escape', defaultPrevented: true });
    expect(onClose).not.toHaveBeenCalled();
    const inner = setup({ hasInnerOverlay: true });
    inner.win.fire('keydown', { key: 'Escape' });
    expect(inner.onClose).not.toHaveBeenCalled();
  });

  it('closes directly when it never got a history entry (no history API)', () => {
    const win = fakeWindow(); win.history = undefined;
    const onClose = vi.fn();
    const ctl = createSheetController({ key: 'k', onClose, win });
    ctl.open();
    ctl.dismiss('button');
    expect(onClose).toHaveBeenCalledWith('button');
  });

  it('dismisses on a pull-down past the threshold, only from the top of the content', () => {
    const { ctl, onClose } = setup();
    ctl.onDragStart({ x: 100, y: 100, t: 0, scrollTop: 0 });
    expect(ctl.onDragMove({ x: 102, y: 160, t: 80 })).toBe(60);
    expect(ctl.onDragMove({ x: 104, y: 100 + SHEET_PULL_DISMISS_PX + 10, t: 300 })).toBe(SHEET_PULL_DISMISS_PX + 10);
    expect(ctl.onDragEnd()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);

    const scrolled = setup();
    scrolled.ctl.onDragStart({ x: 100, y: 100, t: 0, scrollTop: 240 });
    expect(scrolled.ctl.onDragMove({ x: 100, y: 400, t: 300 })).toBe(0);
    expect(scrolled.ctl.onDragEnd()).toBe(false);
    expect(scrolled.onClose).not.toHaveBeenCalled();
  });

  it('dismisses on a quick short flick but not a slow short pull', () => {
    expect(shouldDismissPull({ dy: 40, dtMs: 50, scrollTop: 0 })).toBe(true);
    expect(shouldDismissPull({ dy: 40, dtMs: 600, scrollTop: 0 })).toBe(false);
    expect(shouldDismissPull({ dy: -80, dtMs: 50, scrollTop: 0 })).toBe(false);
    const quick = setup();
    quick.ctl.onDragStart({ x: 50, y: 300, t: 0, scrollTop: 0 });
    quick.ctl.onDragMove({ x: 50, y: 340, t: 40 }); // 1px/ms over 40px: a fling
    expect(quick.ctl.onDragEnd()).toBe(true);
    expect(quick.onClose).toHaveBeenCalledTimes(1);
    const slow = setup();
    slow.ctl.onDragStart({ x: 50, y: 300, t: 0, scrollTop: 0 });
    slow.ctl.onDragMove({ x: 50, y: 340, t: 600 });
    expect(slow.ctl.onDragEnd()).toBe(false);
    expect(slow.onClose).not.toHaveBeenCalled();
  });

  it('dismisses on a left-edge swipe and nothing else horizontal', () => {
    expect(shouldDismissEdgeSwipe({ startX: SHEET_EDGE_START_PX, dx: SHEET_EDGE_DISMISS_PX, dy: 10 })).toBe(true);
    expect(shouldDismissEdgeSwipe({ startX: SHEET_EDGE_START_PX + 1, dx: 200, dy: 0 })).toBe(false);
    expect(shouldDismissEdgeSwipe({ startX: 4, dx: 60, dy: 0 })).toBe(false);
    expect(shouldDismissEdgeSwipe({ startX: 4, dx: 100, dy: 140 })).toBe(false);
    const { ctl, onClose } = setup();
    ctl.onDragStart({ x: 8, y: 300, t: 0, scrollTop: 500 }); // scrolled content does not matter for the edge
    ctl.onDragMove({ x: 120, y: 310, t: 200 });
    expect(ctl.onDragEnd()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('never closes twice and stops listening on dispose', () => {
    const { win, ctl, onClose } = setup();
    ctl.dismiss('button');
    ctl.dismiss('button');
    win.fire('popstate', {});
    expect(onClose).toHaveBeenCalledTimes(1);
    ctl.dispose();
    expect(win.listenerCount('popstate')).toBe(0);
    expect(win.listenerCount('keydown')).toBe(0);
  });
});

describe('sheet paging (step 5)', () => {
  it('locks a drag to the dominant axis once past the slop', () => {
    expect(dragAxis({ dx: 4, dy: 4 })).toBeNull();
    expect(dragAxis({ dx: SHEET_AXIS_LOCK_PX, dy: 0 })).toBe('x');
    expect(dragAxis({ dx: 0, dy: SHEET_AXIS_LOCK_PX })).toBe('y');
    expect(dragAxis({ dx: 12, dy: 9 })).toBe('x');
    expect(dragAxis({ dx: 9, dy: 12 })).toBe('y');
    expect(dragAxis({ dx: 10, dy: 10 })).toBe('y'); // a tie stays a dismiss, never a page
  });

  it('pages on a long or quick horizontal swipe, in either direction', () => {
    expect(pageDirection({ dx: -SHEET_PAGE_SWIPE_PX, dtMs: 400 })).toBe(1);   // swipe left: next day
    expect(pageDirection({ dx: SHEET_PAGE_SWIPE_PX, dtMs: 400 })).toBe(-1);   // swipe right: previous day
    expect(pageDirection({ dx: -40, dtMs: 40 })).toBe(1);                     // a flick
    expect(pageDirection({ dx: -40, dtMs: 600 })).toBe(0);                    // a slow short drag
    expect(pageDirection({ dx: -10, dtMs: 5 })).toBe(0);                      // too short even when fast
  });

  it('pages to the next day on a swipe left and the previous on a swipe right, without dismissing', () => {
    const next = setup();
    next.ctl.onDragStart({ x: 300, y: 400, t: 0, scrollTop: 0 });
    expect(next.ctl.onDragMove({ x: 200, y: 404, t: 200 })).toBe(0); // horizontal: no pull offset
    expect(next.ctl.onDragEnd()).toBe(false);
    expect(next.onPage).toHaveBeenCalledWith(1);
    expect(next.onClose).not.toHaveBeenCalled();

    const prev = setup();
    prev.ctl.onDragStart({ x: 200, y: 400, t: 0, scrollTop: 300 }); // scrolled content still pages
    prev.ctl.onDragMove({ x: 300, y: 396, t: 200 });
    expect(prev.ctl.onDragEnd()).toBe(false);
    expect(prev.onPage).toHaveBeenCalledWith(-1);
    expect(prev.onClose).not.toHaveBeenCalled();
  });

  it('keeps a mostly-vertical drag a dismiss and never a page, even with sideways drift', () => {
    const { ctl, onClose, onPage } = setup();
    ctl.onDragStart({ x: 200, y: 100, t: 0, scrollTop: 0 });
    expect(ctl.onDragMove({ x: 206, y: 112, t: 50 })).toBe(12); // locks vertical
    expect(ctl.onDragMove({ x: 320, y: 240, t: 300 })).toBe(140); // later sideways drift is ignored
    expect(ctl.onDragEnd()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPage).not.toHaveBeenCalled();
  });

  it('keeps a drag that locked horizontal from dismissing, even if it then goes down', () => {
    const { ctl, onClose, onPage } = setup();
    ctl.onDragStart({ x: 200, y: 100, t: 0, scrollTop: 0 });
    expect(ctl.onDragMove({ x: 214, y: 104, t: 50 })).toBe(0); // locks horizontal
    expect(ctl.onDragMove({ x: 230, y: 300, t: 400 })).toBe(0);
    expect(ctl.onDragEnd()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    expect(onPage).not.toHaveBeenCalled(); // 30px right is neither a page nor a dismiss
  });

  it('lets the left-edge swipe win over paging to the previous day', () => {
    const { ctl, onClose, onPage } = setup();
    ctl.onDragStart({ x: SHEET_EDGE_START_PX, y: 300, t: 0, scrollTop: 0 });
    ctl.onDragMove({ x: SHEET_EDGE_START_PX + 120, y: 310, t: 200 });
    expect(ctl.onDragEnd()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onPage).not.toHaveBeenCalled();
  });

  it('pages with the arrow keys, but not while typing or under an inner overlay', () => {
    const { win, onPage, onClose } = setup();
    const right = { key: 'ArrowRight', target: { tagName: 'BUTTON' }, preventDefault: vi.fn() };
    win.fire('keydown', right);
    win.fire('keydown', { key: 'ArrowLeft', target: { tagName: 'BODY' } });
    expect(onPage.mock.calls).toEqual([[1], [-1]]);
    expect(right.preventDefault).toHaveBeenCalled();
    win.fire('keydown', { key: 'ArrowRight', target: { tagName: 'INPUT' } });
    win.fire('keydown', { key: 'ArrowRight', target: { tagName: 'DIV', isContentEditable: true } });
    win.fire('keydown', { key: 'ArrowRight', target: { tagName: 'BODY' }, defaultPrevented: true });
    win.fire('keydown', { key: 'ArrowUp', target: { tagName: 'BODY' } });
    expect(onPage).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();

    const inner = setup({ hasInnerOverlay: true });
    inner.win.fire('keydown', { key: 'ArrowRight', target: { tagName: 'BODY' } });
    expect(inner.onPage).not.toHaveBeenCalled();
  });

  it('stops paging once the sheet has closed', () => {
    const { win, ctl, onPage } = setup();
    ctl.dismiss('button');
    win.fire('keydown', { key: 'ArrowRight', target: { tagName: 'BODY' } });
    expect(onPage).not.toHaveBeenCalled();
  });
});
