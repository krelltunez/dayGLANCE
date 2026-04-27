#!/usr/bin/env bash
# Blocks `git push` when the current branch has already been merged into main.
# Uses a local git check (no GitHub API needed) so it works in restricted envs.
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

# Fetch the latest main so the check reflects the true remote state.
git -C "$CLAUDE_PROJECT_DIR" fetch origin main --quiet 2>/dev/null

# If the branch tip is already an ancestor of origin/main, it was merged in.
# (Catches regular merges and fast-forward squash merges. Squash merges that
# leave an orphan commit are not caught, but those are rare in this repo.)
if git -C "$CLAUDE_PROJECT_DIR" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  printf '{"continue":false,"stopReason":"Branch '"'"'%s'"'"' is already merged into main — per CLAUDE.md, create a new branch from the correct base before pushing."}\n' \
    "$branch"
  exit 0
fi

exit 0
