import { useState, useLayoutEffect } from 'react';

export default function useWeekViewHourHeight(calendarRef, stickyHeaderRef, visibleHours = 24) {
  const [hourHeight, setHourHeight] = useState(33);

  useLayoutEffect(() => {
    const compute = () => {
      if (!calendarRef?.current) return;
      const totalH = calendarRef.current.clientHeight;
      const stickyH = stickyHeaderRef?.current?.offsetHeight || 0;
      const usable = Math.max(240, totalH - stickyH);
      setHourHeight(Math.max(10, usable / visibleHours));
    };

    const rafId = requestAnimationFrame(() => {
      compute();
      const ro = new ResizeObserver(compute);
      if (calendarRef?.current) ro.observe(calendarRef.current);
      if (stickyHeaderRef?.current) ro.observe(stickyHeaderRef.current);
      roRef = ro;
    });

    let roRef = null;
    return () => {
      cancelAnimationFrame(rafId);
      roRef?.disconnect();
    };
  }, [visibleHours]); // refs are stable; visibleHours changes when truncation toggles

  return hourHeight;
}
