// Re-export shim: the Bucket List rules live in @glance-apps/agenda-core
// (packages/agenda-core/src/bucketList.js), shared with the MCP read surface
// (@glance-apps/dayglance-mcp). This path keeps its many importers unchanged.
export { BUCKET_LIST_IDS, DEFAULT_BUCKET_CONFIG, isBucketTask, notBucketed, demoteToBucket, promoteToInbox, stripBucketId, normalizeBucketConfig } from '@glance-apps/agenda-core';
