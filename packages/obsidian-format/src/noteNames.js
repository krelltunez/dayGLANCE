// Note naming: daily-note filename patterns and the safe-date gate.
// Moved verbatim from dayGLANCE src/obsidian.js — format, never policy.

/** Reject date strings that aren't strictly YYYY-MM-DD to prevent path injection. */
function assertSafeDateStr(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Obsidian: invalid date string "${dateStr}"`);
  }
}

// ---------------------------------------------------------------------------
// Daily note filename pattern helpers
// Supports Java-style DateTimeFormatter tokens: yyyy, yy, MMMM, MMM, MM, M, dd, d
// This matches the subset understood by Android's native ObsidianRepository.
// ---------------------------------------------------------------------------

const DATE_MONTHS_FULL  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DATE_MONTHS_SHORT = DATE_MONTHS_FULL.map(m => m.slice(0, 3));
const DATE_TOKEN_RE     = /yyyy|yy|MMMM|MMM|MM|M|dd|d/g;

/**
 * Format a Date object into a daily note filename stem using a DateTimeFormatter-style pattern.
 * The default pattern "yyyy-MM-dd" produces "2026-04-05".
 */
export function formatDatePattern(date, pattern = 'yyyy-MM-dd') {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return pattern.replace(DATE_TOKEN_RE, (token) => {
    switch (token) {
      case 'yyyy': return y;
      case 'yy':   return String(y).slice(-2);
      case 'MMMM': return DATE_MONTHS_FULL[date.getMonth()];
      case 'MMM':  return DATE_MONTHS_SHORT[date.getMonth()];
      case 'MM':   return String(m).padStart(2, '0');
      case 'M':    return m;
      case 'dd':   return String(d).padStart(2, '0');
      case 'd':    return d;
      default:     return token;
    }
  });
}

/**
 * Build a parser object from a pattern string. Used to convert a daily note
 * filename back to a YYYY-MM-DD date string during vault sync.
 */
function buildDateParser(pattern) {
  const tokenOrder = [];
  const captureFor = { yyyy: '(\\d{4})', yy: '(\\d{2})', MMMM: '([A-Za-z]+)', MMM: '([A-Za-z]+)', MM: '(\\d{1,2})', M: '(\\d{1,2})', dd: '(\\d{1,2})', d: '(\\d{1,2})' };
  let regexStr = '^' + pattern.replace(DATE_TOKEN_RE, (t) => { tokenOrder.push(t); return captureFor[t]; }).replace(/[.+?^${}()|[\]\\]/g, (c) => (tokenOrder.length ? c : '\\' + c)) + '\\.md$';
  // Rebuild properly: escape literal parts only
  tokenOrder.length = 0;
  regexStr = '^';
  let lastIdx = 0;
  DATE_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = DATE_TOKEN_RE.exec(pattern)) !== null) {
    const lit = pattern.slice(lastIdx, m.index);
    if (lit) regexStr += lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regexStr += captureFor[m[0]];
    tokenOrder.push(m[0]);
    lastIdx = m.index + m[0].length;
  }
  const trailing = pattern.slice(lastIdx);
  if (trailing) regexStr += trailing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  regexStr += '\\.md$';
  return { regex: new RegExp(regexStr, 'i'), tokenOrder };
}

/**
 * Attempt to parse a daily note filename (e.g. "05-04-2026.md") back to
 * a YYYY-MM-DD string using the given parser. Returns null on failure.
 */
function parseDateFromFilename(filename, parser) {
  const match = parser.regex.exec(filename);
  if (!match) return null;
  let year, month, day;
  parser.tokenOrder.forEach((token, i) => {
    const val = match[i + 1];
    if (token === 'yyyy')       year  = parseInt(val, 10);
    else if (token === 'yy')    year  = 2000 + parseInt(val, 10);
    else if (token === 'MMMM')  month = DATE_MONTHS_FULL.findIndex(n => n.toLowerCase() === val.toLowerCase()) + 1;
    else if (token === 'MMM')   month = DATE_MONTHS_SHORT.findIndex(n => n.toLowerCase() === val.toLowerCase()) + 1;
    else if (token === 'MM' || token === 'M') month = parseInt(val, 10);
    else if (token === 'dd' || token === 'd') day   = parseInt(val, 10);
  });
  if (!year || !month || !day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Compute the filename (with .md) for a daily note given an internal YYYY-MM-DD
 * date string and an optional pattern. Returns e.g. "2026-04-05.md".
 */
function dailyNoteFilename(dateStr, pattern) {
  if (!pattern || pattern === 'yyyy-MM-dd') return `${dateStr}.md`;
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${formatDatePattern(new Date(y, m - 1, d), pattern)}.md`;
}

export { assertSafeDateStr, buildDateParser, parseDateFromFilename, dailyNoteFilename };
