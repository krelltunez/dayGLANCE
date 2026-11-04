// @glance-apps/dayglance-mcp — dayGLANCE's MCP read surface, shared by the
// desktop app's server and a GLANCEvault-client host the user runs (#2280):
//
//   - the read tools and resources, registered onto an McpServer the host
//     builds (readTools.js, resources.js, inboxFilter.js). They talk only to
//     a HostBridge (@glance-apps/mcp-host); the host decides what answers it.
//   - the read model the bridge answers from (readModel.js and its helpers),
//     and buildMcpReadState, which assembles its state for one user, clock
//     and time zone (readState.js). Also exported alone as ./model, for a
//     browser bundle.
//
// The write tools stay in the desktop app for now.
export * from './model.js';
export * from './inboxFilter.js';
export * from './readTools.js';
export * from './resources.js';
