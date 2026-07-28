// Deterministic voice-transcript → task parsing. No AI required.
//
// Turns a spoken/typed utterance ("remind me to call mom tomorrow at 3 p.m.")
// into the same parsed-task shape the AI voice parser produces, using the
// deterministic quickAddParser. Used whenever no AI provider is configured for
// parsing, and as the fallback when the AI parse call fails.
//
// v1 scope (documented, deliberate):
// - ONE task per utterance. No multi-task splitting ("...and..." is ambiguous
//   without a language model) and no edit commands ("mark X done") — those
//   remain AI-only features.
// - English vocabulary, matching quickAddParser.

import { parseQuickAdd, stripSpans } from './quickAddParser.js';

const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Spoken lead-ins to discard: "add a task to", "remind me to", "new task",
// "create a task called" … Only stripped at the very start of the utterance.
const LEAD_IN_RE = /^\s*(?:please\s+)?(?:(?:add|create|make)\s+(?:a\s+)?(?:new\s+)?task(?:\s+(?:to|called|named|for))?|remind\s+me\s+to|remember\s+to|new\s+task|task)\b[:,]?\s+/i;

/**
 * Normalize common speech-to-text artifacts so the deterministic parser sees
 * the vocabulary it expects:
 * - "3 p.m." / "3 P.M." → "3 pm"    (dotted meridiems break \b matching)
 * - "hashtag work" / "hash tag work" → "#work"
 * - trailing sentence punctuation from STT engines
 */
export const normalizeTranscript = (text) => {
  return text
    .replace(/\b([ap])\.m\.?/gi, (_, letter) => `${letter.toLowerCase()}m`)
    .replace(/\bhash\s?tag\s+([a-zA-Z]\w*)/gi, '#$1')
    .replace(/[.!?]+\s*$/, '')
    .trim();
};

/**
 * Parse a transcript into an array of parsed-task objects matching the AI
 * voice parser's shape: { title, tags, date, time, duration, priority,
 * deadline, notes, recurrence? }. Always returns exactly one task (v1).
 *
 * Voice-specific defaults on top of quickAddParser:
 * - a time with no date anchors to today ("call mom at 3pm" = today)
 * - a recurrence with no date anchors its start to today
 *
 * @param {string} text  Raw transcript.
 * @param {object} [opts]
 * @param {Date}   [opts.now]  Clock injection for tests.
 */
export const parseTranscriptTasks = (text, { now = new Date() } = {}) => {
  const normalized = normalizeTranscript(text || '');
  if (!normalized) return [];

  const stripped = normalized.replace(LEAD_IN_RE, '');
  const body = stripped.trim() ? stripped : normalized;

  const { spans } = parseQuickAdd(body, { now });
  const bySpanType = (t) => spans.find((s) => s.type === t);
  const dateSpan = bySpanType('date');
  const timeSpan = bySpanType('time');
  const rangeSpan = bySpanType('timerange');
  const durSpan = bySpanType('duration');
  const recSpan = bySpanType('recurrence');
  const tags = spans.filter((s) => s.type === 'tag').map((s) => s.value);

  const todayStr = toDateStr(new Date(now));

  let date = dateSpan ? dateSpan.value : null;
  let time = null;
  let duration = 30;
  if (rangeSpan) {
    time = rangeSpan.value.startTime;
    duration = rangeSpan.value.duration;
  }
  if (timeSpan) time = timeSpan.value;
  if (!time) {
    const implied = dateSpan?.impliedTime || recSpan?.impliedTime;
    if (implied) time = implied;
  }
  if (durSpan) duration = durSpan.value;

  // A concrete time with no date means today; a recurrence needs a start date.
  if (!date && (time || recSpan)) date = todayStr;

  // Title: strip every parsed phrase, tags included (they're re-applied from
  // the tags array). Fall back to the whole utterance if stripping ate it all.
  let title = stripSpans(body, spans, { includeTags: true });
  if (!title) title = body;
  title = title.charAt(0).toUpperCase() + title.slice(1);

  const task = {
    title,
    tags,
    date,
    time,
    duration,
    priority: 0,
    deadline: null,
    notes: '',
  };
  if (recSpan) {
    task.recurrence = recSpan.value;
    task.recurrenceDisplay = recSpan.display;
  }
  return [task];
};
