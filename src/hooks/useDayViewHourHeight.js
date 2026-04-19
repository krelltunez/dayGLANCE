import { useState, useEffect } from 'react';

export default function useDayViewHourHeight(calendarRef, stickyHeaderRef) {
  const [hourHeight, setHourHeight] = useState(80);

  useEffect(() => {
    const compute = () => {
      if (!calendarRef?.current) return;
      const totalH = calendarRef.current.clientHeight;
      const stickyH = stickyHeaderRef?.current?.offsetHeight || 0;
      const usable = Math.max(160, totalH - stickyH);
      setHourHeight(Math.max(20, Math.floor(usable / 8)));
    };

    compute();
    const ro = new ResizeObserver(compute);
    if (calendarRef?.current) ro.observe(calendarRef.current);
    if (stickyHeaderRef?.current) ro.observe(stickyHeaderRef.current);
    return () => ro.disconnect();
  }, []); // refs are stable objects — no deps needed

  return hourHeight;
}
