// Reading the stamps a task row carries (#2135): `createdAt`, stamped by the
// app's persist pass, and `completedAt`, stamped by every completion path.
// Formerly in the app's src/utils/taskMetadata.js; here because the MCP read
// surface (@glance-apps/dayglance-mcp) reports the same stamps the app shows.

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A stored stamp as a Date plus whether it carries a time. `completedAt` has
 * been written three ways over the years: local-offset ISO (completionTimestamp),
 * UTC ISO (intents, the launcher) and, in old data, a bare YYYY-MM-DD. A bare
 * date is read as that LOCAL calendar day: `new Date('2026-10-19')` would be
 * UTC midnight, which is the day before anywhere west of Greenwich.
 */
export function parseStamp(value) {
  if (typeof value !== 'string' || !value) return null;
  if (BARE_DATE.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return { date: new Date(y, m - 1, d, 12), hasTime: false };
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  return { date: new Date(ms), hasTime: true };
}
