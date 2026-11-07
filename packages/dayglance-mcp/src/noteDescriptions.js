// A linked goal's or project's description, on the read side: the goal tree
// read fills each linked entity's description from its note's opening
// section (companion spec §4.3, 2026-10-03), through a loader the caller
// injects. Moved verbatim from the app's src/utils/mcpNoteDescriptions.js
// (#2280), which keeps the write half and re-exports this.
//
// The loader is `loadNoteDescription(path)`, resolving to { text, base },
// plus `observedAt` when the text is the plugin's report of the note rather
// than a file read, { notFound: true }, or null when the note cannot be read
// here. The desktop
// app passes its Obsidian hook's loader, which reads vault files; a
// GLANCEvault-client host, which has no vault folder, passes one built from
// the bridge's observation stream (@glance-apps/obsidian-format's
// bridgeNoteDescriptionLoader), as current as the plugin's last report.
// Pure orchestration: no imports, no React, no vault.

/** How many linked entities one goal-tree read will open notes for, and how long it may take in all. */
export const DESCRIPTION_READ_CAP = 40;
export const DESCRIPTION_READ_BUDGET_MS = 2000;

const withTimeout = (promise, ms) => new Promise((resolve) => {
  const timer = setTimeout(() => resolve(undefined), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(undefined); });
});

/**
 * Fill `description` on every linked goal and project in a goal_progress
 * result from the note itself, marking the source and carrying the
 * section's hash as `description_base` for a later refuse-on-change write.
 * An entity whose note cannot be read on this device keeps the pointer it
 * already carries. Mutates nothing: returns a new data object.
 */
export async function enrichGoalTreeDescriptions(data, { loadNoteDescription } = {}) {
  if (!data || typeof loadNoteDescription !== 'function') return data;
  const targets = [];
  const goals = (data.goals ?? []).map((g) => ({ ...g, projects: (g.projects ?? []).map((p) => ({ ...p })) }));
  const standalone = (data.standalone_projects ?? []).map((p) => ({ ...p }));
  for (const g of goals) {
    if (g.obsidian_note && !g.obsidian_note.missing) targets.push(g);
    for (const p of g.projects) if (p.obsidian_note && !p.obsidian_note.missing) targets.push(p);
  }
  for (const p of standalone) if (p.obsidian_note && !p.obsidian_note.missing) targets.push(p);
  if (targets.length === 0) return { ...data, goals, standalone_projects: standalone };
  const chosen = targets.slice(0, DESCRIPTION_READ_CAP);
  const reads = chosen.map((entity) => withTimeout(
    Promise.resolve().then(() => loadNoteDescription(entity.obsidian_note.path)),
    DESCRIPTION_READ_BUDGET_MS,
  ));
  const results = await Promise.all(reads);
  results.forEach((r, i) => {
    if (!r || r.notFound || typeof r.text !== 'string') return;
    const entity = chosen[i];
    entity.description = r.text;
    entity.description_source = 'obsidian_note';
    if (r.base) entity.description_base = r.base;
    // Read from the plugin's report of the note rather than a file (a host
    // with no folder; the app where its folder cannot read the note or is
    // behind, #2291): as current as that report, which says when it was.
    if (typeof r.observedAt === 'string' && r.observedAt) entity.description_reported_at = r.observedAt;
  });
  return { ...data, goals, standalone_projects: standalone };
}
