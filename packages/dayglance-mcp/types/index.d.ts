// Hand-maintained declarations for @glance-apps/dayglance-mcp. The package is
// plain ESM JavaScript; these types are what a TypeScript host (the dayGLANCE
// Electron main process) compiles against, so keep them exact. The read model
// is declared in model.d.ts (the ./model entry) and re-exported here.

import type { McpServer } from '@modelcontextprotocol/server';
import type { HostBridge } from '@glance-apps/mcp-host';

export * from './model.js';

// ── inboxFilter.js ───────────────────────────────────────────────────────────

export const INBOX_SCOPES: readonly ['all', 'standalone', 'project'];
export type InboxScope = (typeof INBOX_SCOPES)[number];

export interface ResolvedInboxFilter {
  scope: InboxScope;
  includeCompleted: boolean;
  /**
   * Canonical string form, stable key order, built from RESOLVED values.
   * Encoded into cursors and compared across pages; also readable in the
   * mismatch error message.
   */
  key: string;
}

export type InboxFilterResult =
  | { ok: true; filter: ResolvedInboxFilter }
  | { ok: false; message: string };

/** Defaults resolve here, once, before anything compares or encodes. */
export function resolveInboxFilter(args: { scope?: unknown; include_completed?: unknown }): InboxFilterResult;

// ── readTools.js, resources.js ───────────────────────────────────────────────

/**
 * dayGLANCE's pagination cursor prefix ("dayGLANCE cursor, version 1"). Part
 * of the wire format: changing it invalidates every cursor a client holds.
 */
export const CURSOR_PREFIX: 'dgc1.';

export interface ReadToolDeps {
  /** The bridge to the data; it answers through handleMcpRequest. */
  bridge: HostBridge;
  /** Injectable clock, same idiom as calendarCache.ts. */
  now: () => number;
  /** The IANA timezone the server resolves — never inferred from the client (§5.3). */
  timeZone: () => string;
  /** Device-calendar consent tier (§6.3). Phase 2 reads an env var behind this; Phase 5 swaps the source. */
  includeNativeEvents: () => boolean;
  /**
   * Multi-user mode, pushed from the app (per-device toggle). Gates the
   * EXISTENCE of dayglance_list_users — evaluated at registration time, which
   * is per request (§3.7 factory), so a toggle mid-session changes the schema
   * on the client's next request.
   */
  multiUserEnabled: () => boolean;
}

/** The read tools (§5.1), onto a per-request server. Holds no state. */
export function registerReadTools(server: McpServer, deps: ReadToolDeps): void;

/** The read-only resources (§5.4), over the same bridge and deps as the tools. */
export function registerResources(server: McpServer, deps: ReadToolDeps): void;
