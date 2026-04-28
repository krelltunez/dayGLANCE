import streamDeck from "@elgato/streamdeck";

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

streamDeck.connect().catch((err) => console.error("[dayGLANCE] streamDeck.connect failed:", err));
