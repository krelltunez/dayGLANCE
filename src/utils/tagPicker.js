// The task editor's tag picker (#2308): what it lists for one title. Pure.
//
// A tag is a `#word` in the title (taskUtils.js), so the picker has no field
// of its own: picking a tag adds `#tag` to the title and unpicking removes it
// (utils/tagManager.js, toggleTagInTitle). What it lists is the tag manager's
// list (collectTags), in the tag manager's order (by name), filtered the way
// the tag manager's search filters, with the title's own tags added so a tag
// typed into this title and not yet saved can be unpicked too.
import { extractTags } from './taskUtils.js';
import { normalizeTagInput } from './tagManager.js';

/**
 * `#obsidian` is not offered. Saving a new task that carries it writes the
 * task into today's Obsidian daily note (useTaskActions.addTask), a side
 * effect a chip should not hide. Typed into the title, it shows as picked,
 * and can be unpicked.
 */
export const SIDE_EFFECT_TAGS = Object.freeze(['obsidian']);

/** From this many tags, the picker's field says it searches as well as adds. */
export const SEARCH_FROM = 8;

/** The title's tags, once each, lower-cased, in the order they appear. */
export const titleTags = (title) => [...new Set(extractTags(title))];

/** What the picker's search box holds, as the tag manager reads it. */
export const tagQuery = (query) => String(query ?? '').trim().replace(/^#/, '').toLowerCase();

/**
 * The picker's list for `title`: `{ selected, options, create }`.
 * - `selected`: the title's tags, in title order.
 * - `options`: `{ tag, selected }`, by name, the tags in use (`collected`,
 *   collectTags' entries or plain names) and the title's own, matching
 *   `query` as the tag manager's search matches (a substring, without case
 *   or a leading `#`). Side-effect tags only when the title has them.
 * - `create`: the tag "Add #…" would add, when `query` is one valid tag
 *   name (normalizeTagInput) that is neither listed nor a side-effect tag.
 */
export function tagPickerOptions({ collected = [], title = '', query = '' } = {}) {
  const selected = titleTags(title);
  const picked = new Set(selected);
  const names = new Set();
  for (const entry of collected) {
    const tag = typeof entry === 'string' ? entry.toLowerCase() : entry?.tag;
    if (tag && (!SIDE_EFFECT_TAGS.includes(tag) || picked.has(tag))) names.add(tag);
  }
  for (const tag of selected) names.add(tag);
  const all = [...names].sort((a, b) => a.localeCompare(b));
  const q = tagQuery(query);
  const options = (q ? all.filter((tag) => tag.includes(q)) : all).map((tag) => ({ tag, selected: picked.has(tag) }));
  const name = normalizeTagInput(query);
  const create = name && !names.has(name) && !SIDE_EFFECT_TAGS.includes(name) ? name : null;
  return { selected, options, create, total: all.length };
}

/**
 * The tag Enter in the search box adds: the tag typed, when it is listed;
 * else the first listed tag not yet picked that starts with what was typed;
 * else the new tag on offer. Enter never removes a tag, nor adds a longer one
 * in place of one already picked: null when it has nothing to add.
 */
export function enterTagChoice({ options, create }, query) {
  const q = tagQuery(query);
  if (!q) return null;
  const exact = options.find((o) => o.tag === q);
  if (exact) return exact.selected ? null : exact.tag;
  return options.find((o) => !o.selected && o.tag.startsWith(q))?.tag ?? create ?? null;
}
