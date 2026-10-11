/**
 * The slice-by-slice comparison behind the snapshot-file cycle's content gate
 * and the iCloud diagnostics panel. It moved to `@glance-apps/sync` 2.1.0
 * with the cycle; this module keeps the import path.
 */
export {
  canonicalJson,
  describeSliceDiff,
  sliceDiffs,
  writeWorthy,
  explainSnapshotMerge,
  PER_MERGE_STAMPS,
} from '@glance-apps/sync';
