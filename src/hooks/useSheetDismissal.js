import { useCallback, useEffect, useRef, useState } from 'react';
import { createSheetController } from '../utils/sheetDismissal.js';

/**
 * Dismissal for a near-full-height sheet: Escape, browser/Android back
 * (via a pushed history entry), pull-down from the top of the content, a
 * drag on the handle, and a left-edge swipe. The decisions live in
 * utils/sheetDismissal.js; this only connects them to the DOM.
 *
 * @param {{ open: boolean, key: string, onClose: (reason: string) => void, scrollRef: React.RefObject }} args
 * @returns {{ dismiss: () => void, dragOffset: number, dragging: boolean,
 *   handleProps: object, contentProps: object }}
 *   handleProps go on the drag handle/header (mouse and touch, touch-action: none);
 *   contentProps go on the scrolling body (touch only, pull-down from scrollTop 0).
 */
export default function useSheetDismissal({ open, key, onClose, scrollRef }) {
  const ctlRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const ctl = createSheetController({
      key,
      onClose: (reason) => onCloseRef.current?.(reason),
      win: {
        history: window.history,
        addEventListener: (type, fn) => window.addEventListener(type, fn),
        removeEventListener: (type, fn) => window.removeEventListener(type, fn),
        // A card's notes panel owns Escape while it is open (see SchedTaskCard).
        hasInnerOverlay: () => !!document.querySelector('.sched-notes-panel'),
      },
    });
    ctl.open();
    ctlRef.current = ctl;
    return () => { ctl.dispose(); ctlRef.current = null; };
  }, [open, key]);

  const dismiss = useCallback(() => ctlRef.current?.dismiss('button'), []);

  const start = useCallback((x, y, fromContent) => {
    const scrollTop = fromContent ? (scrollRef?.current?.scrollTop || 0) : 0;
    ctlRef.current?.onDragStart({ x, y, t: performance.now(), scrollTop });
    setDragging(true);
  }, [scrollRef]);
  const move = useCallback((x, y) => {
    const offset = ctlRef.current?.onDragMove({ x, y, t: performance.now() }) || 0;
    setDragOffset(offset);
  }, []);
  const end = useCallback(() => {
    const dismissed = ctlRef.current?.onDragEnd();
    setDragging(false);
    if (!dismissed) setDragOffset(0);
  }, []);

  // Handle: pointer events so a mouse drag works too; touch-action none so
  // the browser never turns the gesture into a scroll. The pointer is only
  // captured once it has moved: capturing on pointerdown retargets the
  // click to the handle row, which would make the close button dead.
  const handleProps = {
    style: { touchAction: 'none' },
    onPointerDown: (e) => { start(e.clientX, e.clientY, false); },
    onPointerMove: (e) => {
      if (!ctlRef.current?.isDragging()) return;
      if (!e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.setPointerCapture?.(e.pointerId);
      move(e.clientX, e.clientY);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
  // Content: touch only, passive, so scrolling stays native; the pull-down
  // only translates the sheet once the content is at its top.
  const contentProps = {
    onTouchStart: (e) => { const t = e.touches[0]; start(t.clientX, t.clientY, true); },
    onTouchMove: (e) => { const t = e.touches[0]; move(t.clientX, t.clientY); },
    onTouchEnd: end,
    onTouchCancel: end,
  };

  return { dismiss, dragOffset, dragging, handleProps, contentProps };
}
