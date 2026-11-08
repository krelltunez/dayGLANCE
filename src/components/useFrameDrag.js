import { useCallback, useRef, useState } from 'react';

/**
 * Dragging a frame into another set in the Frames list (#2335), as tasks are
 * dragged: picked up by its grip, dropped on a set's section or on "Always".
 * The pattern is goals/useProjectDrag.js's, two input paths into one state:
 *
 *   - Mouse: HTML5 drag events. The grip is `draggable`; each section takes
 *     onDragOver/onDrop.
 *   - Touch (the phone's Frames page, and the desktop modal on an iPad): iOS
 *     WebKit never fires HTML5 drag events for touch, so the gesture is
 *     tracked with document listeners and the section under the finger is
 *     found with elementFromPoint. React's touchmove is passive, so the
 *     listener is added { passive: false } to stop the page scrolling under
 *     the drag, and dragstart is cancelled for the drag's life so the grip's
 *     `draggable` cannot start a native drag that hijacks it.
 *
 * A section names its set in `data-frame-drop-set`: '' for "Always", else the
 * set's id. `onDrop(frameId, setKey)` gets the same.
 */
export default function useFrameDrag({ onDrop }) {
  const [dragFrameId, setDragFrameId] = useState(null);
  // The section under the pointer: undefined for none, '' for "Always".
  const [overSet, setOverSet] = useState(undefined);
  // Read by dragover and drop, which can fire before the state settles.
  const draggingRef = useRef(null);

  const end = useCallback(() => {
    draggingRef.current = null;
    setDragFrameId(null);
    setOverSet(undefined);
  }, []);

  const drop = useCallback((setKey) => {
    const id = draggingRef.current;
    end();
    if (id != null && setKey !== undefined) onDrop(id, setKey);
  }, [end, onDrop]);

  const startTouch = useCallback((frameId) => () => {
    draggingRef.current = String(frameId);
    setDragFrameId(String(frameId));
    let over;
    const onMove = (e) => {
      if (draggingRef.current == null) return;
      e.preventDefault(); // honoured: this listener is non-passive
      const touch = e.touches[0];
      if (!touch) return;
      const target = document.elementFromPoint(touch.clientX, touch.clientY)?.closest('[data-frame-drop-set]');
      over = target ? target.getAttribute('data-frame-drop-set') : undefined;
      setOverSet(over);
    };
    const preventDrag = (e) => e.preventDefault();
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      document.removeEventListener('dragstart', preventDrag);
      // A tap on the grip, with no move, drops nowhere.
      drop(over);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    document.addEventListener('dragstart', preventDrag);
  }, [drop]);

  /** Props for a frame row's grip. */
  const gripProps = useCallback((frameId) => ({
    draggable: true,
    onDragStart: (e) => {
      e.stopPropagation();
      draggingRef.current = String(frameId);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(frameId)); } catch { /* some browsers refuse; the ref carries it */ }
      }
      // Deferred, or the re-render cancels the drag the browser is starting.
      setTimeout(() => setDragFrameId(String(frameId)), 0);
    },
    onDragEnd: end,
    onTouchStart: startTouch(frameId),
    // The row opens the editor on click; the grip is for dragging only.
    onClick: (e) => e.stopPropagation(),
  }), [end, startTouch]);

  /** Props for a section a frame can be dropped on. */
  const dropProps = useCallback((setKey) => ({
    'data-frame-drop-set': setKey,
    onDragOver: (e) => {
      if (draggingRef.current == null) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      setOverSet(setKey);
    },
    onDragLeave: (e) => {
      if (e.currentTarget.contains?.(e.relatedTarget)) return;
      setOverSet((was) => (was === setKey ? undefined : was));
    },
    onDrop: (e) => {
      e.preventDefault();
      drop(setKey);
    },
  }), [drop]);

  return { dragFrameId, overSet, gripProps, dropProps };
}
