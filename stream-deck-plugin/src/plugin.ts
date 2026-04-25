import streamDeck from "@elgato/streamdeck";

import { AgendaAction } from "./actions/agenda";
import { FocusAction } from "./actions/focus-mode";
import { GoalProgressAction } from "./actions/goal-progress";
import { NextTaskAction } from "./actions/next-task";
import { QuickGlanceAction } from "./actions/quick-glance";

streamDeck.actions.registerAction(new AgendaAction());
streamDeck.actions.registerAction(new FocusAction());
streamDeck.actions.registerAction(new GoalProgressAction());
streamDeck.actions.registerAction(new NextTaskAction());
streamDeck.actions.registerAction(new QuickGlanceAction());

streamDeck.connect();
