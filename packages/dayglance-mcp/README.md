# @glance-apps/dayglance-mcp

dayGLANCE's MCP **read surface**: the read tools and resources, the read model
that answers them, and the state that model answers over. Extracted from the
dayGLANCE desktop app (#2280) so its MCP server and a GLANCEvault-client host
the user runs answer the same tools through the same code, instead of a second
copy that drifts.

## The boundary

The tools talk only to a `HostBridge` (from `@glance-apps/mcp-host`); what
answers the bridge is the host's business. The desktop app answers it over IPC
from live React state; a host answers it from its own reassembled copy of the
synced slices. Both answer through `handleMcpRequest`, over the state
`buildMcpReadState` builds.

The write tools stay in the desktop app for now. Plain ESM JavaScript for Node
20+, with hand-written types in `types/`.

## Entries

| Entry | What | Where it runs |
| --- | --- | --- |
| `@glance-apps/dayglance-mcp` | Everything below: the tool registration and the read model. | Node (it imports zod and the host kit). |
| `@glance-apps/dayglance-mcp/model` | The read model and its state only. No MCP SDK, no zod, no HTTP. | Anywhere, a browser renderer included. The desktop app's renderer imports this. |

## API

| Module | Exports |
| --- | --- |
| `readState.js` | `buildMcpReadState(data, { now, timeZone, userSyncId, weekStartDay })`: the read model's state for one user. `data` is the synced slices under their sync-payload names (`tasks`, `recurringTasks`, `unscheduledTasks`, `recycleBin`, `todayRoutines`, `routinesDate`, `routineCompletions`, `routinesEnabled`, `gtdFrames`, `goals`, `projects`, `areas`, `dailyNotes`, `bucketConfig`, `users`, `multiUserEnabled`). `readClock(now, timeZone)`. |
| `readModel.js` | `handleMcpRequest(state, { method, params })`, the dispatcher the bridge calls, and the shaping it is built from: `buildDayBlocks`, `buildWeek`, `buildUnscheduledItems`, `buildBucketList`, `buildGoalProgress`, `buildAreas`, `buildUsers`, `toBlock`, `inboxItem`, `goalItem`, `projectItem`, `blockType`, `isImportedEvent`, `expandRecurringForDate`, `weekDatesFor`, `dailyNoteFor`, `wireSubtasks`. |
| `frames.js` | Frames on the read surface, with their free slots: `buildFrames`, `toFrameObject`, `frameWireId`, `FRAME_ID_PREFIX`. |
| `repeat.js`, `wireStamp.js` | Wire forms: `recurrenceToWire` (a stored recurrence as the `repeat` argument the write tools accept), `wireStamp` (a stored stamp as a local date and time). |
| `noteDescriptions.js` | `enrichGoalTreeDescriptions(data, { loadNoteDescription })`: fills each linked goal's and project's `description` in a `goal_progress` result from its note's opening section, through the injected loader (`description_source: 'obsidian_note'`, `description_base`); an entity whose note cannot be read keeps its pointer. `DESCRIPTION_READ_CAP` (40 notes) and `DESCRIPTION_READ_BUDGET_MS` (2 s in all). The desktop app passes its vault-file loader; a host with no vault folder passes `bridgeNoteDescriptionLoader` from `@glance-apps/obsidian-format`, which reads the plugin's observation stream. |
| `readTools.js`, `resources.js` | `registerReadTools(server, deps)` and `registerResources(server, deps)`, onto a per-request `McpServer`. `deps` is `ReadToolDeps`: `bridge`, `now`, `timeZone`, `includeNativeEvents`, `multiUserEnabled`. `CURSOR_PREFIX` (`dgc1.`, wire format). |
| `inboxFilter.js` | `resolveInboxFilter`, `INBOX_SCOPES`: the inbox tool's filter, resolved once, before it is applied or encoded into a cursor. |

The tool contract, every tool, parameter and typed error, is
`docs/mcp-tools-reference.md` in the dayGLANCE repository.

## A host, in outline

```js
import { McpServer } from '@modelcontextprotocol/server';
import { startMcpListener } from '@glance-apps/mcp-host';
import { buildMcpReadState, handleMcpRequest, registerReadTools, registerResources } from '@glance-apps/dayglance-mcp';

const config = { userSyncId: 'u-…', timeZone: 'America/Los_Angeles', weekStartDay: 1 };
const deps = {
  bridge: {
    // Never rejects: a failure answers with a typed error, never with "nothing".
    async request(method, params) {
      try {
        const state = buildMcpReadState(store.slices(), { now: Date.now(), ...config });
        return handleMcpRequest(state, { method, params });
      } catch (err) {
        return { ok: false, error: { code: 'internal', message: String(err?.message ?? err) } };
      }
    },
    async ping() { return true; },
    dispose() {},
  },
  now: () => Date.now(),
  timeZone: () => config.timeZone,          // the same zone the state is built in
  includeNativeEvents: () => false,         // a host has no device calendar
  multiUserEnabled: () => !!store.slices().multiUserEnabled,
};

startMcpListener({
  name: 'dayGLANCE',
  defaultPort: 7893,
  token: () => config.token,
  createServer: () => {
    const s = new McpServer({ name: 'dayGLANCE', version: '1.0.0' });
    registerReadTools(s, deps);
    registerResources(s, deps);
    return s;
  },
});
```

`test/host.test.js` runs this shape for real.

## What a host must configure

- **The user's IANA time zone.** Routines exist only for today and today's
  frames are clipped to the current minute, so `buildMcpReadState` reads
  `now` in `timeZone`. A server is often on UTC; without the zone, the evening
  of the user's Wednesday reads as Thursday. Stamps are reported in it too.
  The desktop app passes none: its clock is the user's.
- **Which user it answers as** (`userSyncId`), in a multi-user account.
  Routines and frames have one owner, which the visibility filter the read
  model applies to every other slice cannot judge, so `buildMcpReadState`
  scopes them by owner. Without it, another member's routines and frames leak
  onto this user's surface.
- **`weekStartDay`**, a per-device setting that is not synced.

## Tests

`test/` (kept out of the desktop app's package by electron-builder): the read
model, frames and routines on the read surface, the state builder (a
characterization of what the desktop app handed its bridge before the
extraction, the owner scoping, and the clock in a zone), the wire forms, the
inbox filter and cursor bytes, the declarations against the runtime exports,
and the host above. They run in the dayGLANCE repository's suite.

## License

MIT
