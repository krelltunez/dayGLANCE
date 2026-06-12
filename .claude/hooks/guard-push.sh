#!/usr/bin/env bash
# Blocks `git push` when the current branch's PR has already been merged into
# main — the signal to start a fresh branch instead of adding more commits.
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

block() {
  printf '{"continue":false,"stopReason":"Branch '"'"'%s'"'"' already has a merged PR in main — per CLAUDE.md, create a new branch from the latest main before pushing."}\n' \
    "$branch"
  exit 0
}

# Block only when origin/main contains a GitHub merge commit referencing this
# branch (e.g. "Merge pull request #N from krelltunez/<branch>"). That is the
# reliable "this branch's PR already merged" signal.
#
# We intentionally do NOT block merely because HEAD is an ancestor of
# origin/main: that is also true for a freshly-created branch still even with
# main (no new commits yet), which caused constant false-positive blocks on
# brand-new branches.
if git -C "$CLAUDE_PROJECT_DIR" log origin/main --oneline --grep="from krelltunez/${branch}$" | grep -q .; then
  block
fi

exit 0
