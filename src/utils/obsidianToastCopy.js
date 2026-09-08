// The Obsidian sync toast's copy choice, kept pure so the posture branch is
// testable without rendering: a paired device whose heartbeat is stale is
// HOLDING (utils/obsidianVaultPosture.js) — it never touches its vault, the
// cycle reads the stream and queues intents — and the toast must say so
// rather than claim a vault sync the settings line says is waiting.
//
// @param {'syncing'|'success'} phase
// @param {string|undefined} vaultPosture  bridgeHeartbeatRef.current.vaultPosture
// @returns {string} the i18n key under sync.obsidianToast
export function obsidianToastKey(phase, vaultPosture) {
  const holding = vaultPosture === 'holding';
  if (phase === 'syncing') return holding ? 'sync.obsidianToast.syncingBridge' : 'sync.obsidianToast.syncing';
  return holding ? 'sync.obsidianToast.syncedBridge' : 'sync.obsidianToast.synced';
}
