# App Store Screenshots

Raw, unframed captures of dayGLANCE seeded with realistic demo data, for use as
the basis of App Store / Google Play listing images. Add device frames, captions,
and background styling on top of these.

## Contents

| File | View |
|------|------|
| `phone/01-glance-*.png` | Glance panel — live "now" block, upcoming tasks, habit rings, routines |
| `phone/02-timeline-*.png` | Visual time-blocking timeline with the "Now" marker |
| `phone/03-inbox-*.png` | Smart Inbox with priorities, tags, and project labels |
| `phone/04-goals-*.png` | Goals & Projects with progress bars |
| `phone/05-daily-summary-*.png` | Daily Summary sheet (completion %, time, habits) |
| `phone/06-focus-*.png` | Focus Mode (Pomodoro) setup |
| `desktop/01-overview-*.png` | 3-column multi-day desktop overview |

Each view is captured in both `-light` and `-dark`.

## Dimensions

- **Phone:** 1290 × 2796 px (iPhone 6.7"; within Google Play's phone bounds).
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
