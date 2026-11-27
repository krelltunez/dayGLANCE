// Canonical filter resolution for dayglance_list_unscheduled_tasks, pure and
// unit-tested (formerly electron/mcpInboxFilter.ts). The resolved tuple — not
// the raw arguments — is what gets applied by the read model AND encoded into
// pagination cursors, so semantically identical requests always produce
// identical tuples: a caller that omits include_completed on page one and
// passes include_completed: true explicitly on page two is requesting the same
// filter and must never see a mismatch error. Defaults resolve here, once, before anything compares.
//
// The vocabulary is FILTER SELECTION over the app's own structural task
// fields (bucketId is handled upstream as the unconditional exclusion;
// projectId and completed are the two selectable axes). Deliberately no tag
// parsing, no priority thresholds, no project-id narrowing, and no 'bucket'
// scope: bucket access would belong to a separate tool.

export const INBOX_SCOPES = Object.freeze(['all', 'standalone', 'project']);

// The resolved filter (types/index.d.ts, ResolvedInboxFilter): scope,
// includeCompleted, and `key`, the canonical string form, stable key order,
// built from RESOLVED values. The key is encoded into cursors and compared
// across pages; it is also readable in the mismatch error message.

/**
 * @param {{ scope?: unknown, include_completed?: unknown }} args
 * @returns {{ ok: true, filter: { scope: string, includeCompleted: boolean, key: string } } | { ok: false, message: string }}
 */
export function resolveInboxFilter(args) {
  const { scope, include_completed, include_archived } = args;

  let scopeValue = 'all';
  if (scope !== undefined) {
    if (typeof scope !== 'string' || !INBOX_SCOPES.includes(scope)) {
      return { ok: false, message: `scope must be one of ${INBOX_SCOPES.map((s) => `"${s}"`).join(', ')}, got ${JSON.stringify(scope)}` };
    }
    scopeValue = scope;
  }

  let includeCompleted = true;
  if (include_completed !== undefined) {
    if (typeof include_completed !== 'boolean') {
      return { ok: false, message: `include_completed must be a boolean, got ${JSON.stringify(include_completed)}` };
    }
    includeCompleted = include_completed;
  }

  // Archived tasks, and tasks in an archived project, are hidden by default,
  // as the app's Inbox hides them. The key gains the axis only when it is set,
  // so a cursor minted before the axis existed still matches the default.
  let includeArchived = false;
  if (include_archived !== undefined) {
    if (typeof include_archived !== 'boolean') {
      return { ok: false, message: `include_archived must be a boolean, got ${JSON.stringify(include_archived)}` };
    }
    includeArchived = include_archived;
  }

  return {
    ok: true,
    filter: {
      scope: scopeValue,
      includeCompleted,
      includeArchived,
      key: `scope=${scopeValue};completed=${includeCompleted ? '1' : '0'}${includeArchived ? ';archived=1' : ''}`,
    },
  };
}
