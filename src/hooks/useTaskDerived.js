import { packTaskColumns, wouldExceedMaxColumns as exceedsMaxColumns } from '../utils/maxColumns.js';
import useTaskMeasurement from './useTaskMeasurement.js';

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export default function useTaskDerived({ tasks, recurringTasks, visibleDays, mobileActiveTab }) {
  const { taskWidths, setTaskRef } = useTaskMeasurement({ tasks, visibleDays, mobileActiveTab });

  const getConflictingTasks = (task, allTasks) => {
    const start = timeToMinutes(task.startTime);
    const end = start + task.duration;

    return allTasks.filter(t => {
      if (t.id === task.id) return false;
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      return start < tEnd && end > tStart;
    });
  };

  const calculateConflictPosition = (task, allTasks) => {
    // Imported events (not task calendar) are excluded from layout logic - always full width
    if (task.imported && !task.isTaskCalendar) return { left: 2, right: 2, width: null, totalColumns: 1 };

    // Filter out imported events from conflict calculations
    const nonImportedTasks = allTasks.filter(t => !t.imported || t.isTaskCalendar);

    // Sort by start time, then by id for stable column assignment during resize
    const packed = packTaskColumns(nonImportedTasks, (a, b) => {
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
      return String(a.task.id).localeCompare(String(b.task.id));
    });
    const placed = packed.find(p => p.task.id === task.id);
    if (!placed || placed.laneCount <= 1) return { left: 2, right: 2, width: null, totalColumns: 1 };

    const totalColumns = placed.laneCount;
    const column = placed.lane;

    const widthPercent = 100 / totalColumns;
    const leftPercent = widthPercent * column;

    const margin = '0.125rem';
    const totalMargin = '0.25rem';

    return {
      left: `calc(${leftPercent}% + ${margin})`,
      right: 'auto',
      width: `calc(${widthPercent}% - ${totalMargin})`,
      totalColumns
    };
  };

  // The column limit on a drop (utils/maxColumns.js), counting the previous
  // night's tasks still running after midnight as the timelines lay them out.
  const wouldExceedMaxColumns = (droppedTask, startTime, dropDateStr, maxColumns = 3) => exceedsMaxColumns({
    tasks, recurringTasks, droppedTask, startTime, dropDateStr, maxColumns,
  });

  return {
    taskWidths,
    setTaskRef,
    getConflictingTasks,
    calculateConflictPosition,
    wouldExceedMaxColumns,
  };
}
