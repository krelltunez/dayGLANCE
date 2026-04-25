import streamDeck from "@elgato/streamdeck";

import { AgendaAction } from "./actions/agenda";
import { FocusAction } from "./actions/focus-mode";
import { GoalProgressAction } from "./actions/goal-progress";
import { ProjectProgressAction } from "./actions/project-progress";
import { HabitAction } from "./actions/habit";
import { UpNextAction } from "./actions/up-next";
import { QuickGlanceAction } from "./actions/quick-glance";
import { RoutineAction } from "./actions/routine";

streamDeck.actions.registerAction(new AgendaAction());
streamDeck.actions.registerAction(new FocusAction());
streamDeck.actions.registerAction(new GoalProgressAction());
streamDeck.actions.registerAction(new ProjectProgressAction());
streamDeck.actions.registerAction(new HabitAction());
streamDeck.actions.registerAction(new UpNextAction());
streamDeck.actions.registerAction(new QuickGlanceAction());
streamDeck.actions.registerAction(new RoutineAction());

streamDeck.connect();
