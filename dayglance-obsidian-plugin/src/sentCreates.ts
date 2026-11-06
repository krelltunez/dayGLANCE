// TASKS WAITING FOR dayGLANCE (companion spec 4.2.1, "the waiting
// indicator"): the creates this copy sent that no app has picked up yet.
//
// A create is a row on the bridge stream until a dayGLANCE device applies
// it and deletes the row; until then the task exists nowhere the user can
// see. The capability check (appCapabilities.ts) stops a send no app can
// read, but an app that can read it still has to RUN: a phone left closed,
// a desktop asleep. So this copy remembers what it sent (actionId, title,
// sentAt) in its device-local store, never data.json, and on the plugin's
// tick asks the vault whether each row is still there. A row that is gone
// was consumed (applied, or dropped by the app's own rules), and the entry
// goes with it. An entry still there an hour after it was sent is counted,
// and the agenda view says "1 task waiting for dayGLANCE" with a hint to
// open or update dayGLANCE on one of the user's devices.
//
// THE WORK IS BOUNDED: at most CHECKS_PER_TICK row reads per tick, the
// longest-unchecked first, and an entry is due again only after an interval
// that grows with its age (minutes while it is young, hours once it is days
// old). An entry older than the app's own cutoff (60 days, after which the
// app consumes a create without applying it) is dropped unread, and the
// list is capped. The list is per pairing: another account or a re-pair
// starts it empty, since a row sealed under the old pairing can no longer
// be read by any app.

import type { DeviceLocalStore } from './localState';

export interface SentCreate {
  actionId: string;
  title: string;
  /** Epoch ms when the row was written. */
  sentAt: number;
  /** Epoch ms of the last row check that found it still there (sentAt until one has). */
  checkedAt: number;
}

export interface SentCreatesState {
  /** `${accountId}|${generation}` (appCapabilities.ts pairingKeyOf). */
  pairingKey: string;
  entries: SentCreate[];
}

export const SENT_CREATES_KEY = 'dayglance-bridge-sent-creates';
/** An entry still on the stream this long after it was sent is shown as waiting. */
export const WAITING_AFTER_MS = 60 * 60_000;
/** The app consumes a create older than this without applying it (its tombstone window). */
export const SENT_CREATE_MAX_AGE_MS = 60 * 86_400_000;
export const CHECKS_PER_TICK = 3;
export const SENT_CREATES_CAP = 200;

const DAY_MS = 86_400_000;

/** How long after a check an entry of this age is due again: the backoff. */
export function checkIntervalMs(ageMs: number): number {
  if (ageMs < DAY_MS) return 5 * 60_000;
  if (ageMs < 7 * DAY_MS) return 60 * 60_000;
  return 6 * 60 * 60_000;
}

/** The list with `entry` added (once per actionId), the oldest beyond the cap dropped. */
export function addSentCreate(entries: SentCreate[], entry: SentCreate): SentCreate[] {
  const rest = entries.filter((e) => e.actionId !== entry.actionId);
  const next = [...rest, entry].sort((a, b) => a.sentAt - b.sentAt);
  return next.length > SENT_CREATES_CAP ? next.slice(next.length - SENT_CREATES_CAP) : next;
}

/** The list without entries past the app's cutoff (or with a sent time in the future of nonsense). */
export function pruneSentCreates(entries: SentCreate[], nowMs: number): SentCreate[] {
  return entries.filter((e) => Number.isFinite(e.sentAt) && nowMs - e.sentAt <= SENT_CREATE_MAX_AGE_MS);
}

/** The entries due a row check now, longest-unchecked first, at most `limit`. */
export function dueForCheck(entries: SentCreate[], nowMs: number, limit = CHECKS_PER_TICK): SentCreate[] {
  return entries
    .filter((e) => nowMs - (e.checkedAt || e.sentAt) >= checkIntervalMs(nowMs - e.sentAt))
    .sort((a, b) => (a.checkedAt || a.sentAt) - (b.checkedAt || b.sentAt))
    .slice(0, Math.max(0, limit));
}

/** How many entries have been waiting longer than WAITING_AFTER_MS. */
export function waitingCount(entries: SentCreate[], nowMs: number): number {
  return entries.filter((e) => nowMs - e.sentAt >= WAITING_AFTER_MS).length;
}

/** The view's line for `n` waiting tasks, or null for none. */
export function waitingLine(n: number): string | null {
  if (!(n > 0)) return null;
  return `${n} task${n === 1 ? '' : 's'} waiting for dayGLANCE. Open or update dayGLANCE on one of your devices to bring ${n === 1 ? 'it' : 'them'} in.`;
}

/** What a row read says about a sent create. Throwing means "could not tell". */
export type CreateRowState = 'present' | 'gone';

export class SentCreates {
  private state: SentCreatesState | null = null;
  private loaded = false;

  constructor(private readonly store: DeviceLocalStore<SentCreatesState>) {}

  private forKey(pairingKey: string): SentCreatesState {
    if (!this.loaded) {
      this.loaded = true;
      const stored = this.store.load();
      if (stored && typeof stored.pairingKey === 'string' && Array.isArray(stored.entries)) this.state = stored;
    }
    if (!this.state || this.state.pairingKey !== pairingKey) this.state = { pairingKey, entries: [] };
    return this.state;
  }

  private save(state: SentCreatesState): void {
    this.state = state;
    this.store.save(state);
  }

  /** Remember a create this copy just sent. */
  record(pairingKey: string, entry: { actionId: string; title: string; sentAt: number }): void {
    const cur = this.forKey(pairingKey);
    this.save({ pairingKey, entries: addSentCreate(cur.entries, { ...entry, checkedAt: entry.sentAt }) });
  }

  entries(pairingKey: string): SentCreate[] {
    return [...this.forKey(pairingKey).entries];
  }

  waiting(pairingKey: string, nowMs: number): number {
    return waitingCount(pruneSentCreates(this.forKey(pairingKey).entries, nowMs), nowMs);
  }

  /**
   * One tick's checks: prune, then read the rows of the entries due (at most
   * `limit`). A gone row drops its entry; a present one is due again later.
   * The first read that throws ends the tick (offline, braked): the rest
   * wait for the next. Resolves to whether the list changed.
   */
  async checkSome(pairingKey: string, rowState: (actionId: string) => Promise<CreateRowState>, nowMs: number, limit = CHECKS_PER_TICK): Promise<boolean> {
    const cur = this.forKey(pairingKey);
    let entries = pruneSentCreates(cur.entries, nowMs);
    let changed = entries.length !== cur.entries.length;
    for (const due of dueForCheck(entries, nowMs, limit)) {
      let state: CreateRowState;
      try { state = await rowState(due.actionId); } catch { break; }
      entries = state === 'gone'
        ? entries.filter((e) => e.actionId !== due.actionId)
        : entries.map((e) => (e.actionId === due.actionId ? { ...e, checkedAt: nowMs } : e));
      changed = true;
    }
    if (changed && this.state?.pairingKey === pairingKey) this.save({ pairingKey, entries });
    return changed;
  }
}
