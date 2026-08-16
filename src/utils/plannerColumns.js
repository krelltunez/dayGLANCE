// Column visibility for the per-project PLANNER, extracted pure so hiding the
// SCHEDULED list (the Bucket List secondListHidden pattern, applied per
// project via project.plannerScheduledHidden) has one tested source of truth
// instead of four JSX conditions that can drift.
//
// Mobile shows the two columns as tabs; desktop shows them side by side.
// Hiding SCHEDULED removes its tab and column everywhere, forces the mobile
// view onto Unscheduled, collapses the desktop grid to one column, and the
// planner renders a "Show Scheduled" affordance in its place (the Bucket
// List's show-again button, count included).

export function plannerColumns({ isMobile, activeTab, scheduledHidden }) {
  const effectiveTab = scheduledHidden ? 'unscheduled' : activeTab;
  return {
    effectiveTab,
    showTabs: isMobile && !scheduledHidden,
    showScheduled: !scheduledHidden && (!isMobile || effectiveTab === 'scheduled'),
    showUnscheduled: !isMobile || effectiveTab === 'unscheduled',
    gridColumns: !isMobile && !scheduledHidden ? 2 : 1,
  };
}
