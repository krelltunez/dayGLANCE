# Releasing dayGLANCE

The runbook for shipping a dayGLANCE release across web, Electron desktop
(direct + Mac App Store), Android, and iOS. `package.json` "version" is the
single source of truth; the version bumper propagates it everywhere else.

Reference IDs and URLs:

- Apple App Store app ID (`APPLE_APP_ID`): `6771540599` (wired into the README
  and the web smart app banner).
- Privacy policy: https://docs.dayglance.app/en/privacy-policy
- EULA: https://www.glance-apps.com/eula

---

## 1. Pre-release checklist

### 1.1 Bump the version

Use the bumper, never hand-edit the numbers:

```
npm run bump 4.0.0            # preview with --dry-run first if unsure
```

This updates `package.json` "version", the Android `versionName` (full x.y.z)
and `versionCode` (+1), and the README shields.io badge. iOS
`MARKETING_VERSION` and the Electron `CFBundleShortVersionString` derive from
`package.json` at build time, so they need no manual edit. Review the diff and
commit the bump before building.

### 1.2 Quality gates

```
npm run lint
npm test
```

Both must be clean and green before tagging.

### 1.3 Device smoke tests

Run these once each on real hardware or a representative simulator:

- iOS: external links open in the system browser; the HealthKit permission
  prompt is deferred until first use (not on launch); a vault SSE
  auth-failure surfaces to the user once (no silent retry storm).
- Android: vault SSE stream connects and the WebView renders the app.
- Electron: the Mac App Store restore-purchase flow works, and the
  file-to-app storage migration runs cleanly on an upgrade.

### 1.4 App Store Connect metadata

Confirm the listing has:

- Privacy policy URL: https://docs.dayglance.app/en/privacy-policy
- Support URL set.
- EULA: https://www.glance-apps.com/eula
- Review notes disclose the reviewer-unlock code so the reviewer can get past
  the paywall.
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

---

## 3. Release sequencing

Order matters, because publishing the GitHub release is what triggers the
downstream Docker and website workflows. Do it LAST.

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
