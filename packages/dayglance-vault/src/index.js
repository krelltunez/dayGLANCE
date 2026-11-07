// @glance-apps/dayglance-vault: dayGLANCE's GLANCEvault data adapter. How
// dayGLANCE's synced data maps to vault rows, how a pulled row is merged into
// it, and the per-field merge and retention rules that merge applies, which
// the app's file tier applies too; and the client for the vault's /events
// change nudges. Pure JavaScript: no storage, no React, no browser globals.
// See README.md.
export * from './adapter.js';
export * from './engineCallbacks.js';
export * from './merges.js';
export * from './tombstoneRetention.js';
export * from './tombstoneHorizon.js';
export * from './dayWindowSync.js';
export * from './recurringExceptions.js';
export { mergeDeferrals } from './deferrals.js';
export { TRAIL_CAP, mergePlanTrail, sameTrail } from './planTrail.js';
export { earlierCreatedAt } from './createdAt.js';
export { mergeRetiredTaskIds, pruneRetiredTaskIds } from './retiredTaskIds.js';
export { pickJoboRecord } from './jobo.js';
export {
  openWebSseStream,
  createNudgeCoalescer,
  createKindFilter,
  createVaultEventClient,
  backoffDelayMs,
} from './vaultEvents.js';
export { OWN_ACK_TTL_MS, recordOwnWriteSeq, isOwnWriteSeq, withOwnAckRecording } from './ownWrites.js';
