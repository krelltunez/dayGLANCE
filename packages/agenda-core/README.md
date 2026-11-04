# @glance-apps/agenda-core

The dayGLANCE **agenda core**, shared verbatim by the dayGLANCE app and the
dayglance-bridge Obsidian plugin. The plugin's agenda sidebar shows the same
day the app does because both build it with this code: a recurring series, a
routine strip or a project's progress cannot come out differently on the two
sides. The dayGLANCE MCP read surface (`@glance-apps/dayglance-mcp`) is built
on it too, for the same reason: what it reports about a day, a frame or the
Bucket List is what the app shows.

## The boundary

Pure functions only: calendar math, agenda shaping, and the domain rules the
app's UI and its MCP read surface must apply identically. No app state, no
storage, no DOM, no network. Ownership policy (who wins a conflict, when an
edit is adopted) stays in dayGLANCE. Multi-user *scoping* (who sees an item)
is here, in `userScope.js`, because every reader must scope alike.

## What it holds

| Module | Exports |
| --- | --- |
| `recurrence.js` | Recurrence expansion: `getOccurrencesInRange`, `getNextOccurrence`, the recurrence presets and weekday helpers. Moved verbatim from the app's recurrence engine. |
| `agenda.js` | Day agendas: `buildAgenda`, `expandRecurringTemplate`, `recurringInstanceId`, `datesWithItems`, and the local-date helpers `localDateStr` and `shiftDateStr`. |
| `routines.js` | `routinesForDate`, the routines placed on a day. |
| `title.js` | `splitTitle`, a task title split into text, tags and `[[wikilinks]]` for display. |
| `calendar.js` | `mergeCalendarProjections`, which merges each device's projection of its read-only calendar events, day by day. |
| `events.js` | Calendar-event semantics: `isCalendarEvent`, `eventHasEnded`, `agendaClock`. |
| `progress.js` | Project and goal progress: `calculateProjectProgress`, `projectProgressPercent`, `getProjectTotalDuration`, `isProjectStalled`, `calculateGoalProgress`. |
| `noteBlock.js` | The `dayglance:` frontmatter map on a linked project or goal note: `projectNoteBlock`, `goalNoteBlock`, `noteBlockChanged`, `noteWikilink`, `NOTE_BLOCK_KEY`. |
| `noteLink.js` | A project's or goal's link to its note as readers see it: `noteLinkOf`, `noteDisplayName`. |
| `bucketList.js` | The Bucket List (someday/maybe), excluded from every inbox list: `notBucketed`, `isBucketTask`, `BUCKET_LIST_IDS`, `DEFAULT_BUCKET_CONFIG`, `demoteToBucket`, `promoteToInbox`, `stripBucketId`, `normalizeBucketConfig`. |
| `frameInstances.js` | Which GTD frames apply to a date: `frameInstancesForDate`, `frameAppliesTo`, `dayOfWeekFor`. Frames must arrive scoped to the user. |
| `routineBlocks.js` | Today's placed routines as read-only blocks, with the date guard: `buildRoutineBlocks`, `toRoutineBlock`, `routineBlockId`, `parseRoutineBlockId`, `ROUTINE_ID_PREFIX`. Routines must arrive scoped to the user. |
| `dayOccupancy.js` | What occupies a day, and a frame's free slots: `computeAvailableSlots`, `availableMinutes`, `computeOccupiedIntervals`, `mergeIntervals`, `routineIntervals`, `taskInterval`, `adjustPastConflicts`, `findRoutineConflict`, `obstacleName`, `describeObstacle`, `timeToMinutes`, `minutesToTime`. |
| `userScope.js` | Multi-user scoping: `isTaskVisibleForUser` (broadcast-unless-assigned tasks, goals, projects) and `isOwnedBy` (single-owner routines, habits, frames). |
| `stamps.js` | `parseStamp`, a stored `createdAt` / `completedAt` in any of the forms it has been written in. |

Everything is re-exported from the package root:

```js
import { buildAgenda, getOccurrencesInRange } from '@glance-apps/agenda-core';
```

Types are in `types/index.d.ts`.

## Stability

The app and the plugin update separately, so a change here reaches users at
two different times. A change to what a function returns for the same input
is a change both sides must ship together. The tests beside each module pin
that behaviour and travel with the package.

## Consumption

dayGLANCE and the bridge plugin both use it through a `file:` link in the
dayGLANCE repository. The plugin's public repository,
[glance-apps/dayglance-bridge](https://github.com/glance-apps/dayglance-bridge),
carries a copy under `packages/`, refreshed from here on every change.

## License

MIT
