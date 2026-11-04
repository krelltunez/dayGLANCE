// Re-export shim: the day-occupancy model lives in @glance-apps/agenda-core
// (packages/agenda-core/src/dayOccupancy.js), shared with the MCP read surface
// (@glance-apps/dayglance-mcp), whose frame availability is built on it. This
// path keeps its importers unchanged.
export { timeToMinutes, minutesToTime, routineIntervals, taskInterval, computeOccupiedIntervals, mergeIntervals, computeAvailableSlots, availableMinutes, adjustPastConflicts, obstacleName, describeObstacle, findRoutineConflict } from '@glance-apps/agenda-core';
