// OWN-WRITE ACK REGISTRY — the identity half of own-echo SSE damping
// (#1455, second instance: the reconcile war of 2026-08-30).
//
// The vault emits one SSE nudge per content write, carrying THE WRITING
// OPERATION'S OWN resulting seq (`emit(accountId, {seq: result.maxSeq})` in
// glance-vault routes/sync.ts — verified, not assumed). Seqs are unique and
// monotonic per account, so "is this nudge the echo of a write THIS device
// made?" is answerable by EXACT IDENTITY: record every maxSeq our writers
// get acked; a nudge whose seq is in the set is provably our own echo and
// nothing else. This is deliberately NOT a comparison heuristic
// (`seq <= lastAck` would swallow a peer write that landed between our pull
// and our push — the freshness trap #1450 avoided by choosing dedup over
// suppression). A peer's nudge carries the PEER's acked seq, which is never
// in this set, so it always drains.
//
// Scope: one registry per running app (module state), fed by every writer
// in this realm — the DB engine's push, the bridge outbox flush and config
// publish, and the db-intents batch. The Obsidian plugin is a different
// process with different purposes: its writes are peer writes here, and we
// WANT their nudges (that's how observations arrive).
//
// Bounded: only recent acks matter (an echo arrives within seconds), so a
// small ring forgets old seqs long after their nudges could still be in
// flight.

const CAPACITY = 64;
const ring = [];
const set = new Set();

/** Record a write ack's maxSeq as ours. Ignores non-numbers. */
export function recordOwnWriteSeq(seq) {
  if (typeof seq !== 'number' || !Number.isFinite(seq) || seq <= 0) return;
  if (set.has(seq)) return;
  ring.push(seq);
  set.add(seq);
  while (ring.length > CAPACITY) set.delete(ring.shift());
}

/** True when `seq` is the ack of a write this device made. */
export function isOwnWriteSeq(seq) {
  return set.has(seq);
}

/** Test seam. */
export function __resetOwnWritesForTests() {
  ring.length = 0;
  set.clear();
}
