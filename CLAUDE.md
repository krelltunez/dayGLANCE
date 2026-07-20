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

## GitHub Issues

Do **not** post comments to GitHub issues directly using `mcp__github__add_issue_comment`. Instead, draft the proposed response and present it to the user so they can review and post it themselves.

# App.jsx — Ongoing Decomposition

`App.jsx` started at ~30,000 lines and has been reduced to ~9,600 across four refactor passes. All previously listed extraction candidates are done:

- **ICS/CalDAV parser** → `src/utils/icsParser.js` (with tests)
- **Voice input pipeline** → `src/hooks/useVoiceInput.js`
- **Morning summary / evening reflection** → `src/hooks/useDailyBriefings.js`
- **Obsidian sync handlers** → `src/hooks/useObsidianSync.js`
- **Native calendar integration** → `src/utils/nativeCalendar.js` (with tests)

## Guidance

App.jsx is still the largest file. When adding a new feature or fixing a bug there, consider extracting the surrounding logic into a hook (`src/hooks/`) or pure utility module (`src/utils/`, with tests) at the same time — the deps-object hook pattern (`useTaskActions`, `useObsidianSync`, etc.) is well established. Extract opportunistically, when it keeps the diff focused; don't extract for its own sake.

