// TASKS-METADATA READ (Phase 4, Step 2 — docs/obsidian-buildout-spec.md).
//
// One extraction pass over BOTH serializations of the Obsidian Tasks
// plugin's per-line metadata — emoji signifiers (📅 ⏳ 🛫 ⏫ 🔁 …) and
// Dataview inline fields ([due:: 2026-09-01], [priority:: high], …). The
// plugin has a mode that writes the Dataview form instead of emoji, so
// reading only emoji would miss everyone who flipped that setting.
//
// NON-DESTRUCTIVE BY DESIGN (the identity-freeze rule): this module never
// changes what is stored. `obsidianRawTitle` keeps the FULL line text —
// metadata included — so identities, write matching, and metadata
// preservation through rewrites stay byte- and version-stable on every
// client. Extraction only (a) derives a cleaner DISPLAY title and (b) maps
// a handful of fields into app state. Contrast #1470's completion marker,
// which IS stripped out of rawTitle — that marker is dayGLANCE's own
// regenerated decoration; this metadata is the USER's text and stays
// frozen. That difference is also why extraction safely applies to
// untagged lines (nothing about their bytes or identity changes), while
// the marker strip is tagged-lines-only.
//
// THE TRAILING RUN. Metadata is recognized only as an unbroken run of
// segments at the END of the title (after the #1470 marker and ^dg- token
// are already split off) — the same trailing-only discipline as the
// completion marker. `text + metaText === original` ALWAYS (byte-exact
// split), which is what makes the retitle-carry lossless: a dayGLANCE
// rename re-attaches metaText verbatim.
//
// Recognized segments (each optionally preceded by whitespace):
//   📅/⏳/🛫/✅/➕/❌ (+ optional U+FE0F) + YYYY-MM-DD   date signifiers
//   🔺 ⏫ 🔼 🔽 ⏬ (+ optional U+FE0F)                    priority
//   🔁 (+ optional U+FE0F) + free rule text              recurrence
//   [key:: value]                                        Dataview field
//
// FIELD MAPPING (confirmed scope — everything else is preserved as text
// and mapped to NOTHING, unknown Dataview keys included):
//   due (📅 / [due::])            → deadline (YYYY-MM-DD)
//   scheduled (⏳ / [scheduled::]) → the timeline date
//   priority (emoji / [priority::]) → 0–3 (see mapping below)
//   recurrence (🔁 / [repeat::])  → recognized, NOT mapped — badge only
// ✅ done-dates: the TRAILING marker is #1470's (split before this module
// runs, absorbed into completedAt). A ✅ or [completion:: …] sitting
// non-trailing inside the run is user/plugin-authored frozen text: it is
// display-stripped here but deliberately NOT mapped — completedAt stays
// #1470's app-wins record, never a second vault-derived channel.
//
// PRIORITY COLLAPSE (five Tasks levels onto dayGLANCE's four, 0 = none,
// 1 = low, 2 = medium, 3 = high): {🔺 highest, ⏫ high} → 3, 🔼 → 2,
// {🔽 low, ⏬ lowest} → 1. The highest/high and low/lowest distinctions
// collapse — display/behavior-side only and fully reversible, because the
// vault text is frozen and never written back.

const DATE_EMOJI = '(?:\\u{1F4C5}|\\u{23F3}|\\u{1F6EB}|\\u{2705}|\\u{2795}|\\u{274C})';
const PRIORITY_EMOJI = '(?:\\u{1F53A}|\\u{23EB}|\\u{1F53C}|\\u{1F53D}|\\u{23EC})';
const RECUR_EMOJI = '\\u{1F501}';
const VS = '\\uFE0F?';

// One metadata segment. The 🔁 rule text ("every 2 weeks on Monday") is free
// text and runs until the next segment marker or end of string — hence the
// negative character class over every segment-opening character.
const SEG = `(?:${DATE_EMOJI}${VS}\\s*\\d{4}-\\d{2}-\\d{2}` +
  `|${PRIORITY_EMOJI}${VS}` +
  `|${RECUR_EMOJI}${VS}[^\\u{1F4C5}\\u{23F3}\\u{1F6EB}\\u{2705}\\u{2795}\\u{274C}\\u{1F53A}\\u{23EB}\\u{1F53C}\\u{1F53D}\\u{23EC}\\u{1F501}\\[\\]]*` +
  `|\\[[A-Za-z][A-Za-z0-9_-]*::[^\\]]*\\])`;

const TRAILING_RUN_RE = new RegExp(`(?:\\s+${SEG})+\\s*$`, 'u');

// Field extractors, run over the matched metaText only.
const DUE_RE = new RegExp(`(?:\\u{1F4C5}${VS}\\s*(\\d{4}-\\d{2}-\\d{2}))|\\[due::\\s*(\\d{4}-\\d{2}-\\d{2})[^\\]]*\\]`, 'u');
const SCHEDULED_RE = new RegExp(`(?:\\u{23F3}${VS}\\s*(\\d{4}-\\d{2}-\\d{2}))|\\[scheduled::\\s*(\\d{4}-\\d{2}-\\d{2})[^\\]]*\\]`, 'u');
const PRIORITY_EMOJI_RE = new RegExp(`(\\u{1F53A}|\\u{23EB}|\\u{1F53C}|\\u{1F53D}|\\u{23EC})${VS}`, 'u');
const PRIORITY_DV_RE = /\[priority::\s*(highest|high|medium|low|lowest)\s*\]/iu;
const RECUR_RE = new RegExp(`${RECUR_EMOJI}${VS}|\\[repeat::[^\\]]*\\]`, 'u');

const PRIORITY_BY_EMOJI = {
  '\u{1F53A}': 3, // 🔺 highest
  '\u{23EB}': 3,  // ⏫ high
  '\u{1F53C}': 2, // 🔼 medium
  '\u{1F53D}': 1, // 🔽 low
  '\u{23EC}': 1,  // ⏬ lowest
};
const PRIORITY_BY_WORD = { highest: 3, high: 3, medium: 2, low: 1, lowest: 1 };

/**
 * Split the trailing metadata run off a title, byte-exactly:
 * `text + metaText === input`, always. Returns the mapped fields alongside.
 *
 * @param {string} input  a task-line title AFTER the ^dg- token and #1470's
 *   trailing completion marker have been split off
 * @returns {{
 *   text: string,        // display base — input minus the trailing run
 *   metaText: string,    // the verbatim trailing run ('' when none)
 *   fields: {
 *     due: string|null, scheduled: string|null,
 *     priority: number|null, recurrence: boolean,
 *   },
 * }}
 */
export function splitTasksMetadata(input) {
  const s = String(input ?? '');
  const none = { text: s, metaText: '', fields: { due: null, scheduled: null, priority: null, recurrence: false } };
  const m = TRAILING_RUN_RE.exec(s);
  if (!m) return none;
  const text = s.slice(0, m.index);
  // A line that is ONLY metadata has no title to display — treat it as
  // having no recognizable run rather than presenting an empty title.
  if (text.trim() === '') return none;
  const metaText = s.slice(m.index);

  const due = DUE_RE.exec(metaText);
  const scheduled = SCHEDULED_RE.exec(metaText);
  const pe = PRIORITY_EMOJI_RE.exec(metaText);
  const pw = PRIORITY_DV_RE.exec(metaText);
  return {
    text,
    metaText,
    fields: {
      due: due ? (due[1] ?? due[2]) : null,
      scheduled: scheduled ? (scheduled[1] ?? scheduled[2]) : null,
      priority: pe ? PRIORITY_BY_EMOJI[pe[1]] : (pw ? PRIORITY_BY_WORD[pw[1].toLowerCase()] : null),
      recurrence: RECUR_RE.test(metaText),
    },
  };
}

/**
 * THE ONE COMPARISON/CARRY SPACE (hazard 1 of the Step 2 report, pinned by
 * tests): every place that turns a DISPLAY title back into full line space —
 * the scan-time title resolver's `ours`, and the writeback's newRawTitle
 * derivation (the retitle-carry) — MUST go through this helper, so the
 * three-string retitle comparison and what actually gets written can never
 * diverge. Re-attaches the task's verbatim metadata segment (derived from
 * the frozen rawTitle, never stored separately) to a display-space title.
 *
 * IDEMPOTENT ON PURPOSE: a display title that still carries a trailing
 * metadata run of its own — an OLD-STYLE title from before display
 * stripping, alive throughout the mixed-version window — has that run
 * REPLACED by the rawTitle's canonical one rather than doubled. Without
 * this, every pre-upgrade metadata-bearing task would compare as
 * permanently renamed and re-create the false-conflict spam this helper
 * exists to prevent. (Deliberate corollary: metadata TYPED INTO a
 * dayGLANCE rename is replaced by the line's existing run — metadata is
 * edited in Obsidian, not smuggled through the rename field — unless the
 * line carries no run at all, in which case the typed text passes through
 * verbatim and the next scan imports it as new metadata.)
 *
 * @param {string} displayTitle  a title with the ' #obsidian' tag already
 *   stripped (display space)
 * @param {string} rawTitle      the task's frozen obsidianRawTitle (full
 *   line space) — the metadata source
 */
export function reattachTasksMetadata(displayTitle, rawTitle) {
  const { metaText } = splitTasksMetadata(String(rawTitle ?? ''));
  if (!metaText) return displayTitle;
  const d = splitTasksMetadata(String(displayTitle ?? '')).text.trimEnd();
  return d + metaText;
}
