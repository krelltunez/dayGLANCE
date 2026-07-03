import streamDeck from "@elgato/streamdeck";

import { getSessionToken, onToken } from "./client";
import { AgendaAction } from "./actions/agenda";
import { FocusAction } from "./actions/focus-mode";
import { GoalProgressAction } from "./actions/goal-progress";
import { ProjectProgressAction } from "./actions/project-progress";
import { HabitAction } from "./actions/habit";
import { TomorrowAction } from "./actions/tomorrow";
import { UpNextAction } from "./actions/up-next";
import { QuickGlanceAction } from "./actions/quick-glance";
import { RoutineAction } from "./actions/routine";
import { HyperGlanceAction } from "./actions/hyperglance";

// SDK v2 dispatches action events via unawaited async callbacks — any throw becomes
// an unhandled rejection. Without this handler Node 15+ terminates the process.
process.on("unhandledRejection", (reason) => {
  console.error("[dayGLANCE] unhandledRejection:", reason);
});

streamDeck.actions.registerAction(new AgendaAction());
streamDeck.actions.registerAction(new TomorrowAction());
streamDeck.actions.registerAction(new FocusAction());
streamDeck.actions.registerAction(new GoalProgressAction());
streamDeck.actions.registerAction(new ProjectProgressAction());
streamDeck.actions.registerAction(new HabitAction());
streamDeck.actions.registerAction(new UpNextAction());
streamDeck.actions.registerAction(new QuickGlanceAction());
streamDeck.actions.registerAction(new RoutineAction());
streamDeck.actions.registerAction(new HyperGlanceAction());

// ── Property-inspector token relay ─────────────────────────────────────────
// The property inspector connects to dayGLANCE Desktop's WebSocket directly and
// must authenticate with a session token (see electron/ws-server.ts). Only this
// Origin-less backend knows the token, so we relay it to the PI over Stream Deck's
// PI channel. sendToPropertyInspector is a no-op unless a PI is currently visible,
// so pushing on token arrival / PI request is safe.
function sendTokenToPI(token: string): void {
  streamDeck.ui.sendToPropertyInspector({ event: "dg-token", token }).catch(() => {
    // No PI visible, or it closed mid-send — harmless.
  });
}

// Push proactively whenever a (new) token is issued — covers the case where the
// PI is already open when Desktop starts or restarts.
onToken(sendTokenToPI);

// Respond to an explicit request from the PI (sent when it opens, before Desktop
// may have connected).
streamDeck.ui.onSendToPlugin((ev) => {
  const payload = ev.payload as { event?: string } | null;
  if (payload?.event === "dg-request-token") {
    const token = getSessionToken();
    if (token) sendTokenToPI(token);
  }
});

// Push once when a PI appears, in case the token is already known.
streamDeck.ui.onDidAppear(() => {
  const token = getSessionToken();
  if (token) sendTokenToPI(token);
});

streamDeck.connect().catch((err) => console.error("[dayGLANCE] streamDeck.connect failed:", err));
