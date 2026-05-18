# TRMNL X Recipe Update Plan

TRMNL X is a larger 4-bit e-paper display. Its Framework introduces `lg:` responsive prefixes
that activate on larger screens while leaving the original TRMNL layout untouched. This plan
covers what to update in the recipe markup and the app's data layer to take full advantage of it.

Reference: [TRMNL X Guide](https://trmnl.com/framework/docs/trmnl_x_guide)

---

## Phase 1 — Markup-only changes (Full layout)

These require only edits to the recipe markup on TRMNL's dashboard. No app code changes.

### 1.1 Typography scale-up via `lg:` prefixes

Every `title--small` in the Full layout becomes `title--small lg:title--base`. On the original
TRMNL the small size prevents dense schedules from overflowing; on X the extra space is wasted.

Affected elements in the Full layout:
- Each task title span: `title--small` → `title--small lg:title--base`
- The right-column date heading: `title--small` → `title--small lg:title--base`
- The "UP NEXT" task title: `title--small` → `title--small lg:title--base`

Stat labels in the right column (`label`, `label--gray`) can scale up similarly:
`label` → `label lg:label--large`

### 1.2 Bigger percentage value

The hero `{{ pct }}%` value in the right column:

```html
<!-- before -->
<span class="value">{{ pct }}%</span>

<!-- after -->
<span class="value lg:value--xlarge">{{ pct }}%</span>
```

`value--xxlarge` is also worth testing if `xlarge` feels too conservative.
Avoid the mega/giga/tera/peta tiers — those are for standalone single-number dashboards,
not for a value sitting inside a 2-column layout.

### 1.3 Responsive task title clamping

Right now JS truncates titles to 40 chars. On X, longer titles can wrap to a second line
without hurting the layout. Add clamp attributes to each task title span:

```html
<span class="title title--small lg:title--base"
      data-clamp="1"
      data-clamp-lg="2"
      ...>{{ t.title }}</span>
```

This keeps a single line on OG (rows are tight) but allows 2 lines on X.
The JS truncation limit should be loosened to match — see Phase 2.

### 1.4 Responsive routine/habit columns

The routines section is a flat vertical list. On X's wider right column, it can flow into
two columns using the new responsive overflow engine:

```html
<!-- before -->
<div class="gap--medium">

<!-- after -->
<div class="columns gap--medium"
     data-overflow-max-cols="1"
     data-overflow-max-cols-lg="2">
```

Same pattern applies to the habits list if it gets long enough to benefit.

---

## Phase 2 — Markup-only changes (Mashup slots)

Half Horizontal, Half Vertical, and Quadrant layouts live inside mashup slots where the
available space is a fraction of the full screen. Use container query units (`cqw`/`cqh`)
here rather than viewport-relative sizes, because they correctly reflect the actual
slot dimensions on both OG and X.

### 2.1 Half Horizontal

- Task title: `title--small lg:title--base` (same as full layout)
- Show more tasks on X: the `limit:4` in the Liquid loop can't be made responsive in markup
  alone — keep it at 4 for now and revisit when Phase 3 adds an `upcoming_lg` variable.
- Percentage label: currently inline text; on X could become its own `value--small lg:value--base`
  element for better hierarchy.

### 2.2 Half Vertical

```html
<!-- before -->
<span class="value">{{ pct }}%</span>

<!-- after -->
<span class="value lg:value--xlarge">{{ pct }}%</span>
```

Day name: `title--small lg:title--base`

Use container query height to prevent the value from overflowing in tight portrait mashup slots:

```html
<span class="value lg:value--xlarge" style="max-height:40cqh">{{ pct }}%</span>
```

### 2.3 Quadrant

Same value scale-up as Half Vertical. The quadrant slot is small on both devices so changes
here are subtle:

```html
<span class="value lg:value--large">{{ pct }}%</span>
```

The next-task description can use `data-clamp-lg="2"` to show more text on X.

---

## Phase 3 — Data-side changes (`src/trmnl.js`)

These require app code changes and a new deployment.

### 3.1 Loosen truncation limits

Current limits were set to hit TRMNL's free-tier 2 KB payload cap. TRMNL X is a paid device,
but we can't know at push time which device a user has — so the approach is to loosen limits
modestly, staying well under ~4 KB (which all tiers support comfortably).

| Field | Current limit | Proposed |
|---|---|---|
| Task title (`schedule`) | 40 chars | 55 chars |
| Upcoming task title | 32 chars | 45 chars |
| Habit name | 20 chars | 28 chars |
| Routine name | 30 chars | 40 chars |
| Daily note snippet | 80 chars | 120 chars |

The markup uses `data-clamp` to handle overflow on OG, so longer strings won't break the
original display.

### 3.2 Expand habit and routine caps

| Collection | Current cap | Proposed |
|---|---|---|
| Habits shown | 5 | 7 |
| Routines shown | 8 | 12 |

The Full layout already iterates with `{% for h in habits %}` (no hard limit in markup),
so the extra items will appear automatically on X once the data includes them.

### 3.3 Surface upcoming tasks list

Currently `upcoming` holds the next 3 uncompleted tasks but only `next_task` (the first one)
is used by the recipe markup. Expose the full `upcoming` array so the Full layout can render
"UP NEXT" as a short list (2–3 items) on X, not just a single task:

```html
{% if upcoming.size > 0 %}
<div class="gap--small">
  <span class="label label--gray">UP NEXT</span>
  {% for u in upcoming limit:1 %}
  <span class="title title--small lg:title--base">{{ u.title }}</span>
  <span class="label">{{ u.time }}</span>
  {% endfor %}
  {% if upcoming.size > 1 %}
  {% for u in upcoming offset:1 limit:2 %}
  <span class="description lg:description--base">{{ u.time }} · {{ u.title }}</span>
  {% endfor %}
  {% endif %}
</div>
{% endif %}
```

The variable is already in the payload (`upcoming` array), so this is a markup-only change
in the recipe — but it's listed here as a reminder to bump `upcoming` slice to 5 in the
data layer:

```js
// trmnl.js — current
.slice(0, 3)

// proposed
.slice(0, 5)
```

---

## Future / Post-v2.0

### Portrait orientation layout

TRMNL X supports portrait mode. The current Full layout (two side-by-side flex columns)
would look awkward in portrait. A portrait-aware version would stack the schedule above
the stats using `portrait:layout--col` and `portrait:` responsive prefixes.

This is deferred until the app is fully stable (post-v2.0). The existing landscape layout
works fine on X and is the priority. Revisit when:
- v2.0 is shipped and stabilised
- There's a clearer sense of how many users run X in portrait mode
- TRMNL provides usage data or a device-query variable in their Liquid context

---

## Implementation order

1. **Phase 1** — edit the recipe markup in TRMNL's dashboard (no deploy needed)
2. **Phase 2** — edit mashup slot markup in TRMNL's dashboard (no deploy needed)
3. **Phase 3** — code changes in `src/trmnl.js`, test, deploy
4. **Portrait** — post-v2.0, revisit

---

*Last updated: 2026-03-28*
