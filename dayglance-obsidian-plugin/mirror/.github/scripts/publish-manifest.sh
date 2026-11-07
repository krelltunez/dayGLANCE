#!/usr/bin/env bash
# A release was PUBLISHED: point main's manifest.json and versions.json at it
# (called by .github/workflows/publish-manifest.yml).
#
#   publish-manifest.sh <tag>
#
# Obsidian's community directory and BRAT read manifest.json at the head of
# main and install from the release whose tag matches. The mirror workflow in
# krelltunez/dayGLANCE keeps main's copies at the last published version and
# puts a new version's files on its tag's commit only, so a version reaches
# users when its release is published, never while it is a draft. This copies
# the tag's two files to main. A tag that is not newer than main's version
# (republishing an old release, a hotfix of an older line) changes nothing.
#
# This repository is generated from krelltunez/dayGLANCE
# (dayglance-obsidian-plugin/mirror/): change it there.
set -euo pipefail

tag=$1
git fetch -q origin main "+refs/tags/$tag:refs/tags/$tag"

newer() { # is $1 a newer x.y.z than $2?
  node -e '
    const p = (v) => String(v).split(".").map((n) => parseInt(n, 10) || 0);
    const [a, b] = [p(process.argv[1]), p(process.argv[2])];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] || 0) !== (b[i] || 0)) process.exit((a[i] || 0) > (b[i] || 0) ? 0 : 1);
    }
    process.exit(1);
  ' "$1" "$2"
}

for attempt in 1 2 3; do
  git checkout -q -B main origin/main
  current=$(node -p "require('./manifest.json').version")
  if ! newer "$tag" "$current"; then
    echo "main already names $current; $tag is not newer, nothing to change."
    exit 0
  fi
  git show "refs/tags/$tag:manifest.json" > manifest.json
  git show "refs/tags/$tag:versions.json" > versions.json
  git add manifest.json versions.json
  git commit -q -m "Published $tag: manifest.json and versions.json"
  if git push -q origin HEAD:main; then
    echo "main now names $tag."
    exit 0
  fi
  echo "main moved meanwhile (attempt $attempt); retrying."
  git fetch -q origin main
done
echo "Could not update main after 3 attempts." >&2
exit 1
