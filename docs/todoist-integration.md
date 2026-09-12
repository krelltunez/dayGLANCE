# Todoist integration

Todoist supplies tasks; dayGLANCE schedules them. This opt-in integration is
selective import with guarded completion writeback, not a second, mirrored
Todoist account. It never uploads native dayGLANCE tasks and never deletes or
restores local tasks automatically.

## Getting started

Open Settings > Todoist sync, enter a personal API token, and connect. Connecting
loads a read-only preview, not an import. Choose **Today's tasks**, **All active
tasks**, or **Choose by project, label or priority**, then click **Sync now**.
Manual sync works with automatic sync disabled. Automatic sync requires the app
to be open, visible, and online; it does not run as a background service.

Today's tasks uses the task's due date, not its deadline, in the Todoist account
timezone. Overdue tasks are opt-in. Advanced filters support projects and
subprojects, labels, priorities, and AND/OR between selected groups. Empty
advanced filters import nothing. Imported tasks can follow their Todoist date,
enter Today, or remain in the inbox. Manually arranged dayGLANCE time blocks are
preserved. Calendar-midnight date filtering does not use a custom day boundary.

The result panel distinguishes the active tasks read from Todoist, matching
items, imported/updated items, missing source records, and locally removed copies.
A connected account or an empty preview does not by itself mean an import ran.

## Changes, deletions, and completion

Linked tasks carry an account-qualified Todoist ID and a last-observed base.
Content changes reconcile against that base; conflicting local edits are kept
until the user chooses a value. Choosing a value resolves the local conflict
only; it does not write the title or notes back to Todoist.

Changing a filter or receiving an explicit remote deletion never sends a local
copy to the recycle bin. Missing source records are no information, not proof
of completion or deletion. Explicit completion records can mark linked tasks
complete. Locally removed copies and deletion tombstones suppress re-imports.

Optional completion writeback only closes eligible non-recurring leaf tasks
assigned to the current user (or unassigned). It never writes titles, notes,
dates, projects, labels, undo-completion operations, or remote deletions. Enable
it on only one device. Web Locks coordinate tabs; without Web Locks, use
read-only sync. Every queued close keeps its UUID on disk before the request,
so an unconfirmed retry reuses the same command ID.

## Credentials, cache, and disconnect

The token and connected account ID are session-only. The sync cache uses an
account-specific `dg-todoist-state-v1:<accountId>` localStorage key, outside the
normal device-settings namespace. All active tasks/projects/labels are read
for filtering and writeback safety, not just the selected subset. Imported
copies may participate in normal dayGLANCE backups and sync.

Before each cache write, unlinked completed/deleted tasks and deleted
project/label records are pruned. Inactive tasks referenced by local copies or
pending operations are retained. The storage breakdown labels this usage
**Todoist sync cache**; it still shares the browser's localStorage budget.

Disconnect cancels outstanding work, disables automatic sync and completion
writeback, and removes session credentials. It waits for the cross-tab writer
lock before clearing an account cache with no pending operations. If pending
receipts exist, the cache is retained and the pending count stays visible.
Reconnect that account to resolve them, then disconnect again to clear the
cache. Corrupt queue data is not silently erased. Imported tasks remain in
place; disconnect is not an undo-import or deletion action.

No third-party proxy is used. The platform must be able to contact the Todoist
API directly. Multi-user mode disables the integration to avoid accidental
sharing of personal tasks. The token is not encrypted against scripts running
on the same origin.

## Deferred functionality

The experimental one-way mirror is not shipped in this version. Existing
experimental configurations migrate to their previous selection scope with
automatic sync and writeback disabled. Automatic deletion/restoration and
remote-authoritative replacement of local edits are intentionally absent.
Previously archived copies stay in the recycle bin until restored manually.
