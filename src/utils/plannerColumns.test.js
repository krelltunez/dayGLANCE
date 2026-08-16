import { describe, it, expect } from 'vitest';
import { plannerColumns } from './plannerColumns.js';

// The contract (Bucket List secondListHidden behavior, per project): hiding
// SCHEDULED removes its tab and column on every layout, forces the mobile
// view onto Unscheduled, and collapses the desktop grid to one column;
// showing it restores the exact pre-feature layout.

describe('plannerColumns', () => {
  it('desktop, not hidden: both columns side by side, no tabs', () => {
    expect(plannerColumns({ isMobile: false, activeTab: 'scheduled', scheduledHidden: false })).toEqual({
      effectiveTab: 'scheduled', showTabs: false, showScheduled: true, showUnscheduled: true, gridColumns: 2,
    });
  });

  it('desktop, hidden: only Unscheduled, single column', () => {
    expect(plannerColumns({ isMobile: false, activeTab: 'scheduled', scheduledHidden: true })).toEqual({
      effectiveTab: 'unscheduled', showTabs: false, showScheduled: false, showUnscheduled: true, gridColumns: 1,
    });
  });

  it('mobile, not hidden: tabs shown, the active tab decides the visible column', () => {
    expect(plannerColumns({ isMobile: true, activeTab: 'scheduled', scheduledHidden: false })).toEqual({
      effectiveTab: 'scheduled', showTabs: true, showScheduled: true, showUnscheduled: false, gridColumns: 1,
    });
    expect(plannerColumns({ isMobile: true, activeTab: 'unscheduled', scheduledHidden: false })).toEqual({
      effectiveTab: 'unscheduled', showTabs: true, showScheduled: false, showUnscheduled: true, gridColumns: 1,
    });
  });

  it('mobile, hidden: no tabs, forced onto Unscheduled even if Scheduled was the active tab', () => {
    // THE POINT of effectiveTab: hiding while the Scheduled tab is active must
    // not leave the planner showing a hidden list (or nothing at all).
    expect(plannerColumns({ isMobile: true, activeTab: 'scheduled', scheduledHidden: true })).toEqual({
      effectiveTab: 'unscheduled', showTabs: false, showScheduled: false, showUnscheduled: true, gridColumns: 1,
    });
  });
});
