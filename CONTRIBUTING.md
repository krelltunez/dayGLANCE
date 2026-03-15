# Contributing to dayGLANCE

Thanks for your interest in contributing! Whether you're fixing a typo, squashing a bug, or building a new feature, you're welcome here. This guide will get you up and running.

---

## Table of Contents

- [Running the app locally](#running-the-app-locally)
- [Running tests](#running-tests)
- [Project structure](#project-structure)
- [Making a pull request](#making-a-pull-request)
- [Reporting bugs](#reporting-bugs)

---

## Running the app locally

**Prerequisites:** Node.js 18+ and npm.

```bash
git clone https://github.com/krelltunez/dayGLANCE.git
cd dayGLANCE
npm install
npm run dev
```

The app will be available at `http://localhost:5173`. It hot-reloads on save.

Other useful commands:

| Command | What it does |
|---|---|
| `npm run build` | Production web build |
| `npm run preview` | Preview the production build locally |
| `npm run build:android` | Build the web bundle for the Android app |

### Android app

The Android app is a WebView shell that loads the bundled web app. To build and install it on a connected device:

```bash
./build-and-install.sh
```

**Prerequisites for Android:**
- Android Studio or the Android SDK command-line tools
- A `keystore.properties` file (copy from `keystore.properties.example` and fill in your signing details)
- Min SDK 26 (Android 8.0), target SDK 35

The web bundle is copied into `dayglance-android/app/src/main/assets/web/` as part of the build.

---

## Running tests

```bash
npm run test
```

Tests run with [Vitest](https://vitest.dev/). Test files live next to the source files they cover and use the `.test.js` suffix (e.g. `mergeSync.test.js`).

When adding new logic, please add a test file alongside it if the logic is non-trivial (data transformations, sync/merge behaviour, etc.). UI-heavy code doesn't need to be tested exhaustively.

---

## Project structure

```
dayGLANCE/
├── src/
│   ├── App.jsx             # Main React component — most UI and app logic lives here
│   ├── main.jsx            # Entry point
│   ├── ai.js               # AI provider integration (API calls, config)
│   ├── ai-prompts.js       # Prompt templates for all AI features
│   ├── native.js           # Bridge to Android native APIs
│   ├── obsidian.js         # Obsidian vault integration
│   ├── mergeSync.js        # Data merge/sync utilities
│   ├── trmnl.js            # TRMNL e-ink display integration
│   └── versionCheck.js     # Update checking
├── public/                 # Static assets (icons, service worker)
├── dayglance-android/      # Android native wrapper (Kotlin/WebView)
│   └── app/src/main/
│       ├── java/com/dayglance/app/
│       │   ├── MainActivity.kt          # WebView shell
│       │   ├── widget/                  # Home screen widget
│       │   └── bridge/                  # Native bridge implementations
│       └── res/layout/widget_*.xml      # Widget layouts
├── api/                    # Backend/API utilities
├── vite.config.js          # Web build config
├── vite.config.android.js  # Android-specific build config
└── build-and-install.sh    # Full Android build + install script
```

`App.jsx` is large and intentionally monolithic for now — if you're looking for a specific feature, search for a comment or UI string rather than browsing linearly.

---

## Making a pull request

1. **Fork the repo** and create a branch from `main`:
   ```bash
   git checkout -b my-fix-or-feature
   ```

2. **Keep changes focused.** One logical change per PR makes review much easier. If you find an unrelated bug while working, open a separate issue or PR for it.

3. **Test your change** — run `npm run test` and make sure nothing is broken. If you're touching the Android widget, build and check it on a real device or emulator if you can.

4. **Write a clear PR description.** Explain *what* changed and *why* — not just what the code does. If it fixes a bug, link the issue.

5. **Don't sweat perfection.** If you're unsure about something, open the PR as a draft and ask. We'd rather see a rough PR than no PR.

### Guidelines

- Follow the existing code style. The project uses standard React/JSX conventions and Tailwind for styling.
- Avoid adding dependencies unless necessary — the bundle size matters on mobile.
- Plain text only in AI prompt responses — no markdown or emojis (see `ai-prompts.js` for examples).
- Widget layouts use `sp` units for text and `dp` for spacing. Minimum text size is `11sp`.

---

## Reporting bugs

Please [open an issue](https://github.com/krelltunez/dayGLANCE/issues) and include:

- **What you expected** to happen
- **What actually happened** (error message, screenshot, or screen recording if relevant)
- **Steps to reproduce** — the more specific, the better
- **Environment:** browser/OS, or Android version and device if it's an Android-specific issue

If you're not sure whether something is a bug or by design, open an issue anyway and we'll figure it out together.
