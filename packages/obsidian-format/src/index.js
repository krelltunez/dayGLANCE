// @glance-apps/obsidian-format — the dayGLANCE ⇄ Obsidian vault line-format
// core, shared verbatim by the dayGLANCE app and the dayglance-bridge plugin.
//
// ★ THE PACKAGE IS FORMAT, NEVER POLICY. It should not know an ownership
// rule exists. Transports, sync, merge, and every what-wins-on-divergence
// decision live in dayGLANCE (spec §3.10); this package only defines what a
// vault line IS: its identity, its decorations, how it is built, rewritten,
// sorted, named, and parsed. Two consumers, one grammar — a lookalike parser
// maintained separately is how identity divergence starts, and this package
// exists so that can't happen.

export * from './identity.js';
export * from './completionMarkers.js';
export * from './tasksMetadata.js';
export * from './taskLines.js';
export * from './noteNames.js';
export * from './frontmatter.js';
export * from './filename.js';
export * from './heartbeat.js';
export * from './bridgePairing.js';
export * from './bridgeStream.js';
export * from './bridgeSse.js';
