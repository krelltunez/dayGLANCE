// @glance-apps/dayglance-mcp/model — the read side's data half, safe in any
// JavaScript runtime (a browser renderer included): the read model the tools
// answer from, and the state it answers over. No MCP SDK, no zod, no HTTP.
// The app's renderer imports this entry; a host imports the package root,
// which re-exports it beside the tool registration.
export * from './readState.js';
export * from './readModel.js';
export * from './frames.js';
export * from './repeat.js';
export * from './wireStamp.js';
export * from './noteDescriptions.js';
