# @glance-apps/obsidian-format

The dayGLANCE ⇄ Obsidian vault **line-format core**, shared verbatim by the
dayGLANCE app and the dayglance-bridge Obsidian plugin so that two codebases
can never grow two lookalike parsers. A lookalike parser — same grammar,
independently maintained — is how cross-version identity divergence starts;
this package exists so "the same parser" is literally the same code.

## The boundary principle

**The package is format, never policy. It should not know an ownership rule
exists.**

What lives here: line identity (`^dg-` block ids, deterministic derivation,
legacy content hashing), decorations (completion markers, Tasks-plugin
metadata, creation frontmatter), line building and rewriting (prefixes, the
section sort, `updateTaskLines`), note naming (daily-note filename patterns,
portability validators), and the task-line parser. The bridge stream's wire
format lives here too (sealed envelopes, intents, observations), with the
reading of it a consumer without a vault needs: a note's latest reported
state, and a linked note's description section from it
(`noteObservations.js`: `noteDescriptionFromObservations`,
`bridgeNoteDescriptionLoader`), as current as the plugin's last report.

What must never live here: transports (File System Access, Electron IPC, the
Android/iOS bridges), sync and merge logic, and every ownership rule — who
wins a title conflict, when a vault metadata edit is adopted, whose record a
completion timestamp is. Those are dayGLANCE's decisions, made at dayGLANCE's
single policy points (see `docs/obsidian-buildout-spec.md` §3.10 in the
dayGLANCE repo). Where a format function borders a policy decision (the
write-time title guard inside `updateTaskLines`), it reports through a
callback and the caller decides.

## Stability

Much of this code is **frozen by contract**: `deriveBlockId` is pinned by
golden values, and the marker/metadata grammars are pinned by byte-exactness
tests, because tokens and lines written by different app versions must agree
forever. The frozen-behavior tests live in this package, beside the code they
pin, and travel with it.

## Consumption

Consumed by dayGLANCE and the bridge plugin via a `file:` link in the
dayGLANCE repository. The plugin's public repository,
[glance-apps/dayglance-bridge](https://github.com/glance-apps/dayglance-bridge),
which Obsidian's community directory reads, carries a copy under `packages/`,
refreshed from here on every change, so the two sides always build from the
same code. Import specifiers are the package name everywhere.
