#!/usr/bin/env bash
# Blocks `git push` when the current branch already has a merged PR.
# Reads a Bash tool call from stdin (JSON with .tool_input.command).

command=$(jq -r '.tool_input.command // ""' 2>/dev/null)

# Only act on git push commands
if ! echo "$command" | grep -qE '^\s*git\s+push'; then
  exit 0
fi

branch=$(git -C "$CLAUDE_PROJECT_DIR" branch --show-current 2>/dev/null)
if [ -z "$branch" ]; then
  exit 0
fi

# URL-encode the branch name (replace / with %2F)
branch_encoded="${branch//\//%2F}"

# Query GitHub API for any closed PR on this branch
response=$(curl -s \
  "https://api.github.com/repos/krelltunez/dayGLANCE/pulls?state=closed&head=krelltunez:${branch_encoded}&per_page=1")

merged_at=$(echo "$response" | jq -r 'if (type == "array") and (length > 0) and (.[0].merged_at != null) then .[0].merged_at else "null" end' 2>/dev/null)

if [ "$merged_at" != "null" ] && [ -n "$merged_at" ]; then
  pr_number=$(echo "$response" | jq -r '.[0].number' 2>/dev/null)
  printf '{"continue":false,"stopReason":"Branch '"'"'%s'"'"' already has a merged PR (#%s) — per CLAUDE.md, create a new branch from the correct base (electron-develop or main) before pushing."}\n' \
    "$branch" "$pr_number"
  exit 0
fi

exit 0
