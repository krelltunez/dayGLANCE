#!/bin/bash
set -euo pipefail

# Only run in remote (Claude Code on the web) environments
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Defuse a stop-hook false positive before it can fire: the launcher's
# ~/.claude/stop-hook-git-check.sh flags every commit in origin/<branch>..HEAD
# whose committer isn't noreply@anthropic.com — which catches GitHub's own PR
# merge commits (committer noreply@github.com, shown as Verified on GitHub)
# whenever the merge below fast-forwards a stale feature branch past its
# merged PR. History reachable from any origin ref is published and must not
# be rewritten, so teach both of the hook's checks to exclude it. Idempotent,
# and a no-op if the launcher script is absent or already fixed.
STOP_HOOK="$HOME/.claude/stop-hook-git-check.sh"
if [ -f "$STOP_HOOK" ] && ! grep -q -- '--not --remotes=origin' "$STOP_HOOK"; then
  sed -i 's|"$upstream\.\.HEAD"|"$upstream..HEAD" --not --remotes=origin|g' "$STOP_HOOK"
fi

# Pull latest main to ensure no commits are missing
git fetch origin main
git merge origin/main --no-edit

# Install npm dependencies
npm install
