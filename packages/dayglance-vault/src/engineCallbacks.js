// The data callbacks @glance-apps/sync's createDbSyncEngine calls, bound to a
// dayGLANCE data object through the adapter. The app's engine wiring
// (src/sync/dbEngine.js) builds its callbacks from these, wrapping the apply
// and the delete in its own guards and bookkeeping; a host passes them as
// they are. Either way a pulled row reaches the data the same way.

import {
  getLocalEntity,
  applyRemoteEntity,
  applyRemoteDelete,
  isInsertOnly,
  getEntityLastModified,
} from './adapter.js';

/**
 * @param {() => object} getData  the data object the callbacks read and merge
 *   into (the payload's `.data` shape). Called on every callback, so a caller
 *   that swaps the object per cycle (the app's mirror) is always current.
 * @param {(entityId: string) => void} markDirty  receives each row a merge
 *   left richer than the pulled copy, to be pushed back so the vault converges
 *   (the engine's own markDirty).
 */
export function vaultEngineCallbacks(getData, markDirty) {
  return {
    getLocalEntity: (entityId) => getLocalEntity(getData(), entityId),
    applyRemoteEntity: (entityId, entity) => {
      // Bundle merges may leave us richer than the clobbered vault row; re-push
      // the superset so it converges at the vault (see the adapter).
      for (const id of applyRemoteEntity(getData(), entity)) markDirty(id);
    },
    applyRemoteDelete: (entityId) => applyRemoteDelete(getData(), entityId),
    isInsertOnly,
    getEntityLastModified,
  };
}
