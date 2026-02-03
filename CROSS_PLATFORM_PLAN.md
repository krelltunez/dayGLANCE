# Cross-Platform Day Planner Plan

## Tech Stack
- **App Framework**: Tauri 2.0
- **Frontend**: React + Vite (existing)
- **Backend/Sync**: Firebase (Firestore + Auth)
- **Styling**: Tailwind CSS (existing)

## Platform Priority
1. macOS (primary)
2. iOS
3. Android
4. Windows (optional)

---

## Phase 1: Firebase Integration (Web)

Before touching Tauri, add Firebase to the existing web app.

### Setup
1. Create Firebase project at console.firebase.google.com
2. Enable Firestore and Authentication
3. Install dependencies:
   ```bash
   npm install firebase react-firebase-hooks
   ```

### Implementation
1. Create `src/firebase.js` with Firebase config
2. Set up Firestore security rules
3. Add authentication (email/password recommended for simplicity)
4. Migrate local state to Firestore:
   - Tasks/events stored in user's Firestore collection
   - Real-time listeners for instant sync
   - Offline persistence enabled by default

### Data Structure (suggested)
```
users/{userId}/tasks/{taskId}
  - title: string
  - date: timestamp
  - duration: number
  - completed: boolean
  - priority: string
  - createdAt: timestamp
  - updatedAt: timestamp
```

---

## Phase 2: macOS App (Tauri)

### Setup
1. Install Tauri CLI:
   ```bash
   npm install -D @tauri-apps/cli @tauri-apps/api
   npx tauri init
   ```

2. Configure `tauri.conf.json`:
   - App name, identifier (com.yourname.dayplanner)
   - Window settings
   - Permissions for file system, notifications

### Native Features
- **Menu bar**: Tauri's menu API
- **Notifications**: `@tauri-apps/plugin-notification`
- **File system**: `@tauri-apps/plugin-fs` (for exports/backups)
- **Auto-start**: `@tauri-apps/plugin-autostart` (optional)

### Build & Distribution
```bash
npm run tauri build
```
- Produces `.dmg` for macOS
- Code signing: Requires Apple Developer account ($99/year)
- Notarization: Required for distribution outside App Store

---

## Phase 3: iOS App

### Prerequisites
- macOS with Xcode installed
- Apple Developer account

### Setup
1. Initialize Tauri mobile:
   ```bash
   npx tauri ios init
   ```

2. Configure iOS-specific settings in `tauri.conf.json`

### Considerations
- **Auth**: Test `signInWithRedirect` or use email/password
- **Push notifications**: May need Firebase Cloud Messaging setup
- **App Store**: Requires review process

### Build
```bash
npx tauri ios build
```

---

## Phase 4: Android App

### Prerequisites
- Android Studio installed
- Android SDK

### Setup
1. Initialize Tauri Android:
   ```bash
   npx tauri android init
   ```

### Considerations
- **Permissions**: Declare in Android manifest
- **Testing**: Use emulator or physical device
- **Play Store**: Requires Google Play Developer account ($25 one-time)

### Build
```bash
npx tauri android build
```

---

## Phase 5: Windows App (Optional)

### Setup
- Tauri builds for Windows from macOS via cross-compilation, or
- Use CI/CD (GitHub Actions) to build on Windows runner

### Considerations
- **Code signing**: Requires certificate for trusted installation
- **Distribution**: Microsoft Store or direct download

---

## Sync Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   macOS     │     │    iOS      │     │  Android    │
│   App       │     │    App      │     │    App      │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────▼──────┐
                    │  Firebase   │
                    │  Firestore  │
                    └─────────────┘
```

- All platforms use Firebase web SDK
- Real-time listeners keep all devices in sync
- Offline changes queue and sync when online

---

## Cost Estimates

### Firebase (Spark Plan - Free)
- 1 GB storage
- 50K reads / 20K writes per day
- 10K authentications per month
- Sufficient for personal use; upgrade if needed

### Apple Developer Program
- $99/year (required for macOS notarization + iOS App Store)

### Google Play Developer
- $25 one-time

---

## Potential Challenges

| Challenge | Mitigation |
|-----------|------------|
| OAuth in Tauri webview | Use email/password auth or deep linking |
| Push notifications on mobile | Firebase Cloud Messaging + Tauri plugins |
| macOS code signing | Budget time for Apple Developer setup |
| Tauri mobile maturity | Have fallback plan (Capacitor) if blockers |

---

## Next Steps

1. [ ] Create Firebase project
2. [ ] Add Firebase to existing web app
3. [ ] Test sync between two browser windows
4. [ ] Initialize Tauri for macOS
5. [ ] Test macOS build with Firebase
6. [ ] Proceed to iOS when macOS is stable
