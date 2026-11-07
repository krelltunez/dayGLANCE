// The frame instances the weekly review counts (next week's capacity, last
// week's utilization): every recurring frame's instance on each date, through
// agenda-core's frameInstancesForDate, so the review agrees with the timeline
// about which frames a date holds. It used to apply the frame rule inline and
// so could not see frame sets (#2305): a set switched off would still have
// counted its frames. One-off frames (singleDate) are left out, as before.

import { frameInstancesForDate } from '@glance-apps/agenda-core';

/**
 * Instances on `dates`, grouped by frame id (Map frameId → instances, in date
 * order). `frameSets` is every set.
 */
export function weeklyFrameInstances(frames, dates, frameSets) {
  const recurring = (Array.isArray(frames) ? frames : []).filter((f) => f && !f.singleDate);
  const byFrame = new Map();
  for (const dateStr of dates || []) {
    for (const instance of frameInstancesForDate(recurring, dateStr, { frameSets })) {
      if (!byFrame.has(instance.frameId)) byFrame.set(instance.frameId, []);
      byFrame.get(instance.frameId).push(instance);
    }
  }
  return byFrame;
}
