// Responsiveness trace: what held the page, and when, on a device we cannot
// attach a debugger to. A release Android build cannot be inspected, and a
// tester's "it hesitates" names no cause; this records enough for the sync
// diagnostics report (Settings → Sync → Diagnostics → Copy) to name one.
//
// Three records, all bounded and in memory only:
//   • milestones: the first time each named startup step was reached
//     (bundle, data loaded, first render, splash released), ms since the page
//     started;
//   • phases: named stretches of the app's own work. timeSync wraps work that
//     runs without yielding (it holds the page for its whole length);
//     timeAsync wraps a cycle that awaits (its span includes waiting, so it is
//     "in flight", not necessarily blocking). Per name: count, total, max;
//     and the recent spans themselves, for matching against long tasks;
//   • long tasks: the browser's own report of every stretch of 50 ms or more
//     in which the page could not respond (PerformanceObserver 'longtask',
//     Chromium and the Android WebView; absent elsewhere, which leaves the
//     list empty). The slowest are kept, each with the phases it overlapped.
//
// Nothing here changes behaviour: every wrapper returns what the work returns
// and rethrows what it throws.

const MAX_SPANS = 600;
const MAX_LONG = 25;
// Spans shorter than this cannot explain a long task and only crowd the ring.
const MIN_SYNC_SPAN_MS = 4;

const state = {
  marks: {},
  spans: [],
  byName: new Map(),
  long: [],
  longCount: 0,
  longTotalMs: 0,
  observing: false,
};

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

/** The first time `name` was reached, in ms since the page started. Later calls are ignored. */
export function markMilestone(name) {
  if (!(name in state.marks)) state.marks[name] = Math.round(now());
}

function record(name, start, end, async) {
  const ms = end - start;
  const agg = state.byName.get(name) ?? { name, async, count: 0, totalMs: 0, maxMs: 0 };
  agg.count += 1;
  agg.totalMs += ms;
  if (ms > agg.maxMs) agg.maxMs = ms;
  state.byName.set(name, agg);
  if (!async && ms < MIN_SYNC_SPAN_MS) return;
  state.spans.push({ name, start, end, async });
  if (state.spans.length > MAX_SPANS) state.spans.splice(0, state.spans.length - MAX_SPANS);
}

/** Runs `fn` (which does not await) and records how long it held the page. */
export function timeSync(name, fn) {
  const start = now();
  try {
    return fn();
  } finally {
    record(name, start, now(), false);
  }
}

/** Runs the async `fn` and records its span, waiting included. */
export async function timeAsync(name, fn) {
  const start = now();
  try {
    return await fn();
  } finally {
    record(name, start, now(), true);
  }
}

/** Feeds one long-task entry (exported for tests; the observer calls it). */
export function noteLongTask(startTime, duration) {
  state.longCount += 1;
  state.longTotalMs += duration;
  const entry = { start: startTime, duration };
  const list = state.long;
  if (list.length < MAX_LONG || duration > list[list.length - 1].duration) {
    let i = list.findIndex((l) => duration > l.duration);
    if (i === -1) i = list.length;
    list.splice(i, 0, entry);
    if (list.length > MAX_LONG) list.pop();
  }
}

/** Starts watching for long tasks, including those before this call (buffered). Safe to call more than once. */
export function startLongTaskObserver(PO = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : null) {
  if (state.observing || !PO) return false;
  try {
    if (Array.isArray(PO.supportedEntryTypes) && !PO.supportedEntryTypes.includes('longtask')) return false;
    const po = new PO((list) => {
      for (const e of list.getEntries()) noteLongTask(e.startTime, e.duration);
    });
    po.observe({ type: 'longtask', buffered: true });
    state.observing = true;
    return true;
  } catch {
    return false;
  }
}

const overlaps = (span, start, end) => span.start < end && span.end > start;

/** A copy of everything recorded, the long tasks matched to the phases they overlapped. */
export function perfSnapshot() {
  return {
    observing: state.observing,
    uptimeMs: Math.round(now()),
    marks: { ...state.marks },
    longCount: state.longCount,
    longTotalMs: Math.round(state.longTotalMs),
    long: state.long.map((l) => {
      const end = l.start + l.duration;
      const hits = state.spans.filter((s) => overlaps(s, l.start, end));
      // Blocking phases first: a sync span inside a long task is the cause;
      // an async one only says what was in flight.
      const during = [
        ...new Set(hits.filter((s) => !s.async).map((s) => s.name)),
        ...new Set(hits.filter((s) => s.async).map((s) => `${s.name} (in flight)`)),
      ];
      return { start: Math.round(l.start), duration: Math.round(l.duration), during };
    }),
    phases: [...state.byName.values()]
      .map((p) => ({ ...p, totalMs: Math.round(p.totalMs), maxMs: Math.round(p.maxMs) }))
      .sort((a, b) => b.totalMs - a.totalMs),
  };
}

/** The report's lines for a snapshot. */
export function formatPerfLines(snap) {
  const s = (ms) => `${(ms / 1000).toFixed(1)}s`;
  const lines = ['', `responsiveness:  up ${s(snap.uptimeMs)}`];
  const marks = Object.entries(snap.marks).sort((a, b) => a[1] - b[1]);
  if (marks.length) lines.push(`  startup:       ${marks.map(([k, v]) => `${k} ${s(v)}`).join(', ')}`);
  if (!snap.observing) {
    lines.push('  long tasks:    not reported by this browser');
  } else {
    lines.push(`  long tasks:    ${snap.longCount} (${s(snap.longTotalMs)} blocked in all)`);
    for (const l of snap.long.slice(0, 15)) {
      lines.push(`    at ${s(l.start)}: ${l.duration} ms${l.during.length ? ` during ${l.during.join(', ')}` : ''}`);
    }
  }
  if (snap.phases.length) {
    lines.push('  work:');
    for (const p of snap.phases.slice(0, 15)) {
      lines.push(`    ${p.name}${p.async ? ' (async)' : ''}: ${p.count}x, ${p.totalMs} ms total, ${p.maxMs} ms max`);
    }
  }
  return lines;
}

/** Test-only reset. */
export function __resetPerfTraceForTests() {
  state.marks = {};
  state.spans = [];
  state.byName = new Map();
  state.long = [];
  state.longCount = 0;
  state.longTotalMs = 0;
  state.observing = false;
}
