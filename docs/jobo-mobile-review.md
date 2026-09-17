# Mobile Plan / Do review

Status: owner-approved mobile follow-up for upstream review. This work depends on the Jobo foundation proposed in upstream PR #1673.

## Base and scope

The release anchor is upstream v5.2.0 (`266d1ec0a9774fd1a1d2724d8640e5ad78520ef3`). This work is stacked on the existing desktop Jobo branch (`4fdf3b9a0c187de346f9ab388c16239483c22da9`), whose parent already includes 13 subsequent upstream commits. It is not a reset to the release tag and does not replace the desktop Jobo implementation.

Review the mobile delta against `dayGLANCE-jobo`. A standalone upstream PR also needs the existing Jobo dependency reviewed or integrated; do not accidentally include it as an unexplained mobile-only change.

## Try it

Use Node 22, `npm ci`, then `npm run dev`. In the phone layout, open Settings / App and enable the existing experimental Jobo option. Open Timeline / Grid. The `Plan / Do` button switches between the compact comparison and the unchanged native grid. The preference is OFF by default; multi-user and tray modes remain excluded by the existing Jobo gate.

The page contains only a collapsible task list, Plan / Do, one shared hour axis and a daily-note preview. It inherits the native light/dark theme, task colours, day navigation and bottom tabs. There are no promotional subtitles or emergency-capture panels.

## Recording behaviour

- Task names and Plan cards open the original mobile task editor. Plan plus also uses the original form and task store. Add task creates an all-day task through the existing action.
- A task's circle opens a linked actual-time record, or its latest existing attempt. It is NOT a native task-completion checkbox. Logging completion never sends a Todoist completion command.
- Do plus and empty slots can create standalone records; linking to an existing task is optional. Title, date and start/end times are editable. Progress, tags, notes and colour are under More.
- Overnight records use one durable record and two projected day segments. Editing a segment edits the original record. Invalid intervals are rejected.
- Native task notes remain canonical for linked records; the shared-note action opens that task. Daily notes reuse the native editor and original daily-note store.
- Save constructs the complete update before one storage commit. A failed write keeps the editor input intact. Delete affects only the actual record; journal undo is available in the task-list menu.
- The native refocus action resolves the inner shared timeline rather than interpreting the outer task list and notes as hours. Native desktop/grid measurement is retained when the compact axis is absent.

## Data boundaries

Do records use the pre-existing local Jobo v3 ledger. There is no new backend, account connection or sync protocol. Native calendar/cloud sync and its standard backup do not automatically include this ledger. Use the separate Jobo JSON export; it is compatible with the existing desktop Jobo restore action. The mobile menu exposes export and undo, not destructive full-account restore.

The existing storage check detects stale cross-tab state but is not an atomic cross-tab lock or a cross-device merge protocol. This change does not expand those guarantees.

## Reproducible validation

The branch workflow runs ESLint, the entire Vitest suite, web and Android-web production builds, and `scripts/jobo-mobile-recording-review.py` (including the base mobile suite) against the production server. Added unit tests cover drafts, interval validation, atomic writes, immutable plan snapshots, all-day links, reload, quota/retry, stale/deleted records, deletion/undo, midnight projection, layout and scroll-target selection.

Browser scenarios exercise actual add/edit/reload, native daily notes, native Plan creation, checklist recording, delete/undo, quota failures, original-grid switching, refocus, feature OFF and the unchanged desktop route. Fresh profiles cover 320, 393 and 430 CSS-pixel phone widths plus dark mode. All fixture data are synthetic; external provider traffic is blocked in the test.

Screenshots are raw Chromium screenshots of the compiled app at mobile dimensions, not generated illustrations and not physical-device captures. Android-web compilation is not an APK-installation or hardware test. Physical Android keyboard, back gesture and WebView behaviour, and iOS hardware/Safari, still need device verification. Browser-native date/time controls can follow the browser's own regional presentation.

Read the workflow's `browser-review.json`, `browser-review-extended.json`, `unit-tests.txt` and `commit.txt` for the exact result and reviewed revision. Do not infer a pass solely from the existence of screenshots. The owner approved this layout for submission and requested the existing Plan / Do terminology. The mobile Do heading reuses `jobo.do`, matching desktop; the Chinese labels are 计划 / 执行. Locale and browser regressions check both language presentations.
