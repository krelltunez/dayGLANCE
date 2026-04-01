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
