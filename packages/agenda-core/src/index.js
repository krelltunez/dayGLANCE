// @glance-apps/agenda-core — the dayGLANCE agenda core, shared verbatim by
// the dayGLANCE app and the dayglance-bridge Obsidian plugin (companion spec
// 4.2: the sidebar view renders the SAME agenda the app does, from the same
// expansion code, so the two can never disagree about what today holds).
//
// Pure: no app state, no storage, no DOM. Calendar math and agenda shaping
// only — ownership policy stays in dayGLANCE.
export * from './recurrence.js';
export * from './agenda.js';
export * from './routines.js';
export * from './title.js';
export * from './calendar.js';
export * from './events.js';
