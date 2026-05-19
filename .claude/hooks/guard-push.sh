#!/usr/bin/env bash
# Blocks `git push` when the current branch has already been merged into main.
# Uses two complementary git checks — no GitHub API needed.
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

# Fetch the latest main so both checks reflect the true remote state.
git -C "$CLAUDE_PROJECT_DIR" fetch origin main --quiet 2>/dev/null

block() {
  printf '{"continue":false,"stopReason":"Branch '"'"'%s'"'"' is already merged into main — per CLAUDE.md, create a new branch from the correct base before pushing."}\n' \
    "$branch"
  exit 0
}

# Check 1: branch tip is already an ancestor of origin/main (catches fast-forward
# and regular merges where no new commits have been added after the merge).
if git -C "$CLAUDE_PROJECT_DIR" merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  block
fi

# Check 2: origin/main contains a GitHub merge commit referencing this branch.
# This catches the case where new commits were added to the branch AFTER the PR
# was merged — the branch tip is no longer in main, so check 1 misses it, but
# the merge commit message "Merge pull request #N from owner/<branch>" is there.
if git -C "$CLAUDE_PROJECT_DIR" log origin/main --oneline --grep="from krelltunez/${branch}$" | grep -q .; then
  block
fi

exit 0
