// BRIDGE INTENT STREAM — wire format and pure application
// (Obsidian build-out Phase 6; spec §3.6 as amended and §3.4).
//
// Format, never policy: this module defines WHAT rides the stream — the
// sealed row envelope, the intent and observation shapes, and how an intent
// applies to a file's text — and nothing about WHEN to emit, who is
// authoritative, or what wins on divergence. Those live with the consumers.
//
// THE STREAM (spec §3.6, amended): semantic OUTBOUND, observational
// INBOUND. dayGLANCE emits semantic intents (it knows exactly what changed);
// the plugin applies them to the vault and emits back plain observations of
// file state (inferring semantics from vault edits is the job dayGLANCE's
// scan-and-merge pipeline already does). Rows live in the app-scoped
// GLANCEvault namespace BRIDGE_VAULT_APP — fully separate from dayGLANCE's
// own sync rows.
//
// ROW ENVELOPES are AES-256-GCM under the bridge subkey (§3.4) with a fresh
// per-message IV: {v:1, iv, ct}, all base64. One deliberate exception: the
// PAIRING_META row is PLAINTEXT JSON — it carries the pairing salt that
// other dayGLANCE devices need BEFORE they can derive the subkey (an HKDF
// salt is not a secret; the subkey's security rests on the root key).
//
// INTENT payloads (sealed): { v:1, kind:'intent', type, intentId, createdAt,
// ...fields }. intentId is assigned AT WRITE TIME by the emitter and
// persisted with the queued intent — the GLANCEintents transitionId lesson:
// an id minted late doesn't survive the transport. Types:
//   task_state       {path, date, obsidianRawTitle, completed, startTime,
//                     duration, targetDate?, taskHeading, blockId,
//                     completedAt, completionFormat}
//   task_retitle     task_state fields + newRawTitle (a retitle write also
//                     carries the state — one write, one intent)
//   task_append      {path, date, task:{title,startTime,duration,isAllDay,
//                     date,blockId}, heading, template}
//   daily_note_write {path, content}
//   wiki_note_write  {noteName, content, newNotesFolder}
// `path` is always vault-root-relative and resolved BY THE EMITTER (the
// emitter owns the dailyNotesPath/pattern config; the applier needs no
// dayGLANCE settings). wiki_note_write is the one type without a resolved
// path: wikilink resolution ("an existing note anywhere in the vault wins")
// requires the vault index, so the APPLIER resolves it — Obsidian's
// metadataCache is exactly that index.
//
// OBSERVATION payloads (sealed): { v:1, kind:'observation', path,
// content|null, deleted?, mtime, observedAt }. One row per path, upserted
// (entityId from observationEntityId), so the row IS the latest state.
//
// APPLYING IS A PURE FUNCTION of (current file text, intent) — the spec's
// convergence requirement. It is also IDEMPOTENT: applying an intent to a
// file that already carries its outcome changes nothing. Idempotent replay
// is the crash story — an applier that dies between applying a batch and
// persisting its applied-ID set simply re-applies as no-ops.

import { updateTaskLines, sortTaskLinesInSection, buildObsidianTaskLine } from './taskLines.js';
import { withCreationFrontmatter } from './frontmatter.js';
import { validateWikiNoteName } from './filename.js';

// The GLANCEvault app namespace for everything the bridge stores.
export const BRIDGE_VAULT_APP = 'dayglance-bridge';
// Well-known rows. meta:pairing is written by the plugin on pairing (the
// one plaintext row — see above); meta:config is written by dayGLANCE so
// the plugin can classify daily notes without knowing dayGLANCE settings.
export const BRIDGE_PAIRING_META_ID = 'meta:pairing';
export const BRIDGE_CONFIG_META_ID = 'meta:config';
export const BRIDGE_INTENT_PREFIX = 'int:';
export const BRIDGE_OBSERVATION_PREFIX = 'obs:';

const enc = new TextEncoder();
// Chunked bytes→base64: String.fromCharCode(...bytes) blows the argument
// limit (~64k) on large payloads, and an observation carries a whole note.
const b64 = (bytes) => {
  const u8 = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64Text = (s) => b64(enc.encode(s));
const unb64Text = (t) => new TextDecoder().decode(unb64(t));

/** Assigned at write time, persisted with the intent. */
/**
 * The FAIL-CLOSED gate for normalize-then-observe (§3.10 ruling 7): the
 * plugin stamps untagged task lines before reporting a daily note ONLY when
 * the config row dayGLANCE published carries `blockIdWrites` EXACTLY true.
 * Everything else — no config row seen yet (null/undefined), a row from a
 * dayGLANCE build predating the field, an explicit false, any merely-truthy
 * value — means NO stamping: not stamping is recoverable (dayGLANCE's own
 * stamp-on-sight backstop still covers the line), stamping against the
 * user's write-release setting is not. Kept here, beside the row codec, so
 * the decision is one pinned function rather than an inline comparison that
 * could drift.
 *
 * @param {{blockIdWrites?: unknown}|null|undefined} config  the decoded meta:config row
 * @returns {boolean}
 */
export function bridgeConfigAllowsStamping(config) {
  return config != null && config.blockIdWrites === true;
}

export function mintIntentId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `dgi-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Stable row id for a path's observation: obs:<sha256 hex, 32 chars>. */
export async function observationEntityId(path) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(path));
  const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${BRIDGE_OBSERVATION_PREFIX}${hex.slice(0, 32)}`;
}

// THE WIRE IS BASE64, NON-NEGOTIABLY: GLANCEvault's batch endpoint decodes
// every row envelope with Buffer.from(envelope, 'base64') and stores the
// BYTES, and list/get returns those bytes re-encoded as base64. Node's
// base64 decoder never rejects — a non-base64 envelope (the first shape of
// this module was raw JSON text) is silently shredded into garbage at
// write time. So every envelope this module produces is a single valid
// base64 string, and every reader decodes base64 first; the server round
// trip is then byte-exact identity (pinned in the tests against the
// server's exact Buffer semantics).

/** Seal a payload into a row envelope under the bridge subkey. */
export async function sealBridgeEnvelope(subkey, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, subkey, enc.encode(JSON.stringify(payload)),
  );
  return b64Text(JSON.stringify({ v: 1, iv: b64(iv), ct: b64(ct) }));
}

/**
 * Open a row envelope. Returns the payload, or null for ANYTHING unusable —
 * malformed, tampered, or sealed under a different subkey generation (a
 * revoked pairing's rows correctly become unreadable after rotation).
 */
export async function openBridgeEnvelope(subkey, text) {
  try {
    const envelope = JSON.parse(unb64Text(text));
    if (!envelope || envelope.v !== 1) return null;
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(envelope.iv) }, subkey, unb64(envelope.ct),
    );
    return JSON.parse(new TextDecoder().decode(pt));
  } catch {
    return null;
  }
}

/**
 * Wire-encode a PLAINTEXT row (the meta:pairing row — deliberately not
 * encrypted, see the module header; the salt it carries is not a secret).
 * Base64 is transport framing here, not protection.
 */
export function encodePlainBridgeRow(payload) {
  return b64Text(JSON.stringify(payload));
}

/** Decode a plaintext row; null for anything unusable. */
export function decodePlainBridgeRow(text) {
  try {
    return JSON.parse(unb64Text(text));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure intent application
// ---------------------------------------------------------------------------

/**
 * Apply one intent to a file's current text. PURE and IDEMPOTENT (see the
 * module header — this is the convergence contract).
 *
 * @param {string|null} currentText — the target file's text, or null when
 *   the file does not exist.
 * @param {object} intent — a decrypted intent payload.
 * @returns {{ text: string|null, changed: boolean }
 *          |{ error: 'unportable_name', reason: string }
 *          |{ unsupported: true }}
 *   `changed` false means the file already carries the outcome (or there is
 *   nothing to apply to); `text` is the full new content when changed.
 *   `unsupported` marks a type this build doesn't know — the applier skips
 *   it without failing the batch (forward compatibility).
 */
export function applyBridgeIntent(currentText, intent) {
  switch (intent?.type) {
    case 'task_state':
    case 'task_retitle': {
      // Mirrors writeTaskStateToFile's composition: a missing file is the
      // benign nothing-to-update case (the scan reconciles); a line that
      // moved off obsidianRawTitle keeps ITS title (updateTaskLines'
      // built-in guard). FORMAT/POLICY SEAM: no onTitleConflict callback is
      // passed here — the applier is a transport, and conflict RESOLUTION
      // stays with dayGLANCE's scan-time policy, which sees the resulting
      // line like any other vault edit.
      if (currentText === null) return { text: null, changed: false };
      const lines = currentText.split('\n');
      const updated = updateTaskLines(lines, {
        obsidianRawTitle: intent.obsidianRawTitle,
        completed: intent.completed,
        startTime: intent.startTime ?? null,
        newRawTitle: intent.type === 'task_retitle' ? intent.newRawTitle : undefined,
        duration: intent.duration ?? null,
        targetDate: intent.targetDate ?? undefined,
        blockId: intent.blockId ?? null,
        onTitleConflict: null,
        completedAt: intent.completedAt ?? null,
        completionFormat: intent.completionFormat ?? null,
      });
      if (!updated) return { text: currentText, changed: false };
      const finalLines = intent.taskHeading
        ? sortTaskLinesInSection(lines, intent.taskHeading.trim(), intent.date)
        : lines;
      const text = finalLines.join('\n');
      return { text, changed: text !== currentText };
    }

    case 'task_append': {
      // Mirrors appendTaskToDailyNote's composition, plus the idempotency
      // guard the transport gets for free from being called once: a line
      // already carrying the task's block id (or the exact line, for a
      // tokenless task) means this intent has landed — replay is a no-op.
      const taskLine = buildObsidianTaskLine(intent.task, intent.date);
      if (currentText !== null) {
        const existingLines = currentText.split('\n');
        // Block ids are stored bare; the vault token is ^dg-<id> (identity.js).
        // THE REAL CONDITION is whether the line WE WOULD WRITE carries the
        // token (audit fix H3): buildObsidianTaskLine routes the token
        // through blockIdSuffix, which REFUSES it for titles carrying ^dg-
        // anywhere or ending in a foreign ^ref — so keying the landed-check
        // on intent.task.blockId alone made replays of such appends
        // non-idempotent: the appended line never carried the token, the
        // token check never matched, the exact-line fallback was skipped,
        // and every crash-replay appended the line AGAIN — breaking the
        // module contract ("dying between applying a batch and persisting
        // the applied-ID set replays as no-ops") in exactly the scenario it
        // exists for. Token comparisons also tolerate trailing whitespace a
        // human may have left on the landed line.
        const blockToken = intent.task?.blockId && taskLine.endsWith(` ^dg-${intent.task.blockId}`)
          ? ` ^dg-${intent.task.blockId}`
          : null;
        const landed = blockToken
          ? existingLines.some((l) => l.trimEnd().endsWith(blockToken))
          : existingLines.some((l) => l.trimEnd() === taskLine.trimEnd());
        if (landed) return { text: currentText, changed: false };
      }
      const base = currentText !== null
        ? currentText
        : withCreationFrontmatter(intent.template || '', intent.date);
      const lines = base.split('\n');
      const heading = intent.heading;
      if (heading && heading.trim()) {
        const headingStr = heading.trim();
        const headingLineIdx = lines.findIndex((l) => l === headingStr);
        if (headingLineIdx !== -1) {
          lines.splice(headingLineIdx + 1, 0, taskLine);
        } else {
          if (lines[lines.length - 1] !== '') lines.push('');
          lines.push(headingStr, taskLine, '');
        }
      } else {
        if (lines[lines.length - 1] !== '') lines.push('');
        lines.push(taskLine);
      }
      const sorted = heading && heading.trim()
        ? sortTaskLinesInSection(lines, heading.trim(), intent.date)
        : lines;
      return { text: sorted.join('\n'), changed: true };
    }

    case 'daily_note_write': {
      const text = intent.content ?? '';
      return { text, changed: currentText === null || text !== currentText };
    }

    case 'wiki_note_write': {
      // Creation-only decoration and the creation-only portability gate —
      // the same refuse-creation/permit-existing rule as writeWikiNote. The
      // APPLIER resolves the wikilink (existing note anywhere in the vault
      // wins; otherwise create under intent.newNotesFolder) and passes that
      // file's text, or null when creating.
      if (currentText === null) {
        const reason = validateWikiNoteName(intent.noteName);
        if (reason) return { error: 'unportable_name', reason };
        return { text: withCreationFrontmatter(intent.content), changed: true };
      }
      const text = intent.content;
      return { text, changed: text !== currentText };
    }

    default:
      return { unsupported: true };
  }
}
