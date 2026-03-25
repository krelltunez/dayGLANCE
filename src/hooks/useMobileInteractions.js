import { useEffect, useRef } from 'react';

export default function useMobileInteractions({ isMobile, performUndo, performRedo }) {
  const longPressTriggeredRef = useRef(false); // Track if long press just triggered to prevent click
  const longPressTimerRef = useRef(null);

  // Mobile multi-finger long-press gestures: 2-finger hold = undo, 3-finger hold = redo
  useEffect(() => {
    if (!isMobile) return;
    let holdTimer = null;
    let startPositions = [];
    let fired = false;

    const cancel = () => {
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    };

    const onTouchStart = (e) => {
      const count = e.touches.length;
      if (count < 2) { cancel(); return; }
      startPositions = Array.from(e.touches).map(t => ({ x: t.clientX, y: t.clientY }));
      fired = false;
      cancel();
      holdTimer = setTimeout(() => {
        fired = true;
        if (count === 2) performUndo();
        else if (count >= 3) performRedo();
      }, 300);
    };

    const onTouchMove = (e) => {
      if (!holdTimer) return;
      const moved = Array.from(e.touches).some((t, i) => {
        const start = startPositions[i];
        if (!start) return false;
        return Math.abs(t.clientX - start.x) > 20 || Math.abs(t.clientY - start.y) > 20;
      });
      if (moved) cancel();
    };

    const onTouchEnd = () => { cancel(); };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      cancel();
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile]);

  return { longPressTriggeredRef, longPressTimerRef };
}
