// ICS/CalDAV parsing and expansion utilities.
//
// Extracted from App.jsx (see "App.jsx — Ongoing Decomposition" in CLAUDE.md).
// Everything here is pure data transformation with no React or UI dependency:
// parseICS turns a raw ICS feed into a flat list of occurrence objects (with
// RRULE expansion, EXDATE handling, and VEVENT RECURRENCE-ID overrides),
// parseDatetime converts ICS date/datetime strings to local Date objects, and
// expandMultiDayEvent/filterByDateWindow shape occurrences into dayGLANCE
// task objects.

import { dateToString } from './taskUtils.js';

export const parseICS = (icsContent) => {
  // Unfold iCal line continuations (RFC 5545: lines starting with space/tab are continuations)
  const rawLines = icsContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines = [];
  for (const raw of rawLines) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += raw.substring(1);
    } else {
      lines.push(raw.trim());
    }
  }
  const events = [];
  const overrides = []; // VEVENT RECURRENCE-ID single-instance exceptions (moved/cancelled)
  let currentEvent = null;
  let currentType = null; // 'event' or 'todo'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line === 'BEGIN:VEVENT') {
      currentEvent = {};
      currentType = 'event';
    } else if (line === 'BEGIN:VTODO') {
      currentEvent = {};
      currentType = 'todo';
    } else if ((line === 'END:VEVENT' || line === 'END:VTODO') && currentEvent) {
      // For VTODOs, use DUE as dtstart if no DTSTART present
      if (currentType === 'todo' && !currentEvent.dtstart && currentEvent.due) {
        currentEvent.dtstart = currentEvent.due;
        currentEvent.isAllDay = currentEvent.dueIsAllDay;
      }
      // RECURRENCE-ID overrides modify (move/cancel) a single occurrence of a
      // recurring series. For VTODOs we keep the long-standing behaviour of
      // dropping them — completion is tracked locally via completedTaskUids.
      // For VEVENTs we must NOT drop them blindly: moving or cancelling one
      // instance does not add an EXDATE to the master, so ignoring the override
      // leaves a phantom occurrence at the original slot. Collect VEVENT overrides
      // so expansion can suppress the master occurrence and re-place (or cancel) it.
      const isCancelled = currentType === 'event' && currentEvent.status === 'CANCELLED';
      if (currentType === 'event' && currentEvent.isRecurrenceOverride && currentEvent.recurrenceId && currentEvent.uid) {
        overrides.push(currentEvent);
      } else if (currentEvent.summary && currentEvent.dtstart && !currentEvent.isRecurrenceOverride && !isCancelled) {
        events.push(currentEvent);
      }
      currentEvent = null;
      currentType = null;
    } else if (currentEvent) {
      if (line.startsWith('SUMMARY')) {
        // Extract value after colon, handling parameters like SUMMARY;LANGUAGE=en:Text
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          // Unescape ICS escape sequences: \, -> , and \; -> ; and \\ -> \ and \n -> newline
          currentEvent.summary = line.substring(colonIdx + 1)
            .replace(/\\,/g, ',')
            .replace(/\\;/g, ';')
            .replace(/\\n/gi, '\n')
            .replace(/\\\\/g, '\\');
        }
      } else if (line.startsWith('DTSTART')) {
        // Detect all-day events (VALUE=DATE or 8-character date)
        if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
          currentEvent.isAllDay = true;
        }
        const dateStr = line.split(':')[1];
        currentEvent.dtstart = dateStr;
      } else if (line.startsWith('DTEND')) {
        const dateStr = line.split(':')[1];
        currentEvent.dtend = dateStr;
      } else if (line.startsWith('DUE')) {
        // Handle VTODO due dates
        if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
          currentEvent.dueIsAllDay = true;
        }
        const dateStr = line.split(':')[1];
        currentEvent.due = dateStr;
      } else if (line.startsWith('UID')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          currentEvent.uid = line.substring(colonIdx + 1);
        }
      } else if (line.startsWith('DESCRIPTION')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          currentEvent.description = line.substring(colonIdx + 1)
            .replace(/\\,/g, ',')
            .replace(/\\;/g, ';')
            .replace(/\\n/gi, '\n')
            .replace(/\\\\/g, '\\');
        }
      } else if (line.startsWith('RECURRENCE-ID')) {
        currentEvent.isRecurrenceOverride = true;
        // Capture the value (the original occurrence this override replaces),
        // handling parameters like RECURRENCE-ID;TZID=...:20260101T090000.
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) currentEvent.recurrenceId = line.substring(colonIdx + 1).trim();
      } else if (line.startsWith('STATUS')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) currentEvent.status = line.substring(colonIdx + 1).trim().toUpperCase();
      } else if (line.startsWith('RRULE:')) {
        currentEvent.rrule = line.substring(6);
      } else if (line.startsWith('EXDATE')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
          if (!currentEvent.exdates) currentEvent.exdates = [];
          const values = line.substring(colonIdx + 1).split(',');
          values.forEach(v => currentEvent.exdates.push(v.trim().substring(0, 8)));
        }
      }
    }
  }

  // Expand events with RRULE into individual occurrences
  const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const curYear = new Date().getFullYear();
  const expandedEvents = [];

  // Index VEVENT RECURRENCE-ID overrides by their series UID. Each override
  // suppresses the master's generated occurrence at the original slot (an
  // implicit EXDATE) and — unless STATUS:CANCELLED — is re-emitted at its new
  // DTSTART. Matching is date-level to mirror the EXDATE handling below.
  const overrideDatesByUid = {};
  const overrideEventsByUid = {};
  for (const ov of overrides) {
    if (!overrideDatesByUid[ov.uid]) overrideDatesByUid[ov.uid] = [];
    overrideDatesByUid[ov.uid].push(ov.recurrenceId.substring(0, 8));
    if (ov.status !== 'CANCELLED' && ov.summary && ov.dtstart) {
      if (!overrideEventsByUid[ov.uid]) overrideEventsByUid[ov.uid] = [];
      overrideEventsByUid[ov.uid].push(ov);
    }
  }

  for (const event of events) {
    if (!event.rrule) {
      expandedEvents.push(event);
      continue;
    }

    // Fold this series' RECURRENCE-ID override dates into its EXDATE set so the
    // master never emits a phantom occurrence at a moved or cancelled slot.
    if (event.uid && overrideDatesByUid[event.uid]) {
      event.exdates = [...(event.exdates || []), ...overrideDatesByUid[event.uid]];
    }

    const rule = {};
    event.rrule.split(';').forEach(part => {
      const eq = part.indexOf('=');
      if (eq !== -1) rule[part.substring(0, eq).trim().toUpperCase()] = part.substring(eq + 1).trim().toUpperCase();
    });

    // Common setup for all frequencies
    const dtstr = event.dtstart;
    const sYear = parseInt(dtstr.substring(0, 4));
    const sMonth = parseInt(dtstr.substring(4, 6)) - 1;
    const sDay = parseInt(dtstr.substring(6, 8));
    const interval = parseInt(rule.INTERVAL || '1');
    const count = rule.COUNT ? parseInt(rule.COUNT) : null;
    const untilDate = rule.UNTIL ? new Date(
      parseInt(rule.UNTIL.substring(0, 4)),
      parseInt(rule.UNTIL.substring(4, 6)) - 1,
      parseInt(rule.UNTIL.substring(6, 8))
    ) : null;

    // Duration in days for all-day events
    let durDays = 1;
    if (event.dtend && event.isAllDay) {
      const s = new Date(sYear, sMonth, sDay);
      const e = new Date(parseInt(event.dtend.substring(0, 4)), parseInt(event.dtend.substring(4, 6)) - 1, parseInt(event.dtend.substring(6, 8)));
      durDays = Math.max(1, Math.round((e - s) / 86400000));
    }

    const eventStart = new Date(sYear, sMonth, sDay);
    const now = new Date();
    // Expansion window for non-yearly: 1 year back to 1 year ahead
    const windowStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    const windowEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

    const isExcluded = (d) => {
      const s = fmt(d);
      return event.exdates && event.exdates.includes(s);
    };

    const pushOcc = (occDate) => {
      const occStr = fmt(occDate);
      const newDtstart = event.isAllDay ? occStr : occStr + 'T' + dtstr.substring(9);
      let newDtend = event.dtend;
      if (event.dtend && event.isAllDay) {
        const endD = new Date(occDate);
        endD.setDate(endD.getDate() + durDays);
        newDtend = fmt(endD);
      }
      expandedEvents.push({ ...event, dtstart: newDtstart, dtend: newDtend, rrule: undefined, isRecurringSeries: true });
    };

    if (rule.FREQ === 'YEARLY') {
      const byMonth = rule.BYMONTH ? parseInt(rule.BYMONTH) - 1 : sMonth;
      const byDay = rule.BYDAY || null;
      const maxYear = untilDate ? Math.min(untilDate.getFullYear(), curYear + 3) : curYear + 3;
      let occ = 0;

      for (let year = sYear; year <= maxYear; year += interval) {
        if (count && occ >= count) break;

        let occDate;
        if (byDay) {
          const m = byDay.match(/^(-?\d*)([A-Z]{2})$/);
          if (m && dayMap[m[2]] !== undefined) {
            const nth = m[1] ? parseInt(m[1]) : 1;
            const target = dayMap[m[2]];
            if (nth > 0) {
              const firstDow = new Date(year, byMonth, 1).getDay();
              occDate = new Date(year, byMonth, 1 + ((target - firstDow + 7) % 7) + (nth - 1) * 7);
            } else {
              const last = new Date(year, byMonth + 1, 0);
              occDate = new Date(year, byMonth, last.getDate() - ((last.getDay() - target + 7) % 7) + (nth + 1) * 7);
            }
          }
        } else {
          occDate = new Date(year, byMonth, sDay);
        }

        if (!occDate) continue;
        if (untilDate && occDate > untilDate) break;
        if (isExcluded(occDate)) continue;

        pushOcc(occDate);
        occ++;
      }
    } else if (rule.FREQ === 'MONTHLY') {
      const byDay = rule.BYDAY || null;
      const byMonthDay = rule.BYMONTHDAY ? parseInt(rule.BYMONTHDAY) : null;
      let occ = 0;
      let mDate = new Date(sYear, sMonth, 1);

      while (mDate <= windowEnd) {
        if (count && occ >= count) break;
        let occDate;

        if (byDay) {
          const m = byDay.match(/^(-?\d*)([A-Z]{2})$/);
          if (m && dayMap[m[2]] !== undefined) {
            const nth = m[1] ? parseInt(m[1]) : 1;
            const target = dayMap[m[2]];
            if (nth > 0) {
              const firstDow = new Date(mDate.getFullYear(), mDate.getMonth(), 1).getDay();
              occDate = new Date(mDate.getFullYear(), mDate.getMonth(), 1 + ((target - firstDow + 7) % 7) + (nth - 1) * 7);
            } else {
              const last = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0);
              occDate = new Date(mDate.getFullYear(), mDate.getMonth(), last.getDate() - ((last.getDay() - target + 7) % 7) + (nth + 1) * 7);
            }
          }
        } else {
          const day = byMonthDay || sDay;
          occDate = new Date(mDate.getFullYear(), mDate.getMonth(), day);
          // Handle months with fewer days (e.g., Jan 31 in Feb -> Feb 28)
          if (occDate.getMonth() !== mDate.getMonth()) {
            occDate = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0);
          }
        }

        if (occDate && occDate >= eventStart) {
          if (untilDate && occDate > untilDate) break;
          if (!isExcluded(occDate)) {
            if (occDate >= windowStart) pushOcc(occDate);
            occ++;
          }
        }
        mDate.setMonth(mDate.getMonth() + interval);
      }
    } else if (rule.FREQ === 'WEEKLY') {
      const byDays = rule.BYDAY
        ? rule.BYDAY.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined)
        : [eventStart.getDay()];
      let occ = 0;
      // Start from the Sunday of the week containing eventStart
      let weekStart = new Date(eventStart);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay());

      while (weekStart <= windowEnd) {
        for (const targetDay of byDays) {
          if (count && occ >= count) break;
          const d = new Date(weekStart);
          d.setDate(d.getDate() + targetDay);
          if (d < eventStart) continue;
          if (d > windowEnd) continue;
          if (untilDate && d > untilDate) break;
          if (!isExcluded(d)) {
            if (d >= windowStart) pushOcc(d);
            occ++;
          }
        }
        if (count && occ >= count) break;
        weekStart.setDate(weekStart.getDate() + 7 * interval);
      }
    } else if (rule.FREQ === 'DAILY') {
      let occ = 0;
      let d = new Date(eventStart);
      // Skip ahead efficiently when no COUNT limit
      if (!count && d < windowStart) {
        const intervalsToSkip = Math.floor((windowStart - d) / (86400000 * interval));
        d.setDate(d.getDate() + intervalsToSkip * interval);
      }
      while (d <= windowEnd) {
        if (count && occ >= count) break;
        if (untilDate && d > untilDate) break;
        if (d >= eventStart && !isExcluded(d)) {
          if (d >= windowStart) pushOcc(d);
          occ++;
        }
        d.setDate(d.getDate() + interval);
      }
    } else {
      // Unsupported frequency — keep the original event
      expandedEvents.push(event);
    }
  }

  // Append the moved/modified single instances at their new DTSTART. Cancelled
  // overrides were excluded above and intentionally produce no event.
  for (const uid of Object.keys(overrideEventsByUid)) {
    for (const ov of overrideEventsByUid[uid]) {
      expandedEvents.push({ ...ov, rrule: undefined });
    }
  }

  // Surface the set of master UIDs present in the raw feed (pre-expansion) so
  // callers can detect deleted recurring series. A live series can expand to zero
  // in-window occurrences, so its UID would be missing from expandedEvents — but
  // it is still here, in `events`, which is the authoritative "exists on server"
  // signal. Non-enumerable so it doesn't disturb callers that iterate the array.
  Object.defineProperty(expandedEvents, 'masterUids', {
    value: new Set(events.map(e => e.uid).filter(Boolean).map(String)),
    enumerable: false,
  });
  return expandedEvents;
};

export const parseDatetime = (dtstr) => {
  if (dtstr.length === 8) {
    return new Date(
      parseInt(dtstr.substr(0, 4)),
      parseInt(dtstr.substr(4, 2)) - 1,
      parseInt(dtstr.substr(6, 2))
    );
  } else if (dtstr.length >= 15) {
    // Z suffix means UTC — use Date.UTC so the browser converts to local time.
    // Without this, Google Calendar events (which are exported in UTC) display
    // at the UTC hour rather than the user's local hour.
    if (dtstr.endsWith('Z')) {
      return new Date(Date.UTC(
        parseInt(dtstr.substr(0, 4)),
        parseInt(dtstr.substr(4, 2)) - 1,
        parseInt(dtstr.substr(6, 2)),
        parseInt(dtstr.substr(9, 2)),
        parseInt(dtstr.substr(11, 2))
      ));
    }
    return new Date(
      parseInt(dtstr.substr(0, 4)),
      parseInt(dtstr.substr(4, 2)) - 1,
      parseInt(dtstr.substr(6, 2)),
      parseInt(dtstr.substr(9, 2)),
      parseInt(dtstr.substr(11, 2))
    );
  }
  return new Date();
};

// Filter imported tasks to a date window: keep events from (today - retentionDays) onward.
// retentionDays=0 means keep all events (no filtering).
export const filterByDateWindow = (importedTasks, retentionDays) => {
  if (!retentionDays || retentionDays <= 0) return importedTasks;
  const today = new Date();
  const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - retentionDays);
  const cutoffStr = dateToString(cutoff);
  return importedTasks.filter(t => t.date >= cutoffStr);
};

// Helper to expand multi-day events into separate tasks for each day
export const expandMultiDayEvent = (event, options = {}) => {
  const { asTaskCalendar = false, freshCompletedUids = new Set(), color: customColor, importSource = 'sync' } = options;
  const startDate = parseDatetime(event.dtstart);
  const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
  const duration = Math.round((endDate - startDate) / (1000 * 60));

  const isAllDay = event.isAllDay ||
    (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

  // Calculate number of days this event spans
  const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  // For all-day events, DTEND is exclusive (event on Jan 1-3 has DTEND of Jan 4)
  const dayCount = isAllDay
    ? Math.max(1, Math.round((endDateOnly - startDateOnly) / (1000 * 60 * 60 * 24)))
    : 1;

  const tasks = [];
  for (let i = 0; i < dayCount; i++) {
    const taskDate = new Date(startDateOnly);
    taskDate.setDate(taskDate.getDate() + i);

    const baseId = event.uid || `imported-${Date.now()}-${Math.random()}`;
    const dateStr = dateToString(taskDate);
    const taskId = dayCount > 1 ? `${baseId}-${dateStr}-day${i + 1}` : `${baseId}-${dateStr}`;

    // Add day indicator for multi-day events
    const titleSuffix = dayCount > 1 ? ` (Day ${i + 1}/${dayCount})` : '';

    tasks.push({
      id: taskId,
      icalUid: event.uid,
      title: event.summary + titleSuffix,
      startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
      duration: isAllDay ? 60 : (asTaskCalendar ? 15 : (duration > 0 ? duration : 60)),
      date: dateToString(taskDate),
      color: asTaskCalendar ? 'task-calendar' : (customColor || 'bg-gray-600'),
      completed: asTaskCalendar ? freshCompletedUids.has(event.uid + '::' + dateToString(taskDate)) : false,
      imported: true,
      isTaskCalendar: asTaskCalendar,
      isAllDay: isAllDay,
      isRecurringSeries: !!event.isRecurringSeries,
      importSource: importSource,
      ...(event.description ? { notes: event.description } : {})
    });
  }

  return tasks;
};
