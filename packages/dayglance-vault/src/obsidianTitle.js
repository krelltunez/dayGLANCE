// The merge rule for an Obsidian task's title, which both sync tiers and the
// app's apply step use.
//
// A vault line whose title still carries `^dg-` after its trailing token is
// split off is DAMAGED: a merge of concurrent edits ran two lines together, or
// a token was doubled or typed into the middle of the line. The app refuses
// to take a damaged line's title (src/obsidian.js, carriesStrayBlockToken), but
// a device on a build without that refusal takes it, stamps the change as an
// edit, and its copy is newer. Every merge keeps the newer copy WHOLE, so the
// damaged title then replaced the clean one on every device, the guarded ones
// included (2026-11-28 device test: `ZZ tick test five ^dg-abcd1234 extra`).
//
// The rule: when the winning copy's title (or raw line title) carries `^dg-`
// and another copy of the same Obsidian task has one that does not, the clean
// one is kept. Each field is decided on its own. A clean winner is never
// replaced, so a real retitle propagates on its own timestamp; two copies, one
// clean and one damaged, give the clean text whichever wins, so the result does
// not depend on the order the tiers apply it, and applying it again changes
// nothing. Two damaged copies are left as they are: the next clean report of
// the line repairs them.

/** A title with our block marker left inside it. */
export function carriesStrayBlockToken(text) {
  return typeof text === 'string' && text.includes('^dg-');
}

const isObsidian = (t) => !!t && t.importSource === 'obsidian';
const cleanText = (t, field) => (isObsidian(t) && typeof t[field] === 'string' && !carriesStrayBlockToken(t[field]) ? t[field] : null);

function carriedField(winner, others, field) {
  if (!isObsidian(winner) || !carriesStrayBlockToken(winner[field])) return winner?.[field];
  for (const other of others) {
    const clean = cleanText(other, field);
    if (clean !== null) return clean;
  }
  return winner[field];
}

/**
 * The `title` and `obsidianRawTitle` the merged copy should carry: the
 * winner's own, or, for a field the winner holds damaged, the first other
 * copy's clean value. Returns the winner's values unchanged when there is
 * nothing to carry.
 */
export function carriedObsidianTitle(winner, ...others) {
  return {
    title: carriedField(winner, others, 'title'),
    obsidianRawTitle: carriedField(winner, others, 'obsidianRawTitle'),
  };
}
