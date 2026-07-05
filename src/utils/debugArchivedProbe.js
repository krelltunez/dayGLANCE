// Gated diagnostics for the "archived stripped on a second pass" investigation.
//
// Fully inert unless localStorage 'dayglance-debug-stamp' === '1'. No behavior
// change: the store probe is a transparent passthrough over Storage.setItem, and
// probeSetter is a transparent passthrough over a React state setter. Both only
// emit console diagnostics (with a stack trace) when a write takes an item from
// `archived === true` to `archived === undefined` (a strip) — pinpointing the
// exact call site that removes the field, instead of us guessing.

function debugOn() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('dayglance-debug-stamp') === '1';
  } catch {
    return false;
  }
}

// Ids of items that went archived:true → absent between `before` and `after`.
function strippedIds(before, after) {
  const b = new Map((before || []).map((t) => [String(t && t.id), t && t.archived]));
  return (after || [])
    .filter((t) => t && b.get(String(t.id)) === true && t.archived === undefined)
    .map((t) => t.id);
}

// Ids that went absent/false → true (the #1127 carry-forward heal), for contrast.
function healedIds(before, after) {
  const b = new Map((before || []).map((t) => [String(t && t.id), t && t.archived]));
  return (after || [])
    .filter((t) => t && b.get(String(t.id)) !== true && t.archived === true)
    .map((t) => t.id);
}

/**
 * (1) Intercept every write to the `day-planner-unscheduled` store and log which
 * PERSISTED write strips (or heals) `archived`, with a stack trace naming the
 * caller (loadData / applyEngineData / saveData / restoreBackup / …). Install once.
 */
export function installUnscheduledStoreProbe() {
  if (typeof window === 'undefined' || typeof Storage === 'undefined') return;
  if (window.__archivedStoreProbe) return;
  window.__archivedStoreProbe = true;
  const proto = Storage.prototype;
  const origSet = proto.setItem;
  const origGet = proto.getItem;
  proto.setItem = function (key, value) {
    if (key === 'day-planner-unscheduled' && debugOn()) {
      try {
        const before = JSON.parse(origGet.call(this, key) || '[]');
        const after = JSON.parse(value || '[]');
        const stripped = strippedIds(before, after);
        const healed = healedIds(before, after);
        if (stripped.length || healed.length) {
          console.warn('[archived-store] day-planner-unscheduled write — STRIPPED:', stripped, '| healed:', healed);
          console.trace('[archived-store] ↑ stack of this store write');
        }
      } catch {
        /* never break storage */
      }
    }
    return origSet.call(this, key, value);
  };
}

/**
 * (2) Wrap a React state setter so the EXACT setter call that strips `archived`
 * logs a stack trace. Transparent passthrough: accepts a value or an updater fn,
 * behaves identically, only adds a diagnostic when a strip is detected.
 *
 * @param {string}   label      e.g. 'setUnscheduledTasks'
 * @param {Function} rawSetter  the useState setter to wrap
 */
export function probeSetter(label, rawSetter) {
  return (update) => {
    // Capture the stack at the CALL SITE (synchronously, now). The strip check has
    // to run inside the functional updater — but that updater is invoked LATER by
    // React during render, so a console.trace in there traces the render, not the
    // caller. So we snapshot the call-site stack here and only print it if the
    // resulting update turns out to strip archived.
    const callSite = debugOn() ? new Error('call-site') : null;
    return rawSetter((prev) => {
      const next = typeof update === 'function' ? update(prev) : update;
      if (callSite && Array.isArray(next) && Array.isArray(prev)) {
        try {
          const stripped = strippedIds(prev, next);
          if (stripped.length) {
            console.warn(`[archived-set] ${label} STRIPPED archived for`, stripped, '(true → undefined)');
            console.warn(`[archived-set] ↑ CALL-SITE stack (the code that called ${label}):\n`, callSite.stack);
          }
        } catch {
          /* diagnostic must never throw */
        }
      }
      return next;
    });
  };
}
