import { useState, useRef, useEffect } from 'react';

export default function useTaskMeasurement({ tasks, visibleDays, mobileActiveTab }) {
  const [taskWidths, setTaskWidths] = useState({});
  const taskElementRefs = useRef({});

  // Measure task widths using ResizeObserver
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      // Compare against live state inside the updater rather than a captured
      // `taskWidths` — the observer outlives the render it was created in, so a
      // closed-over copy would be stale. Returning `prev` unchanged when nothing
      // differs avoids a needless re-render.
      setTaskWidths(prev => {
        let next = prev;
        for (const entry of entries) {
          const taskId = entry.target.dataset.taskId;
          if (taskId) {
            const width = entry.contentRect.width;
            if (prev[taskId] !== width) {
              if (next === prev) next = { ...prev };
              next[taskId] = width;
            }
          }
        }
        return next;
      });
    });

    // Observe all registered task elements
    Object.values(taskElementRefs.current).forEach(el => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [tasks, visibleDays, mobileActiveTab]); // Re-setup when tasks, visible days, or mobile tab change

  // Ref callback for task elements
  const setTaskRef = (taskId) => (element) => {
    if (element) {
      taskElementRefs.current[taskId] = element;
      // Measure after layout settles (calc-based widths need a frame to resolve)
      requestAnimationFrame(() => {
        if (!element.isConnected) return;
        const width = element.offsetWidth;
        if (width > 0 && taskWidths[taskId] !== width) {
          setTaskWidths(prev => ({ ...prev, [taskId]: width }));
        }
      });
    } else {
      delete taskElementRefs.current[taskId];
    }
  };

  return { taskWidths, setTaskRef };
}
