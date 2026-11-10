# Releasing dayGLANCE

The runbook for shipping a dayGLANCE release across web, Electron desktop
(direct + Mac App Store), Android, and iOS. `package.json` "version" is the
single source of truth; the version bumper propagates it everywhere else.

Reference IDs and URLs:

- Apple App Store app ID (`APPLE_APP_ID`): `6771540599` (wired into the README
  and the web smart app banner).
- Privacy policy: https://www.glance-apps.com/dayglance/privacy (the
  dayGLANCE per-app policy; the GLANCE Apps umbrella policy covering the site
  and the other apps is a separate document). Note the `www.`: this exact
  form is what App Store Connect and the Play Console hold, so the in-app
  links use it too. The old location, https://docs.dayglance.app/en/privacy-policy,
  is now a stub page that tells the reader the policy has moved; it is not a
  redirect, so do not treat it as a live address for a store listing.
- EULA: https://www.glance-apps.com/eula

---

## 1. Pre-release checklist

### 1.1 Bump the version

Use the bumper, never hand-edit the numbers:

```
npm run bump 4.0.0            # preview with --dry-run first if unsure
```

This updates `package.json` "version", the Android `versionName` (full x.y.z),
and the README shields.io badge. iOS `MARKETING_VERSION` and the Electron
`CFBundleShortVersionString` derive from `package.json` at build time, so they
need no manual edit. Review the diff and commit the bump before building.

The Android `versionCode` is no longer part of the bump (and `--code-only` is
gone): `build-and-install.sh --release` supplies it per build via
`-PversionCode`, suggesting last-used + 1 from `outputs/.last-versioncode`, or
takes an explicit `--build N`. No commit is needed per Play upload.

### 1.2 Quality gates

```
npm run lint
npm test
```

Both must be clean and green before tagging.

Run `npm ci` before building the Android and iOS bundles. They are built
locally, from whatever `node_modules` holds, and `build:android` /
`build:ios` now refuse to run when it differs from `package-lock.json`
(`scripts/check-installed-deps.mjs`). The 5.8.0 Android APK shipped with a
stale `@glance-apps/sync` and broke WebDAV sync (#2090).

### 1.3 Device smoke tests

Run these once each on real hardware or a representative simulator:

- iOS: external links open in the system browser; the HealthKit permission
  prompt is deferred until first use (not on launch); a vault SSE
  auth-failure surfaces to the user once (no silent retry storm).
- iOS: each Control Center control (Scheduled Task, Inbox Task, Voice Task)
  foregrounds the app AND opens its UI, from a cold start and from the
  background. Tapping a control has to launch the app before the pending
  action can be drained, and a control whose intent is not compiled into the
  app target silently does neither. `src/iosControls.test.js` guards the
  project layout that makes this work, but only a device proves the launch.
- iOS: the Up Next widget's Complete and Start Focus buttons foreground the
  app and apply the action. Confirmed working in the released 4.6.0, so
  unlike the Control Center controls these do NOT need their intent in the
  app target: `openAppWhenRun` foregrounds the app from an extension-only
  widget intent. Keep the check as a regression guard, and do not "fix"
  WidgetIntents.swift by moving it to `Shared/` without a failure to point
  at. Its `ForegroundContinuableIntent` conformances are marked
  `@available(iOSApplicationExtension, unavailable)` in a file only the
  extension target builds, so they may well be inert, but the behavior they
  supposedly guard has never actually broken. Leave them be.
- Android: vault SSE stream connects and the WebView renders the app.
- Android: a real purchase completes and is acknowledged, and the app
  recovers when the billing service is not ready at first tap (honest
  message, then a successful retry after reconnect).
- Electron: the Mac App Store restore-purchase flow works, and the
  file-to-app storage migration runs cleanly on an upgrade.
- Electron: voice input works WITHOUT an AI provider (AI off in Settings):
  the mic button records through the bundled speech helper, a live partial
  transcript appears while speaking, and stopping yields a parsed task. Then
  with a transcribing provider on, the same flow through Whisper, and the
  "Heard:" line above the preview shows the transcript. Both MUST run on the
  signed build: an unsigned dev build has no Hardened Runtime, so it cannot
  reveal a missing entitlement, and `webkitSpeechRecognition` in Chromium is
  no stand-in for the helper — it fails with `network` in every packaged
  build. Until this check existed, nothing in the release path would have
  noticed desktop voice input being dead.

Local integrations (Electron), whenever the MCP surface has changed:

- Fresh install has the server off and nothing bound on 7893.
- Each of the three consent tiers cannot be enabled without passing its
  own copy, and the device-calendar tier is its own separate dialog.
- A read and a write both succeed from a real client. Claude Code
  connects directly; Claude Desktop needs the bridge.
- The setup button, run on macOS AND on Windows, on the real installed
  artifact. Not one platform standing in for the other: extraResources is
  declared per platform, so the two builds can and did disagree about
  whether the bridge is present at all. Confirm Claude Desktop actually
  starts the server afterward, because a written config proves only that
  the file was written.

  Plan for this one. The button writes an `mcpServers` entry into
  `claude_desktop_config.json`, while the `.mcpb` bundle installs through
  Claude Desktop's Extensions pane — two independent mechanisms, neither
  aware of the other, so a day-to-day machine running the extension cannot
  test the button without disturbing the setup you rely on. Use a second
  machine, a VM, or a spare Claude Desktop profile rather than uninstalling
  the extension. If both paths are ever active at once, expect Claude
  Desktop to list the dayGLANCE tools twice; they reach the same listener,
  so it is a confusing surface rather than a correctness problem.
- A write syncs to a second device and survives a tombstone cycle. This
  needs two real devices, not a local write test.
- Per-task and bulk undo both reverse a write, and an undone create
  lands in the recycle bin.
- The kill switch stops the listener, and a connected client then fails
  to reach it.
- The MAS build has the bridge path compiled out: no setup button, no
  discovery file written, manual token configuration only.

### 1.4 App Store Connect metadata

Confirm the listing has:

- Privacy policy URL: https://www.glance-apps.com/dayglance/privacy (exact
  `www.` form, matching what is already in ASC and Play).
- Support URL set.
- EULA: https://www.glance-apps.com/eula
- Review notes disclose the reviewer-unlock code so the reviewer can get past
  the paywall.
- Review notes cover the loopback listener whenever a release changes it:
  that it is off by default behind explicit consent, that the app never
  downloads or executes an external component (connecting a client needs a
  bridge the user installs themselves), and that 127.0.0.1 is the same
  architecture as the Stream Deck listener already resolved under Guideline
  2.4.5(i). Testing it needs an MCP client, so link the bridge bundle and
  offer the demo video as the alternative.
- ATS justification documented for user-configured http WebDAV/CalDAV
  endpoints (arbitrary-loads is allowed because the server address is
  user-provided, not an app-controlled host).

---

## 2. Build and sign per platform

### Web (Vercel)

Production deploys from the default branch via Vercel. No manual build step;
merging to the production branch ships the web app.

### Electron desktop (direct distribution)

Handled by CI. `.github/workflows/release-desktop.yml` runs on a `v*` tag push
(or manual dispatch) and builds the macOS DMG/zip (signed + notarized via
`CSC_LINK`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
`MAC_PROVISIONING_PROFILE`), the Windows `.exe`, and the Linux `.AppImage`,
then attaches them to a DRAFT GitHub release.

### Electron Mac App Store (MAS)

Built locally (not in CI):

```
npm run build:electron:mas
```

Produces a universal MAS package for upload to App Store Connect via Transporter
or Xcode.

### Android (AAB + APK)

```
./build-and-install.sh --release
```

Builds the Play AAB (`outputs/dayglance.aab`) for the Play Store plus the Play
and GitHub release APKs (`outputs/dayglance.apk`, `outputs/dayglance-github.apk`).
Upload the AAB to the Play Console; keep the GitHub APK for the release assets.

### iOS

```
npm run ios            # build:ios + ios:generate
```

`npm run ios:generate` MUST run after the bump so the regenerated Xcode project
picks up the new `MARKETING_VERSION` from `package.json` (a bare `xcodegen`
would leave it empty). Then open `dayglance-ios/DayGlance.xcodeproj` in Xcode,
archive, and upload to App Store Connect.

**TestFlight builds of unreleased work.** App Store Connect refuses any upload
whose marketing version is already published, so once a version is live, a test
build has to carry the next one. Override it for a single build without editing
`package.json`:

```
MARKETING_VERSION=5.7.0 npm run ios
```

The build number stays date-based, so repeated test builds under the same
override still upload. The release itself is still made through the bumper.

**App icons.** Only when the logo changes: `npm run ios:icons` (macOS) rewrites
every size in `AppIcon.appiconset` from `public/icon-maskable-512.png`, or from
a path passed after `--`. The source must be opaque: App Store Connect rejects a
1024px icon with an alpha channel.

---

## 3. Release sequencing

Order matters, because publishing the GitHub release is what triggers the
downstream Docker and website workflows. Do it LAST.

Tag only from a commit that carries the bump. A tag pushed from any other
commit still fires `release-desktop.yml` and produces a draft release for a
version that does not exist (this happened to `v4.3.1`). Delete such a tag on
both sides rather than leaving it in the history.

If the release changes the MCP surface, `@glance-apps/mcp-bridge` ships on its
own timeline in its own repo. Publish the npm package and the `.mcpb` bundle
BEFORE this release, so the setup button and the documented install paths work
the moment the desktop builds land.

1. Push the version tag: `git tag v4.0.0 && git push origin v4.0.0`.
2. CI (`release-desktop.yml`) builds the desktop apps and creates a DRAFT
   release with the DMG/zip/exe/AppImage attached.
3. Manually attach the Android GitHub APK (`outputs/dayglance-github.apk`) to
   the draft.
4. Write the release notes.
5. PUBLISH the release LAST. Publishing fires:
   - `publish-ghcr.yml`: builds and pushes the multi-arch Docker image to
     GHCR (tags: semver, major.minor, latest).
   - `trigger-site-rebuild.yml`: POSTs the Vercel deploy hook to rebuild
     glance-apps.com so the site reflects the new release.

Submit the App Store (iOS + MAS) and Play Store builds for review in parallel;
their approval timelines are independent of the GitHub release.

---

## 4. Post-release verification

- App Store / Play Store / MAS listings show the new version once approved.
- GHCR image published: `ghcr.io/<owner>/dayglance:4.0.0` and `:latest`
  pulled and run.
- glance-apps.com rebuilt and shows the new release.
- GitHub release has all desktop artifacts plus the Android APK attached.

---

## 5. Shared packages (`@glance-apps/*` in `packages/`)

The app links these with `file:`, so an app release never needs them
published. They are also on npm for anyone building on them outside this
repository (an external MCP server, a GLANCEvault-client host), and that copy
is the one that has to be kept current. A package release is an npm publish
plus a git tag `<dir>@<version>` (for example `dayglance-vault@0.2.1`) on the
commit it was published from. They ship on their own timeline, independent of
the app's version.

`scripts/packages-release.mjs` does the bookkeeping:

```
npm run packages                                   # status of every package (read-only)
npm run packages -- bump <pkg> <patch|minor|x.y.z>   # on a branch; then commit and merge
npm run packages -- publish                        # on main: checks only
npm run packages -- publish --yes                  # publish, tag, push the tags
npm run packages -- tag-missing [--yes]            # tag versions on npm that lack one
```

`status` compares each package with npm and git and says what it needs:

- **publish:** its version is not on npm yet.
- **bump:** its source changed after the version on npm, but the version was
  not raised, so the change cannot be published. Tests are ignored.
- **tag:** npm has the version but git has no tag for it.
- **ok:** nothing to do.

`bump` sets the version in the package's `package.json` and in both lockfiles
(the root's and the Obsidian plugin's). It refuses when another package's
range would no longer accept the new version; `--update-dependents` moves
those ranges to `^<new>`, and those packages then need a bump of their own.
These packages are 0.x: an additive change is a patch, a change that drops or
changes an export is a minor.

`publish` without `--yes` checks everything and changes nothing. It needs a
clean tree on `main`, level with `origin/main`; runs each package's tests and
`npm publish --dry-run`; and confirms that every local package it requires is
satisfied by the local version and is on npm already or published in the same
run. With `--yes` it publishes in dependency order (agenda-core and
obsidian-format before the packages that build on them), tags each one as it
goes, and pushes the tags. If one fails it stops, pushes the tags it made, and
a re-run picks up from there. It needs `npm login`.
