// The compact phone comparison owns an inner scroll surface. Reuse the native
// refocus action without measuring the enclosing task-list/notes page as hours.
export function timelineScrollTarget(calendar, grid) {
  const compact = calendar?.querySelector?.('[data-mobile-timeline]');
  const axisHeight = compact?.querySelector?.('[data-mobile-axis]')?.offsetHeight;
  if (compact && Number.isFinite(axisHeight) && axisHeight > 0) {
    return { viewport: compact, hourHeight: axisHeight / 24, ownsInitialScroll: true };
  }
  return { viewport: calendar, hourHeight: grid?.children?.[1]?.offsetHeight || 161, ownsInitialScroll: false };
}
