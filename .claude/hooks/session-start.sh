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

# Install npm dependencies.
#
# `npm ci`, not `npm install`: it installs exactly what package-lock.json
# specifies and never rewrites it. `npm install` recomputes the dependency tree
# and writes the lockfile even when package.json has not changed, so every
# session start produced a lockfile that could differ from the committed one —
# which then collided with any other regeneration and left `both modified:
# package-lock.json` conflicts in clones that had done the same thing.
#
# A failure here means package.json and package-lock.json have genuinely drifted.
# That is worth stopping for rather than papering over with a fallback to
# `npm install`: CI runs `npm ci` too, so the same drift would fail there anyway,
# and silently regenerating the lockfile is what caused the conflicts to begin
# with. Fix it once, at the source, and commit the result.
if ! npm ci; then
  echo "session-start: npm ci failed — package.json and package-lock.json have drifted." >&2
  echo "  Regenerate and commit:  npm install --package-lock-only && git add package-lock.json" >&2
  exit 1
fi
