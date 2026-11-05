// A stored stamp in the MCP wire form (#2135). Formerly wireStamp in the app's
// src/utils/taskMetadata.js; parseStamp, which reads the three forms a stamp
// has been written in, is agenda-core's.

import { parseStamp } from '@glance-apps/agenda-core';
// The dates module itself, not the kit's root: the root also carries the HTTP
// listener (node:http), which a browser bundle of the read model cannot load.
import { localDateOf, localMinutesOf } from '@glance-apps/mcp-host/dates';

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * A stamp in the MCP wire convention (docs/mcp-tools-reference.md: dates and
 * times are local, no offsets, no timestamps): `{ date: 'YYYY-MM-DD', time:
 * 'HH:MM' | null }`, `time` null for a stamp that has none. Null when there is
 * no stamp to read.
 *
 * Local to what: without `timeZone`, this machine's clock, which is the
 * user's when the app answers. A host on a server passes the user's IANA zone,
 * so a completion at 23:30 UTC reads as the next morning in Auckland, as it
 * does on the user's own devices. A bare date is a calendar day in any zone.
 */
export function wireStamp(value, timeZone) {
  const parsed = parseStamp(value);
  if (!parsed) return null;
  const { date, hasTime } = parsed;
  if (timeZone && hasTime) {
    const minutes = localMinutesOf(date.getTime(), timeZone);
    return {
      date: localDateOf(date.getTime(), timeZone),
      time: `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`,
    };
  }
  return {
    date: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    time: hasTime ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}` : null,
  };
}
