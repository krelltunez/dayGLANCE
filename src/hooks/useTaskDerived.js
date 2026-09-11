import { getOccurrencesInRange } from '../utils/recurrenceEngine.js';
import { assignLanes } from '../utils/intervalLanes.js';
import useTaskMeasurement from './useTaskMeasurement.js';

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

// Pack a day's tasks into side-by-side columns. Sorting decides who gets the
// lower column on a start-time tie; the packing itself (overlap clusters,
// first-fit columns, per-cluster column counts) is the shared interval packer
// that the Day Dial and the month view use too, so every surface agrees on
// which tasks share a column.
const packTaskColumns = (tasks, compare) => assignLanes(
  tasks
    .map((task) => {
      const startMin = timeToMinutes(task.startTime);
      return { task, startMin, endMin: startMin + task.duration };
    })
    .sort(compare),
);

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

  const wouldExceedMaxColumns = (droppedTask, startTime, dropDateStr, maxColumns = 3) => {
    // Get existing tasks for this date, excluding the dropped task if it's already scheduled
    // Also exclude imported events (not task calendar) from conflict calculations
    const existingRegular = tasks.filter(t => t.date === dropDateStr && t.id !== droppedTask.id && !t.isAllDay && (!t.imported || t.isTaskCalendar));
    // Include recurring task instances for this date
    const recurringForDate = [];
    for (const template of recurringTasks) {
      if (template.isAllDay) continue;
      const occs = getOccurrencesInRange(template, dropDateStr, dropDateStr);
      for (const ds of occs) {
        const rid = `recurring-${template.id}-${ds}`;
        if (rid === droppedTask.id) continue;
        const exception = template.exceptions?.[ds];
        recurringForDate.push({
          id: rid,
          startTime: exception?.startTime ?? template.startTime,
          duration: exception?.duration ?? template.duration,
          isAllDay: false,
        });
      }
    }
    const existingTasks = [...existingRegular, ...recurringForDate];

    // Create a hypothetical task with the new position
    const hypotheticalTask = { ...droppedTask, startTime, date: dropDateStr };
    const allTasks = [...existingTasks, hypotheticalTask];

    // Longer tasks claim the lower column on a start-time tie.
    const packed = packTaskColumns(allTasks, (a, b) => {
      if (a.startMin !== b.startMin) return a.startMin - b.startMin;
      if (a.task.duration !== b.task.duration) return b.task.duration - a.task.duration;
      return String(a.task.id).localeCompare(String(b.task.id));
    });
    const placed = packed.find(p => p.task === hypotheticalTask);
    return !!placed && placed.laneCount > maxColumns;
  };

  return {
    taskWidths,
    setTaskRef,
    getConflictingTasks,
    calculateConflictPosition,
    wouldExceedMaxColumns,
  };
}
