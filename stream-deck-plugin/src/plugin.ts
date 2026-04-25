import streamDeck from "@elgato/streamdeck";

import { AgendaAction } from "./actions/agenda";
import { FocusAction } from "./actions/focus-mode";
import { GoalProgressAction } from "./actions/goal-progress";
import { HabitAction } from "./actions/habit";
import { NextTaskAction } from "./actions/next-task";
import { QuickGlanceAction } from "./actions/quick-glance";
import { RoutineAction } from "./actions/routine";

streamDeck.actions.registerAction(new AgendaAction());
streamDeck.actions.registerAction(new FocusAction());
streamDeck.actions.registerAction(new GoalProgressAction());
streamDeck.actions.registerAction(new HabitAction());
streamDeck.actions.registerAction(new NextTaskAction());
streamDeck.actions.registerAction(new QuickGlanceAction());
streamDeck.actions.registerAction(new RoutineAction());

streamDeck.connect();
