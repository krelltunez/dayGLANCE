import React from 'react';

// URL detection regex for notes
export const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

// Check if entire text is just a URL (with optional whitespace)
export const isOnlyUrl = (text) => {
  if (!text) return false;
  const trimmed = text.trim();
  const match = trimmed.match(URL_REGEX);
  return match && match.length === 1 && match[0] === trimmed;
};

// Render formatted text with URLs, **bold**, *italic*, __underline__
export const renderFormattedText = (text) => {
  if (!text) return null;

  let gk = 0; // global key counter

  // Inline formatting: `code`, **bold**, *italic*, __underline__, URLs
  const renderInline = (str) => {
    if (!str) return null;
    const parts = [];
    let last = 0;
    const re = /(`([^`]+)`)|\*\*(.+?)\*\*|\*(.+?)\*|__(.+?)__|(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
    let m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      if (m[1]) {
        // `inline code`
        parts.push(<code key={gk++} className="px-1 py-0.5 rounded text-[0.85em] font-mono" style={{ background: 'rgba(128,128,128,0.18)' }}>{m[2]}</code>);
      } else if (m[3]) {
        parts.push(<strong key={gk++}>{m[3]}</strong>);
      } else if (m[4]) {
        parts.push(<em key={gk++}>{m[4]}</em>);
      } else if (m[5]) {
        parts.push(<span key={gk++} className="underline">{m[5]}</span>);
      } else if (m[6]) {
        parts.push(
          <a key={gk++} href={m[6]} target="_blank" rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline break-all"
            onClick={(e) => e.stopPropagation()}
          >{m[6]}</a>
        );
      }
      last = m.index + m[0].length;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts;
  };

  const out = [];

  // Split fenced code blocks from regular text
  const cbRe = /```(?:\w*)\n?([\s\S]*?)```/g;
  let cbLast = 0;
  const segments = [];
  let cbm;
  while ((cbm = cbRe.exec(text)) !== null) {
    if (cbm.index > cbLast) segments.push({ type: 't', c: text.slice(cbLast, cbm.index) });
    segments.push({ type: 'cb', c: cbm[1] });
    cbLast = cbm.index + cbm[0].length;
  }
  if (cbLast < text.length) segments.push({ type: 't', c: text.slice(cbLast) });

  for (const seg of segments) {
    if (seg.type === 'cb') {
      out.push(
        <pre key={gk++} className="rounded px-2.5 py-2 text-xs font-mono overflow-x-auto my-1" style={{ background: 'rgba(128,128,128,0.18)' }}>
          <code>{seg.c}</code>
        </pre>
      );
      continue;
    }

    const lines = seg.c.split('\n');
    for (const line of lines) {
      // Header: # through ######
      const hm = line.match(/^(#{1,6})\s+(.+)$/);
      if (hm) {
        const lvl = hm[1].length;
        const cls = lvl === 1 ? 'text-lg font-bold' : lvl === 2 ? 'text-base font-semibold' : lvl === 3 ? 'font-semibold' : 'font-medium opacity-80';
        out.push(<div key={gk++} className={`${cls} mt-1.5 mb-0.5`}>{renderInline(hm[2])}</div>);
        continue;
      }

      // Checkbox: - [ ] or - [x]
      const ckm = line.match(/^\s*- \[([ xX])\]\s+(.+)$/);
      if (ckm) {
        const checked = ckm[1] !== ' ';
        out.push(
          <div key={gk++} className="flex items-start gap-1.5 py-px">
            <span className={`inline-flex items-center justify-center w-3.5 h-3.5 mt-[3px] rounded-sm border flex-shrink-0 text-[10px] leading-none ${checked ? 'bg-purple-500/30 border-purple-400' : 'border-current opacity-40'}`}>
              {checked && '✓'}
            </span>
            <span className={checked ? 'line-through opacity-60' : ''}>{renderInline(ckm[2])}</span>
          </div>
        );
        continue;
      }

      // Bullet: - or * followed by space and text
      const bm = line.match(/^\s*[-*]\s+(.+)$/);
      if (bm) {
        out.push(
          <div key={gk++} className="flex items-start gap-1.5 py-px">
            <span className="mt-[7px] w-1 h-1 rounded-full bg-current opacity-40 flex-shrink-0" />
            <span>{renderInline(bm[1])}</span>
          </div>
        );
        continue;
      }

      // Blank line
      if (!line.trim()) {
        out.push(<div key={gk++} className="h-1.5" />);
        continue;
      }

      // Regular text line
      out.push(<div key={gk++}>{renderInline(line)}</div>);
    }
  }

  return out;
};

// Check if task has any notes or subtasks
export const hasNotesOrSubtasks = (task) => {
  return (task.notes && task.notes.trim()) || (task.subtasks && task.subtasks.length > 0);
};

// Check if task has only a link (note is URL-only, no subtasks)
export const isLinkOnlyTask = (task) => {
  if (task.subtasks && task.subtasks.length > 0) return false;
  return isOnlyUrl(task.notes);
};

// Get the link URL from a link-only task
export const getLinkUrl = (task) => {
  return task.notes?.trim() || null;
};

// Given shared text (from Android share sheet or web share target), extract a human-readable
// title and move any URL to notes so the link action button appears on the task.
//
// Handles two forms:
//   "Page Title https://example.com/path"  →  title="Page Title", notes="https://..."
//   "https://example.com/path"             →  title="example.com", notes="https://..."
//
// Returns { title, notes } — notes may be empty string if no URL was found.
export const extractShareTitle = (text) => {
  if (!text) return { title: text || '', notes: '' };
  const trimmed = text.trim();

  // Single URL regex (non-global, for full-string match)
  const urlRe = /https?:\/\/[^\s<>"{}|\\^`[\]]+/;

  // Case 1: entire string is a URL — derive title from hostname
  if (isOnlyUrl(trimmed)) {
    let hostname = trimmed;
    try { hostname = new URL(trimmed).hostname.replace(/^www\./, ''); } catch (_) {}
    return { title: hostname, notes: trimmed };
  }

  // Case 2: string ends with a URL preceded by non-URL text
  const trailingUrl = /^([\s\S]+?)\s+(https?:\/\/[^\s<>"{}|\\^`[\]]+)$/.exec(trimmed);
  if (trailingUrl) {
    const beforeUrl = trailingUrl[1].trim();
    const url = trailingUrl[2];
    // Only split if the part before the URL isn't itself a URL
    if (beforeUrl && !urlRe.test(beforeUrl)) {
      return { title: beforeUrl, notes: url };
    }
  }

  return { title: trimmed, notes: '' };
};

// Check if task has only subtasks (no notes)
export const hasOnlySubtasks = (task) => {
  return (!task.notes || !task.notes.trim()) && task.subtasks && task.subtasks.length > 0;
};

// Strip wikilinks from displayed text; style hashtags
export const renderTitle = (title) => {
  const stripped = title.replace(/\[\[[^\]]+\]\]/g, '');
  const parts = stripped.split(/(#[a-zA-Z]\w*)/g);
  return parts.map((part, i) => {
    if (part.match(/^#[a-zA-Z]\w*$/)) {
      return <span key={i} className="text-xs italic opacity-75">{part}</span>;
    }
    return part;
  });
};

export const highlightMatch = (text, query) => {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  // Truncate long text (e.g. notes) to ±30 chars around the match
  let display = text;
  let matchIdx = idx;
  if (text.length > 80) {
    const start = Math.max(0, idx - 30);
    const end = Math.min(text.length, idx + query.length + 30);
    display = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    matchIdx = idx - start + (start > 0 ? 1 : 0);
  }
  return (
    <span>
      {display.slice(0, matchIdx)}
      <span className="font-bold text-blue-500">{display.slice(matchIdx, matchIdx + query.length)}</span>
      {display.slice(matchIdx + query.length)}
    </span>
  );
};

// Remove wikilinks AND hashtags (used for AI context only)
export const renderTitleWithoutTags = (title) => {
  return title.replace(/\[\[[^\]]+\]\]/g, '').replace(/#[a-zA-Z]\w*/g, '').replace(/\s+/g, ' ').trim();
};
