// Multi-user scoping, the two predicates every surface filters with. Shared
// by App.jsx, the headless refresh root (src/headless/), whose launcher
// snapshot must show exactly what the app's would, and the MCP read state
// (@glance-apps/dayglance-mcp buildMcpReadState), which must scope exactly as
// the app does.

/**
 * Tasks, goals and projects broadcast to everyone unless assigned: visible
 * when multi-user is off, when no user is selected, when the item names no
 * one, or when it names the current user.
 */
export const isTaskVisibleForUser = (task, multiUserEnabled, meUserSyncId) => {
  if (!multiUserEnabled || !meUserSyncId) return true;
  const assigned = task.assignedUserSyncIds ?? [];
  return assigned.length === 0 || assigned.includes(meUserSyncId);
};

/**
 * Habits, routines and frames have one owner. An unowned item shows to
 * whoever is viewing, matching the tasks' empty-assignment default; `syncId`
 * names the member being viewed, defaulting to the current user.
 */
export const isOwnedBy = (item, multiUserEnabled, meUserSyncId, syncId) => {
  if (!multiUserEnabled) return true;
  const target = syncId || meUserSyncId;
  if (!target) return true;
  return !item.ownerSyncId || item.ownerSyncId === target;
};
