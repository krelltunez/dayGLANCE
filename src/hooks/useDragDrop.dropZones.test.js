import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Inbox and the recycle bin light up while something that can be dropped
// on them is dragged over them. Only a task drag can be (their drop handlers
// return without a dragged task), so only a task drag lights them.
//
// The case this pins (#2187 follow-up): reordering a subtask inside an Inbox
// card. Its dragover bubbles up to the Inbox, but its drop and dragend stop
// inside the panel, so a ring lit for it was never cleared until a refresh.
//
// useDragDrop keeps its drag state in useState; the mock below makes that
// state persist across renders, as taskMutations.pinning.test.js does.

const stateCells = [];
const refCells = [];
let cursor = { state: 0, ref: 0 };
vi.mock('react', () => ({
  useEffect: () => {},
  useState: (init) => {
    const i = cursor.state++;
    if (!(i in stateCells)) stateCells[i] = typeof init === 'function' ? init() : init;
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v; }];
  },
  useRef: (init) => {
    const i = cursor.ref++;
    if (!(i in refCells)) refCells[i] = { current: init };
    return refCells[i];
  },
}));

const { default: useDragDrop } = await import('./useDragDrop.js');

const useRender = () => {
  cursor = { state: 0, ref: 0 };
  return useDragDrop({ setExpandedNotesTaskId: () => {}, calendarRef: { current: null } });
};
const dragEvent = () => ({ preventDefault: vi.fn(), dataTransfer: {} });

beforeEach(() => { stateCells.length = 0; refCells.length = 0; });

describe('drop-zone highlight', () => {
  it('a drag that is not a task drag (a subtask being reordered) lights neither zone', () => {
    let dd = useRender();
    dd.handleDragOverInbox(dragEvent());
    dd = useRender();
    expect(dd.dragOverInbox).toBe(false);

    dd.handleDragOverRecycleBin(dragEvent());
    dd = useRender();
    expect(dd.dragOverRecycleBin).toBe(false);
  });

  it('still accepts the drag over the Inbox, so the browser does not take the drop', () => {
    const e = dragEvent();
    useRender().handleDragOverInbox(e);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('a task drag lights the zone it is over, and dragend clears it', () => {
    let dd = useRender();
    dd.handleDragStart({ id: 't1', title: 'Scheduled one' }, 'calendar', { dataTransfer: {} });
    dd = useRender();
    dd.handleDragOverInbox(dragEvent());
    dd = useRender();
    expect(dd.dragOverInbox).toBe(true);

    dd.handleDragOverRecycleBin(dragEvent());
    dd = useRender();
    expect(dd.dragOverRecycleBin).toBe(true);
    expect(dd.dragOverInbox).toBe(false);

    dd.handleDragEnd();
    dd = useRender();
    expect(dd.dragOverRecycleBin).toBe(false);
  });
});

// #2277: the dragged card's top edge is read as the dropped task's start, so
// the floating card sits on the drop preview block.
describe('drag image', () => {
  const card = { getBoundingClientRect: () => ({ left: 40, top: 200, width: 300, height: 120 }) };
  const dragStart = () => ({ currentTarget: card, target: card, clientX: 100, clientY: 260, dataTransfer: { setDragImage: vi.fn() } });

  it('an Inbox row is held by its top edge, at the point it was grabbed across', () => {
    const e = dragStart();
    const dd = useRender();
    dd.handleDragStart({ id: 't1', title: 'Inbox one', duration: 60 }, 'inbox', e);
    expect(e.dataTransfer.setDragImage).toHaveBeenCalledWith(card, 60, 0);
    expect(e.dataTransfer.effectAllowed).toBe('move');
    // The pointer's time is the start.
    expect(dd.dragStartPoint({ clientX: 100, clientY: 500 })).toEqual({ clientX: 100, clientY: 500 });
  });

  // #2419: a block on the grid stays under the pointer where it was grabbed.
  it('a timeline block is held where it was grabbed, and its top edge is read as the start', () => {
    const e = dragStart();
    let dd = useRender();
    dd.handleDragStart({ id: 't1', title: 'Scheduled one', startTime: '09:00', duration: 60 }, 'calendar', e);
    expect(e.dataTransfer.setDragImage).toHaveBeenCalledWith(card, 60, 60);
    dd = useRender();
    expect(dd.dragStartPoint({ clientX: 100, clientY: 500 })).toEqual({ clientX: 100, clientY: 440 });

    // The offset belongs to that drag alone.
    dd.handleDragEnd();
    expect(useRender().dragStartPoint({ clientX: 100, clientY: 500 })).toEqual({ clientX: 100, clientY: 500 });
  });

  it('an all-day card is held by its top edge, though it is a calendar task', () => {
    const e = dragStart();
    useRender().handleDragStart({ id: 't1', title: 'All day', isAllDay: true }, 'calendar', e);
    expect(e.dataTransfer.setDragImage).toHaveBeenCalledWith(card, 60, 0);
  });
});
