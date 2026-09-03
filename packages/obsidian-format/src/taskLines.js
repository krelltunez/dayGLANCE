// Task-line building, rewriting, sorting, and parsing — moved verbatim
// from dayGLANCE src/obsidian.js.
//
// THE PACKAGE IS FORMAT, NEVER POLICY. It should not know an ownership rule
// exists. updateTaskLines below is the one place format BRUSHES policy: its
// write-time title guard detects divergence and reports through the
// onTitleConflict callback, and the CALLER resolves it. Keep it that way —
// resolving the conflict inside this function, instead of calling back, is
// the moment format quietly becomes policy and the package boundary erodes.

import {
  splitBlockId,
  blockIdSuffix,
  legacyObsidianId,
  appIdForBlockId,
  deriveBlockId,
  hasForeignBlockId,
  noteKeyForPath,
  noteTaskId,
} from './identity.js';
import { splitCompletionMarker, completionMarkerSuffix } from './completionMarkers.js';
import { splitTasksMetadata } from './tasksMetadata.js';

/**
 * Build a sort key for a task line so tasks can be ordered chronologically.
 * Key format: "YYYY-MM-DD THH:MM" — tasks with no date use noteDate (the
 * date of the file), tasks with no time sort after timed tasks of the same date.
 */
function taskLineSortKey(line, noteDate) {
  const m = line.match(/^\s*- \[[ xX]\]\s+(.*)$/);
  if (!m) return '\uffff';
  const body = m[1].trim();
  const dateMatch = body.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
  const date = dateMatch ? dateMatch[1] : (noteDate || '0000-00-00');
  const afterDate = dateMatch ? dateMatch[2] : body;
  const timeMatch = afterDate.match(/^(\d{1,2}):(\d{2})/);
  if (timeMatch) {
    return `${date}T${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }
  return `${date}T\uffff`; // all-day / no-time → sort after timed tasks
}

/**
 * Sort all top-level task lines within a heading section chronologically,
 * leaving non-task lines (prose, blank lines) after the sorted tasks.
 * Returns a new lines array; the original is not mutated.
 */
function sortTaskLinesInSection(lines, headingStr, noteDate) {
  const headingIdx = lines.findIndex(l => l === headingStr);
  if (headingIdx === -1) return lines;
  const headingLevel = (headingStr.match(/^#+/) || [''])[0].length;
  let sectionEnd = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const hm = lines[i].match(/^(#+)\s/);
    if (hm && hm[1].length <= headingLevel) { sectionEnd = i; break; }
  }
  const interior = lines.slice(headingIdx + 1, sectionEnd);
  const taskLines = interior.filter(l => /^\s*- \[/.test(l));
  const otherLines = interior.filter(l => !/^\s*- \[/.test(l));
  taskLines.sort((a, b) => {
    const ka = taskLineSortKey(a, noteDate);
    const kb = taskLineSortKey(b, noteDate);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  // Non-task lines (prose, blank lines) go after sorted tasks.
  // Drop trailing blanks to avoid accumulating empty lines on each write.
  const nonBlank = otherLines.filter(l => l.trim() !== '');
  const newSection = [...taskLines, ...nonBlank];
  if (sectionEnd < lines.length && newSection.length > 0) newSection.push('');
  return [...lines.slice(0, headingIdx + 1), ...newSection, ...lines.slice(sectionEnd)];
}

/**
 * Build the formatted markdown task line for a dayGLANCE task, mirroring the
 * format that parseTasksFromMarkdown recognises:
 *   - [ ] Title                         (inbox / all-day today)
 *   - [ ] 2026-03-29 Title              (all-day on another date)
 *   - [ ] 08:00-09:00 Title             (timed task on note's own date)
 *   - [ ] 2026-03-29 08:00-09:00 Title  (timed task on a different date)
 *
 * @param {{ title, startTime, duration, isAllDay, date, blockId }} task
 * @param {string} noteDate  The YYYY-MM-DD date of the note being written to
 */
function buildObsidianTaskLine(task, noteDate) {
  const datePrefix = task.date && task.date !== noteDate ? `${task.date} ` : '';
  const timePrefix = (!task.isAllDay && task.startTime) ? buildTimePrefix(task.startTime, task.duration || null) : '';
  // Phase 2: a task created in dayGLANCE lands in the vault already carrying
  // its ^dg- block id, assigned at creation time (useTaskActions) and
  // persisted on the app task — never derived at read time.
  return `- [ ] ${datePrefix}${timePrefix}${task.title}${blockIdSuffix(task.blockId, task.title)}`;
}

/**
 * Try to parse a time string from the beginning of text.
 * Supports single times ("09:00", "9:00 AM") and duration ranges ("09:00-10:00").
 * Returns { startTime, duration, rest } or null.  duration is null when no range.
 */
function parseLeadingTime(text) {
  // Try duration range first: HH:MM[-HH:MM] [AM/PM] Title
  const rangeMatch = text.match(
    /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?-(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/
  );
  if (rangeMatch) {
    let startH = parseInt(rangeMatch[1], 10);
    const startM = parseInt(rangeMatch[2], 10);
    const startAmpm = rangeMatch[3];
    let endH = parseInt(rangeMatch[4], 10);
    const endM = parseInt(rangeMatch[5], 10);
    const endAmpm = rangeMatch[6];
    if (startAmpm) {
      const upper = startAmpm.toUpperCase();
      if (upper === 'PM' && startH < 12) startH += 12;
      if (upper === 'AM' && startH === 12) startH = 0;
    }
    if (endAmpm) {
      const upper = endAmpm.toUpperCase();
      if (upper === 'PM' && endH < 12) endH += 12;
      if (upper === 'AM' && endH === 12) endH = 0;
    }
    if (startH < 0 || startH > 23 || endH < 0 || endH > 23) return null;
    const startTime = `${startH.toString().padStart(2, '0')}:${rangeMatch[2]}`;
    const rawDuration = (endH * 60 + endM) - (startH * 60 + startM);
    const duration = rawDuration > 0 ? rawDuration : rawDuration + 1440; // handle midnight wrap
    return { startTime, duration, rest: rangeMatch[7] };
  }

  // Fall back to single time: HH:MM [AM/PM] Title
  const timeMatch = text.match(
    /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])?\s+(.+)$/
  );
  if (!timeMatch) return null;
  let hours = parseInt(timeMatch[1], 10);
  const minutes = timeMatch[2];
  const ampm = timeMatch[3];
  if (ampm) {
    const upper = ampm.toUpperCase();
    if (upper === 'PM' && hours < 12) hours += 12;
    if (upper === 'AM' && hours === 12) hours = 0;
  }
  if (hours < 0 || hours > 23) return null;
  return {
    startTime: `${hours.toString().padStart(2, '0')}:${minutes}`,
    duration: null,
    rest: timeMatch[4],
  };
}

/**
 * Build the time prefix string for writing back to a task line.
 * Produces "HH:MM-HH:MM " when duration is provided, otherwise "HH:MM ".
 */
function buildTimePrefix(startTime, duration) {
  if (!startTime) return '';
  if (!duration) return `${startTime} `;
  const [h, m] = startTime.split(':').map(Number);
  const endTotal = h * 60 + m + duration;
  const eh = Math.floor(endTotal / 60) % 24;
  const em = endTotal % 60;
  const endTime = `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`;
  return `${startTime}-${endTime} `;
}

/**
 * Strip leading date / date+time / time prefixes from a raw task line body
 * (the text after `- [x] `) to get the bare title, mirroring
 * parseTasksFromMarkdown.  Returns { bareTitle, datePrefix } where datePrefix
 * is the "YYYY-MM-DD " string (with trailing space) if one was present, or ''.
 */
function stripLinePrefixes(text) {
  const trimmed = text.trim();
  // Regex that matches a single time or a duration range (HH:MM or HH:MM-HH:MM) with optional AM/PM
  const timeRe = /^(\d{1,2}):(\d{2})\s*(?:[AaPp][Mm])?(?:-\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?)?\s+(.+)$/;
  // 1) Leading date: "YYYY-MM-DD ..."
  const dateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (dateMatch) {
    const datePrefix = dateMatch[1] + ' ';
    const afterDate = dateMatch[2];
    // Date + time (or date + range)
    const tm = afterDate.match(timeRe);
    if (tm) return { bareTitle: tm[3], datePrefix };
    // Date only
    return { bareTitle: afterDate, datePrefix };
  }
  // 2) Time only (or range only)
  const tm = trimmed.match(timeRe);
  if (tm) return { bareTitle: tm[3], datePrefix: '' };
  // 3) Plain title
  return { bareTitle: trimmed, datePrefix: '' };
}

/**
 * Apply a task-state update to daily-note lines IN PLACE. Shared by the FSA
 * and Android-native writeback paths so ID-first matching cannot drift.
 *
 * Matching (Phase 2):
 *  1. ID-first — when the task carries a block id, lines whose trailing
 *     `^dg-<id>` equals it are updated (the id survives the rewrite even when
 *     the title now ends in a user block ref, so identity is never dropped).
 *  2. Fallback — when no line carried the id (line predates tagging, or the
 *     user removed the token), lines are matched by bare title exactly as
 *     before, SKIPPING lines tagged with some other task's id (those are
 *     different tasks now, per the duplicate rule). Fallback-matched lines are
 *     stamped with the task's block id when one is provided — this is the
 *     opportunistic migration moment: existing untagged tasks acquire ids as
 *     they get rewritten, never via a sweep.
 *
 * Updating all occurrences within a match pass mirrors the historical
 * title-dedup behavior.
 *
 * @returns {boolean} whether any line was updated
 */
export function updateTaskLines(lines, { obsidianRawTitle, completed, startTime, newRawTitle, duration, targetDate, blockId = null, onTitleConflict = null, completedAt = null, completionFormat = null }) {
  const timeStr = buildTimePrefix(startTime, duration);
  const writtenTitle = newRawTitle !== undefined ? newRawTitle : obsidianRawTitle;
  // When targetDate is provided (task rescheduled to a different day), write
  // an explicit inline date prefix so the task is attributed to the new date
  // while remaining in its original daily note file.
  //
  // The completion marker is a regenerated suffix from task state (see the
  // marker section): the written title is always stripped of any trailing
  // marker first — so a hand-written `✅ …` inside a title being stamped for
  // the first time normalizes out in the same write instead of doubling —
  // then the marker is re-emitted per (completed, completedAt, format). With
  // completionFormat null nothing is re-emitted, which is how the OFF
  // setting converges lines clean on their next touch.
  const rewrite = (i, indent, datePrefix, idSuffix, title = writtenTitle) => {
    const effectiveDatePrefix = targetDate ? `${targetDate} ` : datePrefix;
    // Markers live ONLY on tagged lines (the parse strips them only there).
    // When this rewrite leaves the line untagged — no id to stamp, or a
    // foreign block ref refused the stamp — the title stays byte-frozen and
    // no marker is emitted: a marker the parse can't strip would become
    // title text and silently change the line's content-derived identity.
    const tagged = idSuffix !== '';
    const emitTitle = tagged ? splitCompletionMarker(title).text.trimEnd() : title;
    const markerSuffix = tagged
      ? completionMarkerSuffix(completed, completedAt, completionFormat, emitTitle)
      : '';
    lines[i] = `${indent}- [${completed ? 'x' : ' '}] ${effectiveDatePrefix}${timeStr}${emitTitle}${markerSuffix}${idSuffix}`;
  };

  let updated = false;
  if (blockId) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*)- \[([ xX])\]\s+(.+)$/);
      if (!m) continue;
      const { text: body, blockId: lineId } = splitBlockId(m[3]);
      if (lineId !== blockId) continue;
      // Marker-aware splitting: the completion marker is a regenerated
      // decoration, never title text on a tagged line (the parse strips it
      // the same way), so the write-time title guard below compares CLEAN
      // titles — otherwise completing a task would read as a vault-side
      // retitle.
      const bodySansMarker = splitCompletionMarker(body).text;
      const { bareTitle, datePrefix } = stripLinePrefixes(bodySansMarker);
      // WRITE-TIME TITLE GUARD (the two-sided retitle policy's funnel —
      // utils/obsidianTitleConflict.js). The line's CURRENT title is the
      // vault's truth; app state was built from obsidianRawTitle, our last
      // observation. When the line moved off that base, rebuilding it from
      // app state would silently revert an Obsidian edit — the one hostile
      // outcome — so the rewrite KEEPS THE LINE'S OWN TITLE while still
      // writing the state change. If we were also trying to RETITLE
      // (newRawTitle differs from the line too), that is a two-sided
      // conflict: signal it so the caller skips the titleUpdate commit,
      // obsidianRawTitle stays truthful as the merge base, and the next
      // scan resolves through the single scan-time policy.
      const lineDiverged = bareTitle !== obsidianRawTitle && bareTitle !== writtenTitle;
      // FORMAT/POLICY SEAM: report the conflict, NEVER resolve it here — the
      // caller owns what-wins-on-divergence (see the module header).
      if (lineDiverged && newRawTitle !== undefined) onTitleConflict?.({ lineTitle: bareTitle });
      // Forced suffix: a line that already carried this id keeps it
      // unconditionally — the foreign-block-ref guard only applies to
      // FIRST-TIME stamping, never to preserving established identity.
      rewrite(i, m[1], datePrefix, ` ^dg-${blockId}`, lineDiverged ? bareTitle : writtenTitle);
      updated = true;
    }
    if (updated) return true;
  }

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)- \[([ xX])\]\s+(.+)$/);
    if (!m) continue;
    const { text: body, blockId: lineId } = splitBlockId(m[3]);
    if (lineId) continue; // tagged line — belongs to whichever task owns that id
    const { bareTitle, datePrefix } = stripLinePrefixes(body);
    if (bareTitle !== obsidianRawTitle) continue;
    rewrite(i, m[1], datePrefix, blockIdSuffix(blockId, writtenTitle));
    updated = true;
  }
  return updated;
}

/**
 * Parse tasks from Obsidian markdown content.
 *
 * Recognised patterns (in priority order):
 *   - [ ] 2026-02-21 09:00 Date+time task  → scheduled on that date/time
 *   - [ ] 2026-02-21 Date-only task         → all-day task on that date
 *   - [ ] 09:00 Timed task                  → scheduled on the file's date
 *   - [ ] 9:00 AM Timed task                → scheduled on the file's date
 *   - [ ] Simple task                        → inbox task
 *   - [x] Completed task                     → completed (any of the above)
 *
 * Returns { scheduledTasks: [...], inboxTasks: [...] }
 *
 * @param {Set<string>} [seenBlockIds]  duplicate `^dg-` guard. First occurrence
 *   of an id wins; later lines carrying the same id (a copy-paste inside
 *   Obsidian) are parsed as if untagged, becoming ordinary content-derived
 *   tasks. The sync passes ONE set across every file in the scan so the rule
 *   holds vault-wide, not merely per file.
 */
/** The completion date a line's marker carries (YYYY-MM-DD), or null. */
export function completionDateOfLine(body) {
  const { completedAt } = splitCompletionMarker(String(body ?? ''));
  return typeof completedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(completedAt) ? completedAt.slice(0, 10) : null;
}

/** True when a completed line's marker date is on or after `completedSince`. Undated → false. */
export function completedLineInWindow(body, completedSince) {
  const d = completionDateOfLine(body);
  return d !== null && d >= completedSince;
}

export function parseTasksFromMarkdown(content, dateStr, seenBlockIds = new Set(), { notePath = null, completedSince = null } = {}) {
  const scheduled = [];
  const inbox = [];
  if (!content) return { scheduledTasks: scheduled, inboxTasks: inbox };
  // NON-DAILY NOTES (companion spec §6): `notePath` names the note instead
  // of a date. The note key (ruling A) is the path; a line's date comes only
  // from its own text (an inline prefix, or ⏳ scheduled metadata) — never
  // from the note — so a line with neither is an inbox item; and the task
  // carries obsidianNotePath (the writeback's locator) in place of
  // obsidianFileDate. Everything else — markers, metadata, block ids — is
  // exactly the daily-note grammar.
  const noteKey = notePath ? noteKeyForPath(notePath) : dateStr;
  const noteFields = notePath ? { obsidianNotePath: noteKeyForPath(notePath) } : { obsidianFileDate: dateStr };

  const lines = content.split('\n');

  for (const line of lines) {
    // Match: optional whitespace, -, space, [x or space], space, rest
    const match = line.match(/^\s*- \[([ xX])\]\s+(.+)$/);
    if (!match) continue;

    const completed = match[1] !== ' ';
    // Completion window (ruling E): in a non-daily note, a completed line
    // outside the window — or with no completion date — is not a task.
    if (notePath && completedSince && completed && !completedLineInWindow(splitBlockId(match[2].trim()).text, completedSince)) continue;
    let rawTitle = match[2].trim();

    // Strip a trailing ^dg-<id> block reference BEFORE any other parsing, so
    // rawTitle (and therefore the legacy hash) is identical to what an
    // untagged copy of the line would produce — that identity is what lets
    // ID-matching and text-matching fall back into each other cleanly.
    let blockId = null;
    let lineCompletedAt = null;
    const idSplit = splitBlockId(rawTitle);
    if (idSplit.blockId) {
      rawTitle = idSplit.text.trim();
      // TAGGED LINES ONLY: split the completion marker out of the title so it
      // never becomes part of task identity (see the marker section above).
      // The value is absorbed into completedAt only when the line is actually
      // checked — a stray marker on an unchecked line is semantically wrong
      // and is dropped (the next rewrite normalizes the line). Untagged lines
      // below this branch stay byte-frozen: a hand-written marker there is
      // title text, exactly as before this feature.
      const markerSplit = splitCompletionMarker(rawTitle);
      if (markerSplit.text !== rawTitle) {
        rawTitle = markerSplit.text.trim();
        if (completed) lineCompletedAt = markerSplit.completedAt;
      }
      if (!seenBlockIds.has(idSplit.blockId)) {
        seenBlockIds.add(idSplit.blockId);
        blockId = idSplit.blockId;
      }
      // else: duplicate id — first occurrence won; this line falls through as
      // an untagged task (blockId stays null).
    }

    let taskDate = notePath ? null : dateStr;
    let startTime = null;
    let isAllDay = false;
    let parsedDuration = null;

    // 1) Try inline date: "YYYY-MM-DD ..." at the beginning
    const dateMatch = rawTitle.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (dateMatch) {
      taskDate = dateMatch[1];
      const afterDate = dateMatch[2];

      // 1a) Try date + time/range: "YYYY-MM-DD HH:MM[-HH:MM][am/pm] Title"
      const timePart = parseLeadingTime(afterDate);
      if (timePart) {
        startTime = timePart.startTime;
        if (timePart.duration) parsedDuration = timePart.duration;
        rawTitle = timePart.rest;
      } else {
        // 1b) Date only → all-day task
        isAllDay = true;
        rawTitle = afterDate;
      }
    } else {
      // 2) Try time/range only: "HH:MM[-HH:MM][am/pm] Title"
      const timePart = parseLeadingTime(rawTitle);
      if (timePart) {
        startTime = timePart.startTime;
        if (timePart.duration) parsedDuration = timePart.duration;
        rawTitle = timePart.rest;
      }
    }

    // TASKS METADATA (Phase 4 Step 2, utils/obsidianTasksMetadata.js) —
    // non-destructive: rawTitle keeps the FULL text (metadata included), so
    // identity hashing and write matching are untouched on every line,
    // tagged or not. Extraction derives the display title and maps the
    // confirmed fields; everything unrecognized stays as preserved text.
    const meta = splitTasksMetadata(rawTitle);
    // ⏳ scheduled → the timeline: date-only, so all-day unless the line's
    // own time prefix supplied a time. An explicit inline date prefix WINS
    // over ⏳ (it is dayGLANCE's own reschedule channel — when both exist,
    // the prefix is the newer statement, written by a DG reschedule of a
    // ⏳-carrying line).
    if (!dateMatch && meta.fields.scheduled) {
      taskDate = meta.fields.scheduled;
      if (!startTime) isAllDay = true;
    }

    // Add #obsidian tag if not already present — to the DISPLAY title (the
    // trailing metadata run stripped); rawTitle stays full.
    const displayBase = meta.text;
    const title = displayBase.includes('#obsidian') ? displayBase : `${displayBase} #obsidian`;

    // ID-first: a ^dg- tagged line gets its durable block-derived id; an
    // untagged line keeps the legacy content-derived id (date + title hash).
    const legacyId = notePath ? noteTaskId(noteKey, rawTitle) : legacyObsidianId(taskDate, rawTitle);
    const id = blockId ? appIdForBlockId(blockId) : legacyId;
    // obsidianLegacyId is a PER-SCAN bridge hint, not an identity: it is what
    // this line's id would have been without the tag, recomputed from current
    // content each scan. The sync uses it to match a freshly-tagged line to
    // the task a device still holds under the old id, so app-side fields
    // survive the one-time legacy → block-id switch.
    const blockFields = blockId
      ? { obsidianBlockId: blockId, obsidianLegacyId: legacyId }
      : {};
    // Only inject completedAt when a tagged line actually carried a marker —
    // never an undefined key. The merge rule (app wins; the vault marker
    // fills a blank) is applied at the sync merge sites, not here.
    const completedAtFields = lineCompletedAt ? { completedAt: lineCompletedAt } : {};
    // Mapped Tasks metadata — again only ever present keys, no undefined
    // injection. 📅 due → deadline (the inbox-deadline concept; a 📅-only
    // line stays inbox). 🔁 is recognized, never mapped: the flag only
    // drives the task-card badge saying recurrence is managed in Obsidian.
    const metadataFields = {
      ...(meta.fields.due ? { deadline: meta.fields.due } : {}),
      ...(meta.fields.priority != null ? { priority: meta.fields.priority } : {}),
      ...(meta.fields.recurrence ? { obsidianRecurrence: true } : {}),
    };

    if (startTime && taskDate) {
      // Timed task (with or without inline date)
      scheduled.push({
        id,
        title,
        date: taskDate,
        startTime,
        duration: parsedDuration || 30,
        color: 'bg-purple-600',
        completed,
        isAllDay: false,
        notes: '',
        subtasks: [],
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
        ...noteFields,
        ...blockFields,
        ...completedAtFields,
        ...metadataFields,
      });
    } else if (isAllDay && taskDate) {
      // Date-only task → all-day scheduled task
      scheduled.push({
        id,
        title,
        date: taskDate,
        startTime: '00:00',
        duration: 30,
        color: 'bg-purple-600',
        completed,
        isAllDay: true,
        notes: '',
        subtasks: [],
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
        ...noteFields,
        ...blockFields,
        ...completedAtFields,
        ...metadataFields,
      });
    } else {
      // No date, no time → inbox
      inbox.push({
        id,
        title,
        priority: 0,
        completed,
        notes: '',
        subtasks: [],
        duration: 30,
        color: 'bg-purple-600',
        importSource: 'obsidian',
        obsidianRawTitle: rawTitle,
        ...noteFields,
        ...blockFields,
        ...completedAtFields,
        ...metadataFields,
      });
    }
  }

  return { scheduledTasks: scheduled, inboxTasks: inbox };
}

/**
 * NORMALIZE-THEN-OBSERVE (§3.10 ruling 7): stamp every untagged task line in
 * a daily note with its derived `^dg-` block id. The bridge plugin runs this
 * BEFORE reporting a daily note's state, so no observation dayGLANCE
 * receives contains an untagged task line — "visible in dayGLANCE"
 * structurally implies "already stamped", with no timing involved.
 *
 * PARSE PARITY IS THE CONTRACT of this function, and the reason it lives in
 * this file: it must stamp exactly the lines parseTasksFromMarkdown above
 * would import untagged, and derive each token from exactly the rawTitle the
 * parse would produce — deriveBlockId's unanimity property (every minter
 * agrees) only holds if every minter feeds it identical input. Concretely,
 * per line:
 *   • the same task-line match (`- [ ]` / `- [x]`, any indent — the parse
 *     imports indented checkbox lines too);
 *   • a line containing `^dg-` ANYWHERE is skipped — a valid trailing
 *     token, a DUPLICATE token (the parse treats a second occurrence as
 *     untagged; first-occurrence-wins stays as it is), or a token embedded
 *     MID-LINE by a concurrent-edit auto-merge (the 2026-08-31 war's
 *     corruption shape). The last case is the one deliberate break from
 *     parse parity: such a line DOES parse as an untagged task, but it is
 *     damaged, and appending another token compounds the damage — the line
 *     is left for a human, and the import simply carries it untagged until
 *     then (blockIdSuffix refuses it on the dayGLANCE side for the same
 *     reason, so neither minter touches it);
 *   • a line ending in a user-authored block reference is skipped — the
 *     same refusal as blockIdSuffix: Obsidian allows one block ref per
 *     line, and appending ours would break the user's existing links (the
 *     dayGLANCE-side backstop refuses these identically, so neither minter
 *     ever writes one);
 *   • rawTitle = the body after the leading date and/or time prefixes,
 *     using the SAME extraction steps as the parse (inline date first,
 *     then parseLeadingTime), completion markers and Tasks metadata left
 *     in place exactly as the parse leaves them on untagged lines;
 *   • the token = deriveBlockId(NOTE date, rawTitle) — the note's own
 *     date, matching the dayGLANCE writeback's sourceDate, never the
 *     line's inline date.
 *
 * The derivation makes stamping IDEMPOTENT and RACE-FREE against the
 * dayGLANCE-side backstop: both mint the same token for the same line, so
 * whoever writes first wins nothing — the other side's write is a no-op or
 * a byte-identical rewrite.
 *
 * @param {string} content  the daily note's markdown
 * @param {string} dateStr  the note's own YYYY-MM-DD date
 * @returns {{ text: string, changed: boolean, stamped: Array<{blockId: string, rawTitle: string}> }}
 */
export function stampUntaggedTaskLines(content, noteKey, opts = {}) {
  if (!content) return { text: content ?? '', changed: false, stamped: [] };
  const lines = content.split('\n');
  const plan = planStampInsertions(content, noteKey, opts);
  for (const p of plan) {
    lines[p.line] = lines[p.line].slice(0, p.fromCh) + p.insert;
  }
  return {
    text: lines.join('\n'),
    changed: plan.length > 0,
    stamped: plan.map((p) => ({ blockId: p.blockId, rawTitle: p.rawTitle })),
  };
}

/**
 * The stamp as a PLAN of per-line edits instead of a rewritten text —
 * the shape an EDITOR TRANSACTION needs (the buffer-safe write path for a
 * note that is OPEN in Obsidian, after the 2026-08-31 truncation incident:
 * a whole-file vault write to an open note races the editor buffer, an
 * editor transaction composes with it). stampUntaggedTaskLines above is
 * BUILT ON this planner, so the two can never diverge: applying the plan
 * IS the stamp, and every parse-parity rule and skip rule documented above
 * (and pinned in normalizeObserve.test.js) holds for both by construction.
 *
 * Each entry replaces the span [fromCh, toCh) of `line` — the line's
 * trailing-whitespace run — with ` ^dg-<id>`, exactly reproducing the
 * stamper's trim-then-append. Positions are {line, ch} in the same content
 * the plan was computed from; the caller must apply them to THAT content
 * (the wiring re-plans against the live buffer inside the transaction
 * pass, never against a stale read).
 *
 * @param {string} content  the note text the plan targets
 * @param {string} dateStr  the note's own YYYY-MM-DD date
 * @returns {Array<{line: number, fromCh: number, toCh: number, insert: string, blockId: string, rawTitle: string}>}
 */
export function planStampInsertions(content, noteKey, { completedSince = null } = {}) {
  if (!content) return [];
  const lines = content.split('\n');
  const plan = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*- \[([ xX])\]\s+(.+)$/);
    if (!m) continue;
    // COMPLETION WINDOW (companion §6, ruling E — non-daily notes only, the
    // caller passes `completedSince`): a completed line is stamped only when
    // its completion date is inside the window; an undated completed line
    // is older than any window. Open lines are never windowed.
    if (completedSince && m[1] !== ' ' && !completedLineInWindow(m[2], completedSince)) continue;
    // ANY occurrence of '^dg-' anywhere on the line refuses the stamp — not
    // just a valid trailing token. This widens the old two checks (tagged
    // line, duplicate token) to cover the CORRUPTED case surfaced by the
    // 2026-08-31 SSE-speed war: a concurrent-edit auto-merge (Obsidian
    // Sync) can land a token MID-LINE, where the end-anchored splitBlockId
    // doesn't see it — the line then parses as a new untagged task, and
    // stamping it would append a SECOND token, compounding the corruption
    // every cycle. A line that textually carries our marker is either
    // already ours or damaged; either way another token is never the
    // answer — a damaged line is left for a human to clean.
    if (lines[i].includes('^dg-')) continue;
    const body = m[2].trim();
    if (hasForeignBlockId(body)) continue; // user's own block ref owns the line
    // rawTitle exactly as parseTasksFromMarkdown derives it for an untagged
    // line: strip an inline date, then a leading time/range; everything else
    // (markers, metadata) stays.
    let rawTitle = body;
    const dateMatch = rawTitle.match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/);
    if (dateMatch) {
      const timePart = parseLeadingTime(dateMatch[2]);
      rawTitle = timePart ? timePart.rest : dateMatch[2];
    } else {
      const timePart = parseLeadingTime(rawTitle);
      if (timePart) rawTitle = timePart.rest;
    }
    const blockId = deriveBlockId(noteKey, rawTitle);
    const trimmed = lines[i].replace(/\s+$/, '');
    plan.push({
      line: i,
      fromCh: trimmed.length,
      toCh: lines[i].length,
      insert: ` ^dg-${blockId}`,
      blockId,
      rawTitle,
    });
  }
  return plan;
}

/**
 * Split a stamp plan into the entries safe to apply now and the entries to
 * DEFER because their target line currently holds a live editor cursor —
 * the cursor gate against PREMATURE IDENTITY ASSIGNMENT (the 2026-08-31
 * "W ^dg-...atch tennis" line; §3.10's fifth recorded lesson).
 *
 * Why this exists: the stamp trigger fires on save-plus-debounce, and a
 * save certifies a PAUSE, not a finished line — Obsidian autosaves
 * precisely at pauses, and a pause mid-word is common. A half-typed line
 * ("21:15-21:45 W") is a perfectly valid task line to the parse, so the
 * stamper minted identity for the fragment and the editor transaction put
 * the token at the line's end — which was the cursor position, so resumed
 * typing landed AFTER the token, splitting the word around it. No write
 * rule was violated (the buffer was genuinely clean; nothing was
 * destroyed); the unasked question was whether the line was FINISHED.
 * "Finished" is not directly readable, but its best readable witness is:
 * no live cursor on the line. A cursor's line is a line someone may still
 * be composing — skip it this pass; the cursor moves, the next pass stamps.
 * Per-line deliberately (a per-note "any open editor" rule would stop
 * stamping for users who keep notes open, reopening the untagged
 * population problem), and no cooldown deliberately (a "recently edited"
 * timer is the proxy version of this condition, and proxies age badly —
 * three recorded instances).
 *
 * Pure half of the gate: WHICH lines are held is the wiring's job (the
 * plugin reads cursors from editors that can actually receive keystrokes);
 * this function only pins the split. Entries keep their order; an empty or
 * missing held-set applies everything.
 *
 * @param {Array<{line: number}>} plan  planStampInsertions output
 * @param {Set<number>|null|undefined} heldLines  line numbers holding a live cursor
 * @returns {{ apply: Array<object>, deferred: Array<object> }}
 */
export function partitionStampPlan(plan, heldLines) {
  const apply = [];
  const deferred = [];
  for (const p of plan || []) {
    (heldLines && heldLines.has(p.line) ? deferred : apply).push(p);
  }
  return { apply, deferred };
}

/**
 * THE SETTLE FLOOR — a MECHANICAL constant, sized to Obsidian Sync's
 * delivery quantum, and deliberately NOT a typing-psychology guess (that
 * distinction is what keeps it from aging like the ≥2s-after-save
 * mitigation did). On a RECEIVING device the note's bytes change only when
 * Sync delivers a snapshot; deliveries are save-gated on the authoring side
 * (a save fires ~2s after a typing pause) plus network latency, so
 * consecutive deliveries during active cross-device composition arrive
 * seconds apart. A confirming look must be far enough from the first to
 * STRADDLE a delivery, or it re-reads the same frozen snapshot and confirms
 * nothing; 10s covers a save-plus-ship round with margin.
 */
export const STAMP_SETTLE_FLOOR_MS = 10_000;

/**
 * Split a stamp plan into entries whose lines have SETTLED — observed with
 * byte-identical content on an earlier pass at least STAMP_SETTLE_FLOOR_MS
 * ago — and entries to defer until they do. The gate against the
 * CROSS-DEVICE ARM of premature identity assignment (§3.10's seventh
 * lesson, the 2026-08-31 "13: ^dg-q6wlym0v" incident).
 *
 * What happened: the cursor gate above is LOCAL by construction — device B
 * cannot see the cursor on device A. Obsidian Sync ships mid-composition
 * snapshots at seconds cadence, so B received the three-keystroke fragment
 * "13:", found it closed/clean/cursorless — every local rule satisfied —
 * and minted identity for it; the stamped write synced back into A's dirty
 * buffer, where Obsidian's auto-merge spliced the token into the WRONG
 * line (a fuzzy "13:" context match). "Clean and cursorless on B" is
 * anti-correlated with "finished on A" during active cross-device typing —
 * the fifth lesson's proxy critique, verbatim, with the real condition now
 * unreadable in principle rather than merely unread. Only reachable once
 * the whole fleet ran stamping-armed simultaneously, which 2026-08-31 was
 * the first morning of.
 *
 * THE RULE is evidence, not cooldown, in two halves that are BOTH load-
 * bearing:
 *   • BYTE-IDENTITY: a line is settled only when re-observed with exactly
 *     the bytes recorded earlier — the identity requirement is what makes
 *     the waiting evidence about the line rather than a timer about the
 *     clock. Any change re-records and restarts the wait.
 *   • THE FLOOR: the confirming look counts only ≥ STAMP_SETTLE_FLOOR_MS
 *     after the first record. Without it the rule is vacuous on a receiving
 *     device: between Sync deliveries the file is FROZEN, so the deferral
 *     re-arm loop (2s) re-reads identical bytes trivially — a pure
 *     "unchanged across two looks" rule replays the incident at +4s
 *     instead of +2s, confirming Sync's delivery quantization, not the
 *     line. (The frozen-bytes trace that ruled out observation-counting
 *     alone.)
 *
 * SCOPE (the wiring's decision, recorded here): the hold applies only in
 * the RECEIVING posture — note closed, or open without editor focus. Where
 * this device holds the live composition surface, the cursor gate and the
 * buffer-vs-disk dirty check are strictly better evidence and already
 * ruled; that path is untouched, so the authoring device stamps seconds
 * after the cursor leaves the line, exactly as before. The ten seconds
 * lands only on devices nobody is typing at, whose imports are poll-paced
 * anyway. Felt latency: none.
 *
 * STARVATION SHAPES, recorded honestly:
 *   • A line some tool rewrites continuously (an auto-updating timestamp
 *     inside a task line) never settles — and per ruling 7 it defers the
 *     whole note's OBSERVATION with it, indefinitely. Same acceptance as
 *     the cursor gate's residual, with the bound being "the line stops
 *     changing" instead of "the human moves the cursor"; visible in the
 *     console if it ever occurs.
 *   • The tail no finite floor closes: a mid-word pause that ships a
 *     fragment, followed by MORE than the floor of continuous typing
 *     (Obsidian defers saves during sustained typing), keeps a receiving
 *     device frozen past any T. The floor under that tail is the
 *     ^dg--anywhere containment — demonstrated working in the incident
 *     itself: the corrupted line is inert, visible, and non-compounding.
 *
 * Pure. State is the caller's, MEMORY-ONLY by design (nothing rides
 * data.json — no Obsidian Sync churn; a plugin reload restarts in-flight
 * holds, which errs conservative): a Map of line content → firstSeenMs for
 * one note. The returned nextState is PRUNED to lines still in the plan,
 * so stamped and deleted lines shed their entries every pass and the map
 * is bounded by the note's untagged-line count (normally zero to a few).
 *
 * @param {Array<{line: number}>} plan  planStampInsertions output
 * @param {string[]} lines  the note content split on '\n' (the same text
 *   the plan was computed from — keys are the EXACT line bytes)
 * @param {Map<string, number>|null|undefined} prior  contentKey → firstSeenMs
 * @param {number} nowMs
 * @returns {{ apply: Array<object>, deferred: Array<object>, nextState: Map<string, number> }}
 */
export function settleStampPlan(plan, lines, prior, nowMs) {
  const apply = [];
  const deferred = [];
  const nextState = new Map();
  for (const p of plan || []) {
    const key = String(lines[p.line] ?? '');
    const firstSeen = prior instanceof Map ? prior.get(key) : undefined;
    if (typeof firstSeen === 'number' && nowMs - firstSeen >= STAMP_SETTLE_FLOOR_MS) {
      apply.push(p);
      continue;
    }
    deferred.push(p);
    nextState.set(key, typeof firstSeen === 'number' ? firstSeen : nowMs);
  }
  return { apply, deferred, nextState };
}

export { taskLineSortKey, sortTaskLinesInSection, buildObsidianTaskLine, parseLeadingTime, buildTimePrefix, stripLinePrefixes };
