# Git Workflow

## Branch Strategy

Use a **fresh branch per logical task or PR**. Do not accumulate multiple unrelated changes on a single long-running branch.

- When starting a new task, create a new branch from the latest `main` (after fetching):
  ```
  git fetch origin main
  git checkout -b <descriptive-branch-name> origin/main
  ```
- Branch names should be short and descriptive (e.g. `fix-project-card-completed-at`, `weekly-review-goals-tiles`).
- Once a PR is merged, do not continue committing to that branch. Start fresh from `main` for the next task.

## Pull Requests

Always create a PR after pushing a branch. Use the GitHub MCP tools (`mcp__github__create_pull_request`) to do this — do not wait for the user to ask. Write a clear title and a summary that describes what changed and why.

## CRITICAL: Always check PR status before pushing

**Before pushing any commit to an existing branch**, use `mcp__github__pull_request_read` to check whether the PR for that branch has already been merged. If it has:

1. Do NOT push to that branch.
2. Create a new branch from the latest `main`.
3. Apply the changes to the new branch instead.

This check is mandatory — even mid-task, even for "small fixes", even when you just created the PR moments ago. PRs can be merged at any time.

## Keeping `develop` in sync with `main`

`develop` is the long-lived branch for hyperGLANCE. After every PR merges to `main`, sync it:

```bash
git checkout develop
git fetch origin main
git merge origin/main
git push origin develop
```

Use **merge, not rebase** — rebasing rewrites history and breaks branches cut from `develop`.

The files most likely to need conflict resolution during syncs are `App.jsx`, `GlanceSidebar.jsx`, and `MobileGlanceSection.jsx` (all touched by hyperGLANCE).

## Electron desktop app — `electron-develop`

`electron-develop` is the long-lived integration branch for the Mac/Windows desktop app:

- Feature branches are cut from `electron-develop` (not `main`).
- PRs target `electron-develop` (not `main`).
- `main` does **not** receive Electron changes until the desktop app ships.

```bash
git fetch origin electron-develop
git checkout -b <feature-branch> origin/electron-develop
```

The Electron main process lives in `electron/` (compiled to `dist-electron/`). The renderer is the existing Vite/React app. The WebSocket server (`electron/ws-server.ts`) runs on `ws://localhost:7892` and is the shared integration point for the Stream Deck plugin and future intent-based integrations.

## Stream Deck plugin — `stream-deck-develop`

`stream-deck-develop` is the long-lived integration branch for the Stream Deck plugin:

- Feature branches are cut from `stream-deck-develop` (not `main`).
- PRs target `stream-deck-develop` (not `main`).
- `main` does **not** receive Stream Deck changes until the plugin ships.

```bash
git fetch origin stream-deck-develop
git checkout -b <feature-branch> origin/stream-deck-develop
```

After a feature PR merges into `stream-deck-develop`, do **not** sync to `main` — leave that for the release.

## GitHub Issues

Do **not** post comments to GitHub issues directly using `mcp__github__add_issue_comment`. Instead, draft the proposed response and present it to the user so they can review and post it themselves.

# App.jsx — Ongoing Decomposition

`App.jsx` started at ~30,000 lines and has been reduced to ~8,500 across three refactor passes. It is still the largest file and has known areas worth extracting **opportunistically** — i.e. when a feature or bugfix already touches that area, not as a dedicated refactor pass.

## Remaining candidates

- **ICS/CalDAV parser** (`~lines 2900–3200`): RRULE expansion, VTODO handling, and date parsing are self-contained utility logic with no UI dependency. Could move to `src/utils/icsParser.js`.
- **Voice input pipeline**: The `voiceParseAndApply`, `voiceApplyAllChanges`, and related callbacks are substantial and cohesive. Candidate for a `useVoiceInput` hook.
- **Morning summary / AI features**: `generateMorningSummary` and surrounding AI callback logic could become a `useMorningSummary` hook.
- **Obsidian sync handlers**: The inline Obsidian sync callbacks could move to a `useObsidianSync` hook (the pattern is already established with `useTaskActions`, `useDragDrop`, etc.).
- **Native calendar integration**: The `nativeEventToTask` function and fetch logic around Android calendar sync are self-contained and could move to `src/utils/nativeCalendar.js`.

## Guidance

When adding a new feature or fixing a bug in one of these areas, consider extracting the surrounding logic at the same time if it keeps the diff focused and doesn't bloat the PR scope. Don't extract for its own sake — only when it makes the change cleaner.

