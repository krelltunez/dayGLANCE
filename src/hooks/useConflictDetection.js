import { useState, useEffect } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { getOccurrencesInRange } from '../utils/recurrenceEngine.js';

const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

export default function useConflictDetection({ tasks, recurringTasks, selectedDate, dataLoaded }) {
  const [conflicts, setConflicts] = useState([]);

  const checkConflicts = () => {
    const dateStr = dateToString(selectedDate);
    // Exclude all-day tasks and imported events (not task calendar) from conflict detection
    // Include recurring task instances for this date
    const recurringForDate = [];
    for (const template of recurringTasks) {
      if (template.isAllDay) continue;
      const occs = getOccurrencesInRange(template, dateStr, dateStr);
      for (const ds of occs) {
        const exception = template.exceptions?.[ds];
        if (exception?.deleted) continue;
        recurringForDate.push({
          id: `recurring-${template.id}-${ds}`,
          startTime: exception?.startTime ?? template.startTime,
          duration: exception?.duration ?? template.duration,
          isAllDay: false,
        });
      }
    }
    const todayTasks = [...tasks.filter(t => t.date === dateStr && !t.isAllDay && (!t.imported || t.isTaskCalendar)), ...recurringForDate];
    const newConflicts = [];

    for (let i = 0; i < todayTasks.length; i++) {
      for (let j = i + 1; j < todayTasks.length; j++) {
        const task1 = todayTasks[i];
        const task2 = todayTasks[j];
        const start1 = timeToMinutes(task1.startTime);
        const end1 = start1 + task1.duration;
        const start2 = timeToMinutes(task2.startTime);
        const end2 = start2 + task2.duration;

        if ((start1 < end2 && end1 > start2)) {
          if (!newConflicts.find(c => c.includes(task1.id) && c.includes(task2.id))) {
            newConflicts.push([task1.id, task2.id, Math.min(start1, start2)]);
          }
        }
      }
    }
    setConflicts(newConflicts);
  };

  // Re-check conflicts when date or tasks change
  useEffect(() => {
    if (dataLoaded) checkConflicts();
  }, [selectedDate, tasks, dataLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return { conflicts, checkConflicts };
}
