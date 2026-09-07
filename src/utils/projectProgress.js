// Re-export: the progress math lives in @glance-apps/agenda-core (companion
// spec §4.3, ruling C) so the Obsidian plugin renders the same numbers.
export { calculateProjectProgress, getProjectTotalDuration, isProjectStalled, projectProgressPercent } from '@glance-apps/agenda-core';
