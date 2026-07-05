# App Store Screenshots

Raw, unframed captures of dayGLANCE seeded with realistic demo data, for use as
the basis of App Store / Google Play listing images. Add device frames, captions,
and background styling on top of these.

## Contents

The device type is baked into each filename (`phone-…`, `tablet-…`, `desktop-…`)
so the images can be collated into a single directory without colliding.

| File | View |
|------|------|
| `phone/phone-01-glance-*.png` | Glance panel — live "now" block, GTD frame sections, habit rings, routines |
| `phone/phone-02-timeline-*.png` | Visual time-blocking timeline with the "Now" marker |
| `phone/phone-03-inbox-*.png` | Smart Inbox with priorities, tags, and project labels |
| `phone/phone-04-roadmap-*.png` | Goals Roadmap (Gantt-style timeline) with a goal's child projects |
| `phone/phone-05-daily-summary-*.png` | Daily Summary sheet (completion %, time, habits) |
| `phone/phone-06-focus-active-*.png` | Focus Mode running session (timer + task) |
| `tablet/tablet-01-timeline-*.png` | Tablet Glance sidebar + timeline |
| `tablet/tablet-02-goals-*.png` | Tablet Goals & Projects |
| `tablet/tablet-03-focus-*.png` | Tablet Focus Mode session |
| `desktop/desktop-01-timeline-*.png` | 3-column multi-day desktop overview |
| `desktop/desktop-02-goals-*.png` | Desktop Goals & Projects (Roadmap view) |

Each view is captured in both `-light` and `-dark`.

## Dimensions

- **Phone:** 1290 × 2796 px (iPhone 6.7"; within Google Play's phone bounds).
- **Tablet:** 2048 × 2732 px (iPad 12.9" portrait; 1024 × 1366 @ 2×).
- **Desktop:** 3360 × 2100 px (1680 × 1050 @ 2×).

## Regenerating

Captured with `scripts/gen-appstore-screenshots.mjs`. The clock is frozen at
Thursday 2026-07-02 11:20 AM so the day reads as *in progress* (a task is live,
the rest upcoming) rather than overdue.

```bash
npm run dev                                   # serves on http://localhost:5174
node scripts/gen-appstore-screenshots.mjs both   # light | dark | both
```

Requires Playwright + a Chromium build. On a normal machine:
`npm i -D playwright && npx playwright install chromium`, then drop the
`executablePath` override in the script (or set `CHROMIUM_PATH`).
