#!/usr/bin/env bash
# Copy the assembled plugin tree into a checkout of glance-apps/dayglance-bridge
# and push it (called by .github/workflows/bridge-mirror.yml on main).
#
#   sync.sh <tree-dir> <mirror-checkout> <source-sha>
#
# THE MIRROR'S main SAYS WHAT IS PUBLISHED. Obsidian's community directory
# (and BRAT) read manifest.json at the head of main and install from the
# release whose tag matches its version. So manifest.json and versions.json
# on main change only when a release is PUBLISHED (the mirror's
# publish-manifest workflow), never when a version bump is merged here:
# otherwise, between the merge and the publish, main would name a version
# whose release is still a draft.
#
# So the code on main follows this repository, but those two files keep
# main's own copies. A version main has not tagged yet gets a tag on a
# commit of its own, one step past main's head, carrying the new
# manifest.json and versions.json: the mirror's release workflow builds that
# tag into a draft release, as before. The tag's commit is not on main.
set -euo pipefail

tree=$(cd "$1" && pwd)
mirror=$2
sha=$3
cd "$mirror"

held=$(mktemp -d)
trap 'rm -rf "$held"' EXIT
held_files=()
for f in manifest.json versions.json; do
  if git cat-file -e "HEAD:$f" 2>/dev/null; then
    git show "HEAD:$f" > "$held/$f"
    held_files+=("$f")
  fi
done

# The mirror's LICENSE is its own; everything else is replaced, so a file
# removed here is removed there too.
find . -mindepth 1 -maxdepth 1 ! -name .git ! -name LICENSE -exec rm -rf {} +
cp -a "$tree/." ./
version=$(node -p "require('./manifest.json').version")
for f in ${held_files[@]+"${held_files[@]}"}; do cp "$held/$f" "$f"; done

git add -A
if git diff --cached --quiet; then
  echo "The mirror is already up to date."
else
  git commit -q -m "Mirror krelltunez/dayGLANCE@${sha::12}" \
    -m "https://github.com/krelltunez/dayGLANCE/commit/${sha}"
  git push -q origin HEAD:main
fi

if git ls-remote --exit-code --tags origin "refs/tags/$version" >/dev/null; then
  echo "Version $version is already tagged."
else
  cp "$tree/manifest.json" manifest.json
  cp "$tree/versions.json" versions.json
  git add manifest.json versions.json
  # --allow-empty: a mirror with no published files yet already carries them.
  git commit -q --allow-empty -m "Release $version" \
    -m "manifest.json and versions.json for the release; main keeps the published ones until it is published." \
    -m "https://github.com/krelltunez/dayGLANCE/commit/${sha}"
  git tag "$version"
  git push -q origin "refs/tags/$version"
  echo "Tagged $version: the mirror's release workflow builds it into a draft release. Publishing it updates main's manifest.json."
fi
