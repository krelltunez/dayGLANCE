import { useState, useLayoutEffect } from 'react';

export default function useDayViewHourHeight(calendarRef, stickyHeaderRef) {
  const [hourHeight, setHourHeight] = useState(80);

  // useLayoutEffect runs synchronously after DOM mutations, before paint — ensures
  // stickyHeaderRef.current is already set when we measure. The inline ref callback
  // on DesktopLayout's sticky div briefly nulls the ref on each render, so we also
  // defer one rAF to let React re-set it before the first measurement.
  useLayoutEffect(() => {
    const compute = () => {
      if (!calendarRef?.current) return;
      const totalH = calendarRef.current.clientHeight;
      const stickyH = stickyHeaderRef?.current?.offsetHeight || 0;
      const usable = Math.max(160, totalH - stickyH);
      setHourHeight(Math.max(20, usable / 8));
      // DAY view is overflow:hidden and must never scroll. Any scroll drift
      // (browser restoration, scroll anchoring, stale timers) gets reset here
      // on every measurement, including ResizeObserver callbacks that fire
      // when the tab is restored after prolonged background time.
      calendarRef.current.scrollTop = 0;
    };

    // Defer first measurement by one frame so the sticky header ref is populated.
    const rafId = requestAnimationFrame(() => {
      compute();
      const ro = new ResizeObserver(compute);
      if (calendarRef?.current) ro.observe(calendarRef.current);
      if (stickyHeaderRef?.current) ro.observe(stickyHeaderRef.current);
      // Keep a reference so cleanup can disconnect even after the rAF fires.
      roRef = ro;
    });

    let roRef = null;
    return () => {
      cancelAnimationFrame(rafId);
      roRef?.disconnect();
    };
  }, []); // refs are stable objects — no deps needed

  return hourHeight;
}
