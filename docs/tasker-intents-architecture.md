# Tasker / Android Intents — Implementation Report

*How the Tasker intents transport is built in dayGLANCE, written as a porting guide for sibling apps (e.g. **lastGLANCE**).*

dayGLANCE is a web app wrapped in a native Android shell (a hand-rolled `WebView` `MainActivity`). lastGLANCE has the same overall shape — a web frontend in a Capacitor Android/iOS wrapper with a Kotlin bridge for widgets — so the architecture ports directly. The two meaningful differences you'll adapt for:

1. **TypeScript instead of JavaScript** — trivial; add types to the handler/context.
2. **Capacitor instead of a raw WebView shell** — you replace dayGLANCE's `addJavascriptInterface` bridge with a small **custom Capacitor plugin**, and hook Capacitor's `BridgeActivity` lifecycle instead of a bespoke `AppCompatActivity`. The *concepts* are identical; only the plumbing differs. See [Porting to lastGLANCE (Capacitor + TypeScript)](#porting-to-lastglance-capacitor--typescript).

This is Android-only. iOS has no equivalent broadcast mechanism; for cross-platform automation dayGLANCE uses file-based transports (WebDAV / an encrypted vault), which are out of scope here.

---

## 1. What it does

Let another Android app (Tasker, MacroDroid, Automate, …) drive the app by sending Android intents:

| Inbound action | Meaning |
|----------------|---------|
| `app.dayglance.CREATE` | Create a task |
| `app.dayglance.COMPLETE` | Complete a task (by id or fuzzy title) |
| `app.dayglance.OPEN` | Foreground the app and navigate to a tab/task |
| `app.dayglance.QUERY` | Return current counts via a reply broadcast |

Each carries a single `payload` **String extra** containing a JSON object.

Two outbound broadcasts go the other way:

| Outbound action | Meaning |
|-----------------|---------|
| `app.dayglance.RESULT` | The outcome of a handled inbound action (also the QUERY reply) |
| `app.dayglance.NOTIFY` | Fired when a task with `source_app`+`source_entity_id` changes state |

The design goal: **process inbound intents live while the app is backgrounded-but-running, and on cold start when it was killed**, without requiring the user to switch to the app.

---

## 2. Architecture at a glance

```
┌─────────┐  broadcast/activity intent   ┌────────────────────────────────────┐
│ Tasker  │ ───────────────────────────► │            Android (Kotlin)         │
└─────────┘  app.dayglance.CREATE …      │                                     │
     ▲                                    │  IntentReceiver (manifest, exported)│
     │  app.dayglance.RESULT / NOTIFY     │     stores payload → SharedDataStore│
     │                                    │     sends internal INTENT_RECEIVED  │
     │                                    │                 │                   │
     │                                    │  MainActivity                       │
     │                                    │   • onCreate / onNewIntent store    │
     │                                    │     Activity-target intents         │
     │                                    │   • intentForwardReceiver (runtime) │
     │                                    │     wakes the WebView                │
     │                                    │   • NativeBridge (@JavascriptInterface)
     │                                    │       getPendingIntent()            │
     │                                    │       reportIntentResult()          │
     │                                    │       sendNotifyBroadcast()         │
     └────────────────────────────────── │                 │ JS bridge         │
                                          └─────────────────┼───────────────────┘
                                                            ▼
                                          ┌────────────────────────────────────┐
                                          │           Web app (JS/TS)           │
                                          │  useAndroidIntentBridge (hook)      │
                                          │    drains pending intent, maps the  │
                                          │    action, calls handleIntent(),    │
                                          │    reports the result back          │
                                          │  handleIntent()  ← pure, testable   │
                                          └────────────────────────────────────┘
```

**Layering principle:** the *transport* (how bytes cross the native↔web boundary) is completely separate from the *handler* (what an action does). `handleIntent()` is a pure function with no Android knowledge; every transport (Android intents, WebDAV, vault) funnels into it. Port the handler once; write a thin bridge per transport.

---

## 3. The web layer

### 3.1 `handleIntent()` — the pure handler

A single async function that takes `(action, payload, context)` and returns a plain result object. It:

- validates + normalizes the payload (schemas live in a shared package, `@glance-apps/intents`),
- performs the state change **only if** the relevant setters are present in `context` (otherwise it runs in "skeleton" mode and just returns the normalized payload — handy for tests and dry runs),
- returns `{ success, task_id, error, warning, ...extra }`.

It is deliberately UI- and platform-agnostic. `context` is how the app injects its state and mutators:

```js
handleIntent(action, payload, {
  tasks, unscheduledTasks, recurringTasks, projects, goals,   // read
  setTasks, setUnscheduledTasks, setRecurringTasks,           // write
  addGoal, updateGoal, deleteGoal,
  navigate,          // (tab) => void   — used by OPEN
  eventId,           // idempotency key for file transports
})
```

**Idempotency matters.** dayGLANCE derives deterministic task IDs from `source_app + source_entity_id (+ due)` so the same logical intent, delivered twice (or to two synced devices), converges on one task instead of duplicating. Build this in from day one — automation *will* double-fire.

### 3.2 `useAndroidIntentBridge` — the Android transport bridge

A hook mounted once near the app root. Responsibilities:

1. On mount, and whenever poked, call the native bridge's `getPendingIntent()`; if something's there, dispatch it.
2. **Map the action string** (see the [big gotcha](#5-the-action-string-gotcha-read-this)).
3. Call `handleIntent()`, then hand the result back to native via `reportIntentResult()`.
4. Expose a global function so native can trigger a drain directly.

The essential shape (current dayGLANCE version):

```js
export function useAndroidIntentBridge(context) {
  const contextRef = useRef(context);
  contextRef.current = context;                 // always see latest state

  useEffect(() => {
    if (!isNativeAndroid()) return;

    const checkPending = async () => {
      const intent = nativeGetPendingIntent();  // reads + clears native slot
      if (!intent) return;
      const { action, payload = {} } = intent;
      const mapped = BROADCAST_ACTION_MAP[action] ?? action;   // ← see §5
      let result;
      try {
        result = await handleIntent(mapped, payload, contextRef.current);
      } catch (err) {
        result = { success: false, error: err?.message ?? String(err) };
      }
      nativeReportIntentResult(action, JSON.stringify(result)); // report ORIGINAL action
    };

    // Native calls this directly (unconditionally — NOT gated on visibilitychange)
    window.__dayglanceCheckPendingIntent = checkPending;

    const onVis = () => { if (document.visibilityState === 'visible') checkPending(); };

    checkPending();                              // catch app-opened-via-intent
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      if (window.__dayglanceCheckPendingIntent === checkPending)
        delete window.__dayglanceCheckPendingIntent;
    };
  }, []);
}
```

### 3.3 `native.js` — bridge accessors

Thin wrappers that feature-detect the injected bridge object and swallow errors, so the rest of the app never touches `window.DayGlanceNative` directly:

```js
export const isNativeAndroid = () => /* UA / bridge-object check */;
const nativeBridge = () => (isNativeAndroid() ? window.DayGlanceNative : null);

export const nativeGetPendingIntent = () => {
  const b = nativeBridge();
  if (!b?.getPendingIntent) return null;
  try { const raw = b.getPendingIntent(); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
};

export const nativeReportIntentResult = (action, resultJson) => {
  try { nativeBridge()?.reportIntentResult?.(action, resultJson); } catch {}
};
```

---

## 4. The native (Kotlin) layer

Four pieces.

### 4.1 `AndroidManifest.xml` — two ways in

Register the actions **both** as a manifest `<receiver>` (works while backgrounded/killed) **and** as `<activity>` intent-filters (so a sender can foreground the app):

```xml
<!-- Broadcast path: fires even when the app is backgrounded or killed -->
<receiver android:name=".intents.IntentReceiver" android:exported="true">
  <intent-filter>
    <action android:name="app.dayglance.CREATE" />
    <action android:name="app.dayglance.COMPLETE" />
    <action android:name="app.dayglance.OPEN" />
    <action android:name="app.dayglance.QUERY" />
  </intent-filter>
</receiver>

<!-- Activity path: on MainActivity, so an Activity-target intent can launch/foreground -->
<activity android:name=".MainActivity" android:launchMode="singleTop" android:exported="true">
  <intent-filter><action android:name="app.dayglance.CREATE" /><category android:name="android.intent.category.DEFAULT" /></intent-filter>
  <!-- …COMPLETE / OPEN / QUERY… -->
</activity>
```

`launchMode="singleTop"` is important: a warm Activity intent routes through `onNewIntent` instead of creating a second instance.

### 4.2 `IntentReceiver` — the broadcast entry point

A `BroadcastReceiver`. Because it's manifest-declared, Android instantiates it **even if the app process is dead**. It:

1. re-serializes the payload through `JSONObject` (defensive — prevents JSON injection from a crafted `payload` extra),
2. writes `{action, payload}` to a persistent slot (`SharedDataStore.pendingIntentJson`),
3. sends an **internal** broadcast (`com.dayglance.app.INTENT_RECEIVED`, package-scoped) to wake a running `MainActivity`.

```kotlin
class IntentReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val action = intent.action ?: return
    val payloadObj = try {
      intent.getStringExtra("payload")?.let { JSONObject(it) } ?: JSONObject()
    } catch (e: Exception) { JSONObject() }
    val pending = JSONObject().put("action", action).put("payload", payloadObj).toString()
    SharedDataStore(context).pendingIntentJson = pending
    context.sendBroadcast(Intent("com.dayglance.app.INTENT_RECEIVED").apply {
      setPackage(context.packageName)
    })
  }
}
```

### 4.3 `MainActivity` — waking the WebView & cold-start handling

- A **runtime-registered** receiver (`intentForwardReceiver`) listens for `INTENT_RECEIVED` and pokes the WebView. **Register it for the whole activity lifetime (`onCreate` → `onDestroy`)**, not `onResume`/`onPause` — otherwise it's deaf exactly when you need it (app backgrounded). Use `ContextCompat.registerReceiver(..., RECEIVER_NOT_EXPORTED)` for correct flags on all API levels.
- **`onCreate` and `onNewIntent` both store** Activity-target `app.dayglance.*` intents. `onNewIntent` handles the warm case (app already running); `onCreate` handles the **cold start** (killed app) — it is *not* called `onNewIntent` for the launching intent, so without the `onCreate` branch an Activity intent to a killed app loses its payload.
- Poke JS by calling the exposed global; fall back to a synthetic `visibilitychange` if it isn't ready yet.

```kotlin
private val intentForwardReceiver = object : BroadcastReceiver() {
  override fun onReceive(c: Context, i: Intent) { forwardPendingIntentToJs() }
}

private fun forwardPendingIntentToJs() {
  webView.post {
    webView.evaluateJavascript(
      "(function(){ if (window.__dayglanceCheckPendingIntent) window.__dayglanceCheckPendingIntent();" +
      " else document.dispatchEvent(new Event('visibilitychange')); })();", null)
  }
}

override fun onCreate(s: Bundle?) {
  /* … */
  when (intent?.action) {
    "app.dayglance.CREATE", "app.dayglance.COMPLETE",
    "app.dayglance.OPEN", "app.dayglance.QUERY" -> storeIntentAction(intent, dataStore)
  }
  ContextCompat.registerReceiver(this, intentForwardReceiver,
    IntentFilter("com.dayglance.app.INTENT_RECEIVED"), ContextCompat.RECEIVER_NOT_EXPORTED)
  intentForwardReceiverRegistered = true
}

override fun onNewIntent(intent: Intent) {
  super.onNewIntent(intent)
  when (intent.action) {
    "app.dayglance.CREATE", "app.dayglance.COMPLETE",
    "app.dayglance.OPEN", "app.dayglance.QUERY" -> { storeIntentAction(intent, dataStore); forwardPendingIntentToJs() }
  }
}

override fun onResume() {           // safety net for cold-start registration gaps
  super.onResume(); forwardPendingIntentToJs()
}

override fun onDestroy() {
  if (intentForwardReceiverRegistered) unregisterReceiver(intentForwardReceiver)
  super.onDestroy()
}
```

> **WebView visibility caveat (dayGLANCE-specific):** dayGLANCE intentionally never calls `webView.onPause()/onResume()` (to keep the GPU surface live), so the document's `visibilityState` never flips to `hidden`. That's why the JS drain must be triggered by an explicit call, not by relying on a real `visibilitychange`. Capacitor manages the WebView lifecycle for you, so verify how your WebView reports visibility and prefer the explicit-call path regardless.

### 4.4 `NativeBridge` — the JS-callable surface

Methods annotated `@JavascriptInterface`, exposed as a named object on `window`:

```kotlin
@JavascriptInterface
fun getPendingIntent(): String {              // read + clear, atomically
  val json = dataStore.pendingIntentJson ?: return ""
  dataStore.pendingIntentJson = null
  return json
}

@JavascriptInterface
fun reportIntentResult(action: String, resultJson: String) {
  context.sendBroadcast(Intent("app.dayglance.RESULT").apply {
    putExtra("action", action); putExtra("result", resultJson)
  })
}

@JavascriptInterface
fun sendNotifyBroadcast(notifyJson: String) {
  context.sendBroadcast(Intent("app.dayglance.NOTIFY").apply { putExtra("payload", notifyJson) })
}
```

Registered via `webView.addJavascriptInterface(nativeBridge, "DayGlanceNative")`.

---

## 5. The action-string gotcha (read this)

The single most confusing bug in this system. The native side stores the **fully-qualified Android action** — `intent.action` = `"app.dayglance.COMPLETE"`. But `handleIntent()` switches on **short** action constants — `ACTIONS.COMPLETE === "complete"` (the file transports build envelopes with `action: "complete"`). If you pass the raw broadcast string straight in, **every** action falls through to `default → "Unknown action"` and silently does nothing.

Map it at the bridge, and report back under the original so the sender's `%action` matches what it sent:

```js
const BROADCAST_ACTION_MAP = {
  'app.dayglance.CREATE':   ACTIONS.CREATE,
  'app.dayglance.COMPLETE': ACTIONS.COMPLETE,
  'app.dayglance.OPEN':     ACTIONS.OPEN,
  'app.dayglance.QUERY':    ACTIONS.QUERY,
};
```

---

## 6. Delivery semantics & pitfalls (all learned the hard way)

| Situation | Behavior | Why |
|-----------|----------|-----|
| App **foreground/backgrounded (alive)** | Broadcast works, silently | `IntentReceiver` stores it; `intentForwardReceiver` (registered for full lifetime) wakes the WebView; JS drains it. |
| App **killed** | Broadcast is **stored but not processed** until the app next runs | No JS is alive to drain it. The file persists in `SharedDataStore`, drained on next launch (`checkPending` on mount). |
| App **killed**, want it done now | Send as an **Activity** intent | Cold-starts the app; `onCreate` stores the action; JS drains on mount. Foregrounds the app (unavoidable — Android forbids background activity launch). |
| Detecting alive vs killed from the sender | No direct API | Use the RESULT broadcast as a **liveness probe** — fire as broadcast, and only fall back to an Activity send if no RESULT ack arrives within a timeout. |

**Two footguns to design around:**

1. **The pending-intent slot is single-depth**, not a queue. Two intents fired in the same instant → the second overwrites the first before JS reads it. Either keep only one action in flight, or (if you need bursts) make the slot a JSON **array** that `getPendingIntent()` pops from and the JS drain loops over. dayGLANCE currently uses a single slot and sidesteps it by making each Activity intent self-sufficient.
2. **Receiver registration lifetime.** Registering the wake receiver in `onResume`/`onPause` (the "obvious" choice) breaks background delivery, because the app is paused exactly when Tasker fires. Register `onCreate` → `onDestroy`.

---

## 7. Outbound: RESULT and NOTIFY

- **RESULT** — sent after every handled action. Extras: `action` (the original broadcast action) and `result` (the handler's result object as a JSON string). This is also the QUERY reply. Note the whole result is one JSON string; the sender parses it. dayGLANCE names QUERY count keys as Tasker-style `%dg_count_today` etc. so they read naturally after parsing.
- **NOTIFY** — emitted from the web layer when a task carrying `source_app`+`source_entity_id` changes (completed/uncompleted/deleted/rescheduled/updated), letting the originating automation react. Fired via `sendNotifyBroadcast()` in parallel with the durable file transports, and only on a plaintext posture (an encrypted payload is useless to a keyless local listener).

---

## 8. Porting to lastGLANCE (Capacitor + TypeScript)

The web-layer and Kotlin-layer *logic* copies over almost verbatim. The wiring changes because Capacitor owns the `Activity` and the JS↔native bridge.

### 8.1 Replace the raw JS interface with a Capacitor plugin

Instead of `addJavascriptInterface`, write a small custom Capacitor plugin. Define the TS interface and the Android implementation:

```ts
// intents-plugin.ts
import { registerPlugin } from '@capacitor/core';

export interface DayGlanceIntents {
  getPendingIntent(): Promise<{ value: string }>;          // '' if none
  reportIntentResult(o: { action: string; result: string }): Promise<void>;
  sendNotifyBroadcast(o: { payload: string }): Promise<void>;
  addListener(e: 'pendingIntent', cb: () => void): Promise<PluginListenerHandle>;
}
export const Intents = registerPlugin<DayGlanceIntents>('DayGlanceIntents');
```

```kotlin
// DayGlanceIntentsPlugin.kt
@CapacitorPlugin(name = "DayGlanceIntents")
class DayGlanceIntentsPlugin : Plugin() {
  @PluginMethod fun getPendingIntent(call: PluginCall) {
    val json = store.pendingIntentJson; store.pendingIntentJson = null
    call.resolve(JSObject().put("value", json ?: ""))
  }
  @PluginMethod fun reportIntentResult(call: PluginCall) {
    context.sendBroadcast(Intent("app.lastglance.RESULT")
      .putExtra("action", call.getString("action"))
      .putExtra("result", call.getString("result")))
    call.resolve()
  }
  // notifyListeners("pendingIntent", null) replaces evaluateJavascript(window.__…)
}
```

Key mapping from dayGLANCE → Capacitor:

| dayGLANCE (raw WebView) | Capacitor equivalent |
|---|---|
| `addJavascriptInterface(bridge, "DayGlanceNative")` | `registerPlugin` + `@CapacitorPlugin` |
| `webView.evaluateJavascript("window.__…()")` to poke JS | `notifyListeners("pendingIntent", …)` → JS `Intents.addListener('pendingIntent', drain)` |
| `window.DayGlanceNative.getPendingIntent()` (sync) | `await Intents.getPendingIntent()` (**async** — the drain becomes fully promise-based, which it already is) |

### 8.2 Hook the Capacitor `BridgeActivity`

lastGLANCE's `MainActivity` extends `BridgeActivity`. Override `onCreate`/`onNewIntent` to store Activity-target intents (call `super` first so Capacitor initializes), and register the `INTENT_RECEIVED` wake receiver `onCreate`→`onDestroy` just like dayGLANCE. The `IntentReceiver` (manifest broadcast receiver) is unchanged except for the action namespace.

To poke the web layer, prefer `plugin.notifyListeners(...)` over reaching into the WebView directly — it's the Capacitor-native path and avoids fighting Capacitor's WebView lifecycle. (You can still get the `WebView` via `bridge.webView` if you ever need `evaluateJavascript`.)

### 8.3 TypeScript for the handler & bridge

- Type the result and context:

```ts
export interface IntentResult { success: boolean; task_id: string; error: string; warning: string; [k: string]: unknown; }
export interface IntentContext {
  tasks: Task[]; setTasks?: React.Dispatch<React.SetStateAction<Task[]>>;
  /* …other lists + setters… */
  navigate?: (tab: string) => void;
  eventId?: string;
}
export async function handleIntent(action: string, payload: unknown, ctx: IntentContext): Promise<IntentResult> { … }
```

- Type the action map as `Record<string, Action>` so a missing case is a compile error.
- If you share the schema/constants package (`@glance-apps/intents`), you get `ACTIONS`, the Zod schemas, and `TABS` typed for free — reuse it rather than re-declaring.

### 8.4 Namespacing

Use `app.lastglance.CREATE` / `.RESULT` / `.NOTIFY` and an internal `com.lastglance.app.INTENT_RECEIVED`. If dayGLANCE and lastGLANCE are ever installed together, distinct namespaces prevent cross-talk. Keep the *short* action constants (`create`, `complete`, …) identical across apps so the shared handler and file transports stay compatible.

---

## 9. Porting checklist

- [ ] Shared handler `handleIntent(action, payload, ctx)` — pure, typed, idempotent (deterministic IDs from `source_app`+`source_entity_id`).
- [ ] Action map: fully-qualified broadcast action → short constant; report RESULT under the **original** action.
- [ ] Manifest: actions on **both** a `<receiver>` and the `<activity>` (`singleTop`).
- [ ] `IntentReceiver`: re-serialize payload via `JSONObject`; store to a persistent slot; send package-scoped `INTENT_RECEIVED`.
- [ ] Capacitor plugin: `getPendingIntent` (read+clear), `reportIntentResult`, `sendNotifyBroadcast`, `notifyListeners('pendingIntent')`.
- [ ] `BridgeActivity`: store Activity intents in **both** `onCreate` (cold start) and `onNewIntent` (warm); register wake receiver `onCreate`→`onDestroy`; drain on `onResume`.
- [ ] Web bridge: drain on plugin event + on mount; unconditional (don't gate on `visibilityState`).
- [ ] Outbound RESULT (every action) and NOTIFY (state changes; plaintext only).
- [ ] Decide single-slot vs queue for the pending store (single is fine if each Activity intent is self-sufficient).
- [ ] Document the Tasker-side gotchas: OPEN needs **Target: Activity**; RESULT/QUERY needs a receiver profile to display anything; `%`-prefixed keys need parsing; collision handling on the receiver task.

---

## 10. Reference — dayGLANCE source

| Concern | File |
|---------|------|
| Pure handler | `src/intents/handleIntent.js` |
| Android transport bridge (hook) | `src/intents/useAndroidIntentBridge.js` |
| Bridge accessors | `src/native.js` |
| Outbound NOTIFY emitter | `src/intents/useNotifyEmitter.js` |
| Broadcast entry point | `dayglance-android/app/src/main/java/com/dayglance/app/intents/IntentReceiver.kt` |
| Activity lifecycle / wake / cold start | `dayglance-android/app/src/main/java/com/dayglance/app/MainActivity.kt` |
| JS-callable native methods | `dayglance-android/app/src/main/java/com/dayglance/app/bridge/NativeBridge.kt` |
| Manifest filters | `dayglance-android/app/src/main/AndroidManifest.xml` |
| End-user Tasker guide | `docs/tasker-integration.md` |
