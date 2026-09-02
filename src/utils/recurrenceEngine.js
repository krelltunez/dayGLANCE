// Re-export shim: the recurrence engine now lives in @glance-apps/agenda-core
// (packages/agenda-core/src/recurrence.js), shared verbatim with the
// dayglance-bridge Obsidian plugin's agenda view. Every existing importer
// keeps this path; the code moved, the API did not.
export * from '@glance-apps/agenda-core';
