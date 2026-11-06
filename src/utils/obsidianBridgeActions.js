// BRIDGE STREAM, app side — inbound ACTIONS (companion spec 4.2, the sidebar
// view's one write).
//
// The plugin's sidebar completes a task by emitting an `act:` row on the
// bridge stream — sealed under the pairing subkey like an observation, but
// carrying an INTENT ("complete this task"), not file state. dayGLANCE is
// the only writer of the account's data plane: it applies the action
// through its own state setters, so everything downstream of a completion
// made in the app (the completion log, the vault writeback, DB sync, undo
// stacks that watch state) fires for a sidebar completion exactly the same
// way. The plugin never touches a data-plane row.
//
// CONSUMPTION RULES:
//  • APPLY when the target exists here: a live task (scheduled or inbox —
//    both lists are checked, a survivor-rule duplicate is completed in both)
//    or a recurring template. An already-completed target is still consumed
//    (idempotent; a replay or a second device racing us is a no-op).
//  • HOLD when the target is unknown: the task may simply not have synced
//    to this device yet. The row stays on the stream and the cursor is not
//    advanced past it, so a later cycle (or another device) applies it.
//  • CONSUME AS STALE after ACTION_STALE_MS with no target on any device
//    that saw it: the task was deleted, or never existed here. Held rows
//    are otherwise bounded by the plugin's own dedupe of one row per action.
//  • Applied and stale rows are DELETED from the stream (the plugin's
//    intent rows get the same treatment from the other side), so the
//    namespace never accumulates.

import { getVaultConfig } from '../sync/vaultConfig.js';
import { hasDbRootKey } from '@glance-apps/sync';
import { verifiedBridgeRootKey } from './bridgeKeyGate.js';
import {
  deriveBridgeSubkey,
  openBridgeEnvelope,
  BRIDGE_VAULT_APP,
  BRIDGE_ACTION_PREFIX,
} from '@glance-apps/obsidian-format';
import { getBridgePairingMeta, bridgeRateLimited, bridgeVaultClientFor } from './obsidianBridgeStream.js';
import { completionTimestamp } from './taskUtils.js';

const ACT_HWM_KEY = 'dayglance-bridge-act-hwm';
export const ACTION_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fetch action rows above the persisted cursor and decrypt them. Returns
 * { actions, maxSeq } (each action carries its entityId and seq for the
 * delete and the cursor math) or null when the stream isn't available
 * (unpaired, no key, braked, unreachable). Never advances the cursor.
 */
export function fetchBridgeActions() {
  return fetchBridgeActionRows({ prefix: BRIDGE_ACTION_PREFIX, cursorKey: ACT_HWM_KEY });
}

/**
 * The fetch behind fetchBridgeActions, for one prefix under one cursor key.
 * The task-create consumer (obsidianBridgeCreates.js) reads its own prefix
 * under its own cursor through this, so neither consumer's cursor can pass a
 * row the other has yet to apply.
 */
export async function fetchBridgeActionRows({ prefix, cursorKey }) {
  try {
    if (bridgeRateLimited()) return null;
    const cfg = getVaultConfig();
    if (!cfg?.enabled || !cfg.vaultUrl || !cfg.vaultToken || !cfg.accountId || !hasDbRootKey()) return null;
    const meta = await getBridgePairingMeta();
    if (!meta) return null;
    const client = bridgeVaultClientFor(cfg);
    const rootKey = await verifiedBridgeRootKey(client, cfg.accountId); // bridgeKeyGate.js
    if (!rootKey) return null;
    const salt = Uint8Array.from(atob(meta.pairingSalt), (c) => c.charCodeAt(0));
    const subkey = await deriveBridgeSubkey(rootKey, salt);

    let since = readCursor(cursorKey);
    const byActionId = new Map();
    let maxSeq = since;
    let hasMore = true;
    while (hasMore) {
      const page = await client.list(BRIDGE_VAULT_APP, { accountId: cfg.accountId, since });
      hasMore = !!page.hasMore;
      for (const row of page.rows || []) {
        const seq = Number(row.seq) || 0;
        if (seq > maxSeq) maxSeq = seq;
        if (seq > since) since = seq;
        const entityId = String(row.entityId || '');
        if (!entityId.startsWith(prefix)) continue;
        if (row.deleted || !row.envelope) { byActionId.delete(entityId); continue; }
        const payload = await openBridgeEnvelope(subkey, row.envelope);
        // Unreadable rows (rotated-away generation, tamper) are skipped —
        // and, having no readable actionId, never held: the cursor moves on.
        if (payload?.kind !== 'action' || typeof payload.actionId !== 'string') continue;
        byActionId.set(entityId, { ...payload, entityId, seq });
      }
      if (!page.rows?.length) break;
    }
    return { actions: [...byActionId.values()], maxSeq };
  } catch {
    return null;
  }
}

function readCursor(key) {
  try { return Number(localStorage.getItem(key)) || 0; } catch { return 0; }
}

/**
 * Advance the cursor after a batch is dispatched. `held` are the actions
 * left on the stream for a later cycle: the cursor stops just below the
 * oldest of them so they are re-listed, never lost behind the cursor.
 */
export function commitBridgeActionCursor(maxSeq, held = [], cursorKey = ACT_HWM_KEY) {
  const floor = held.reduce((m, a) => Math.min(m, Number(a.seq) || 0), Infinity);
  const next = Number.isFinite(floor) ? Math.min(maxSeq, Math.max(0, floor - 1)) : maxSeq;
  try {
    const prev = readCursor(cursorKey);
    if (next > prev) localStorage.setItem(cursorKey, String(next));
  } catch { /* retried next fetch */ }
}

/** Delete consumed action rows. Best-effort: a failure leaves an idempotent replay. */
export async function deleteBridgeActions(actions) {
  if (!actions.length) return;
  try {
    const cfg = getVaultConfig();
    if (!cfg?.vaultUrl || !cfg.vaultToken || !cfg.accountId) return;
    const client = bridgeVaultClientFor(cfg);
    for (const a of actions) {
      try { await client.deleteRow(BRIDGE_VAULT_APP, a.entityId, cfg.accountId); }
      catch { /* replayed next cycle; application is idempotent */ }
    }
  } catch { /* same */ }
}

const has = (list, id) => (list || []).some((t) => t && String(t.id) === String(id));

/**
 * Sort a batch into { apply, hold, stale } against the current lists (pure).
 * Only `task_complete` actions are understood; anything else is consumed as
 * stale so an unknown future type never wedges the cursor.
 */
export function planBridgeActions(actions, { tasks, unscheduledTasks, recurringTasks, nowMs = Date.now(), isTombstoned = null, resolveId = null }) {
  const apply = [], hold = [], stale = [];
  for (const a of actions || []) {
    if (!a || a.type !== 'task_complete') { stale.push(a); continue; }
    // A retired id (an identity move: legacy → block id, or a routing
    // bind) is redirected onto its successor, the way every other consumer
    // of the retirement record resolves one.
    let taskId = a.taskId;
    if (taskId != null && typeof resolveId === 'function') {
      const r = resolveId(String(taskId));
      if (r && String(r) !== String(taskId)) taskId = String(r);
    }
    const targetKnown = a.templateId
      ? has(recurringTasks, a.templateId) && /^\d{4}-\d{2}-\d{2}$/.test(String(a.instanceDate || ''))
      : taskId != null && (has(tasks, taskId) || has(unscheduledTasks, taskId));
    if (targetKnown) { apply.push(taskId !== a.taskId ? { ...a, taskId } : a); continue; }
    // A target this device has TOMBSTONED (deleted here, or inferred deleted
    // from the vault) will never arrive: consumed as stale now rather than
    // held for seven days (2026-09-05 finding: a completion sent from the
    // sidebar for a task dayGLANCE had dropped sat on the stream, re-listed
    // every cycle, for as long as the stale window).
    if (!a.templateId && taskId != null && typeof isTombstoned === 'function' && isTombstoned(String(taskId))) { stale.push(a); continue; }
    const created = Date.parse(a.createdAt || '');
    const age = Number.isFinite(created) ? nowMs - created : Infinity;
    (age > ACTION_STALE_MS ? stale : hold).push(a);
  }
  return { apply, hold, stale };
}

const completedAtOf = (a) => (typeof a.completedAt === 'string' && a.completedAt) || completionTimestamp();
// A per-date stamp keeps the action's own datetime as written (its offset
// names the local date it was done on); anything without a time, or
// unparseable, is normalised to an instant.
const stampOf = (s) => {
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return completionTimestamp();
  return /T\d{2}:\d{2}/.test(s) ? s : new Date(t).toISOString();
};

/**
 * Apply task_complete actions to a task list (scheduled or inbox). Returns
 * the SAME array when nothing changes, so a functional setState with an
 * unchanged result is a no-op render. Mirrors useTaskActions.toggleComplete's
 * completion shape: completed, completedAt (the action's local-offset
 * stamp), a fresh transitionId, and lastModified for LWW.
 */
export function applyActionsToTasks(list, actions) {
  const byId = new Map();
  for (const a of actions || []) if (a?.type === 'task_complete' && a.taskId != null && !a.templateId) byId.set(String(a.taskId), a);
  if (!byId.size || !Array.isArray(list)) return list;
  let changed = false;
  const out = list.map((t) => {
    const a = t && byId.get(String(t.id));
    if (!a || t.completed) return t;
    changed = true;
    return {
      ...t,
      completed: true,
      completedAt: completedAtOf(a),
      transitionId: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `act-${a.actionId}`,
      lastModified: new Date().toISOString(),
    };
  });
  return changed ? out : list;
}

/** Apply recurring-instance completions to the templates (same contract as above). */
export function applyActionsToRecurring(list, actions) {
  const byTemplate = new Map();
  for (const a of actions || []) {
    if (a?.type !== 'task_complete' || !a.templateId || !a.instanceDate) continue;
    if (!byTemplate.has(String(a.templateId))) byTemplate.set(String(a.templateId), []);
    byTemplate.get(String(a.templateId)).push(a);
  }
  if (!byTemplate.size || !Array.isArray(list)) return list;
  let changed = false;
  const out = list.map((t) => {
    const acts = t && byTemplate.get(String(t.id));
    if (!acts) return t;
    const dates = [...(t.completedDates || [])];
    const stamps = { ...(t.completedDatesTimestamps || {}) };
    let touched = false;
    for (const a of acts) {
      if (dates.includes(a.instanceDate)) continue;
      dates.push(a.instanceDate);
      stamps[a.instanceDate] = stampOf(completedAtOf(a));
      touched = true;
    }
    if (!touched) return t;
    changed = true;
    return { ...t, completedDates: dates, completedDatesTimestamps: stamps, lastModified: new Date().toISOString() };
  });
  return changed ? out : list;
}
