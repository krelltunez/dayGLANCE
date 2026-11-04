# @glance-apps/mcp-host

The transport-and-safety layer of a GLANCE app's MCP server: the HTTP listener
and its guards, bearer auth, port policy, the write gate, idempotent replay,
pagination, the write journal, and the local date and time rules of the tool
surface. Extracted from the dayGLANCE desktop server (#2280) so that server, a
GLANCEvault-client host the user runs, and lastGLANCE's server share one copy.

## The boundary

Nothing app-specific: no tools, no schemas, no data model, no undo op
vocabulary. Nothing desktop-specific: no Electron, no IPC, no tray. Plain ESM
JavaScript for Node 20+, with hand-written types in `types/index.d.ts`.

The app supplies its tools (a per-request `McpServer` factory), its default
port, its cursor prefix, its journal grouping, and a bridge to its data.

## API

Everything is exported from the package root.

| Module | Exports |
| --- | --- |
| `listener.js` | `startMcpListener(opts)`: Streamable HTTP on one fixed port and path. Guard order per request: path (404) → Host (403) → Origin (403) → bearer token (401). Returns the `http.Server`, or `null` after logging why it refused. Also `isLoopbackAddress`, `normalizeAllowlist`, `LOCALHOST_NAMES`, `DEFAULT_MCP_PATH`, `DEFAULT_BIND_ADDRESS`. |
| `auth.js` | `generateMcpToken`, `checkBearerToken` (constant time), `unauthorizedResponse(realm)` (one 401 for every reason). |
| `port.js` | `resolvePort(override, defaultPort)`: exactly one port, never a scan, port 0 refused. `describeBindFailure(port, err, { appName, host })`. |
| `rateLimit.js`, `writeGate.js` | `createWriteRateLimiter` (sliding window, keyed by token), `createWriteGate` (repeated violations auto-disable writes until `reset()`). |
| `idempotency.js` | `createIdempotencyStore` (TTL + LRU replay store), `isValidIdempotencyKey`, `makeStoreKey`. |
| `pagination.js` | `paginate(items, { limit, cursor, filterKey, cursorPrefix })`: self-contained cursors bound to the filter they were minted under. `encodeCursor`, `decodeCursor`. |
| `journal.js` | The session write journal: `appendEntry`, `journalGroups` / `journalSnapshot` (given the app's `groupKey`, and optionally `groupLabel`), `buildUndoPlan`, `summaryTitle`. |
| `dates.js`, `localTime.js` | Local calendar dates and wall-clock times: `isValidLocalDate`, `localDateOf`, `dateEnvelope`, `isValidWallTime`, `resolveLocalTime`, `validateStartTime` (refuses DST-skipped and DST-repeated times). |

Types only: `HostBridge` and `BridgeResult`, the contract between the tools
and the app's data. `request(method, params, timeoutMs)` resolves to
`{ ok: true, data, undo? }` or `{ ok: false, error: { code, message } }`, and
must never reject or hang: when the data side cannot answer, it resolves with a
typed unavailable error, so a tool never reports "nothing" for "unknown".

```js
import { McpServer } from '@modelcontextprotocol/server';
import { startMcpListener } from '@glance-apps/mcp-host';

const server = startMcpListener({
  name: 'lastGLANCE',
  defaultPort: 7900,
  token: () => config.token,          // read on every request: rotation is immediate
  createServer: () => {               // a fresh server per request, never shared
    const s = new McpServer({ name: 'lastGLANCE', version: '1.0.0' });
    registerMyTools(s, deps);
    return s;
  },
});
```

## Host, Origin and bind address

By default the listener binds `127.0.0.1` and uses the SDK's localhost Host and
Origin guards, exactly. A host reached by name (a LAN box, or behind a reverse
proxy that keeps the Host header) binds another address and lists its names:

```js
startMcpListener({
  ...opts,
  host: '0.0.0.0',
  allowedHosts: ['mcp.home.lan'],          // replaces the localhost list
  allowedOrigins: [],                      // no browser origin at all
});
```

- `allowedHosts` and `allowedOrigins` are bare hostnames, port-agnostic, IPv6
  in brackets. An entry that could never match (a port, a scheme, a wildcard)
  is refused at start. `[...LOCALHOST_NAMES, 'mcp.home.lan']` extends the
  default instead of replacing it.
- An empty Host list is refused. An empty Origin list is a policy: requests
  without an Origin (every non-browser MCP client) still pass.
- A token is required on every bind. A non-loopback bind without one gets its
  own refusal, naming the address.
- TLS is the reverse proxy's job.

## Tests

`test/` runs under the repository's vitest config, including the listener on a
real socket with the official MCP client. The test directory is not part of
the published files, and electron-builder leaves a top-level `test` directory
out of `app.asar`.

## License

MIT
