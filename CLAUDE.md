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
