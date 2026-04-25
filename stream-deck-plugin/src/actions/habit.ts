import {
  action,
  DidReceiveSettingsEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_HABIT_INCREMENT } from "../client";
import { renderKey, truncate } from "../render";

type Settings = { habitId: string | null };

@action({ UUID: "app.dayglance.streamdeck.habit" })
export class HabitAction extends SingletonAction<Settings> {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    this.visibleCount++;

    if (!this.unsubscribe) {
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] habit render:", e));
      });
    }

    // Render this specific key on appear (onState may have fired before ev.action joined this.actions)
    const settings = await ev.action.getSettings();
    if (this.lastState) {
      await this.renderOne(ev.action, settings.habitId ?? null, this.lastState)
        .catch(e => console.error("[dayGLANCE] habit render:", e));
    }
  }

  override async onWillDisappear(_ev: WillDisappearEvent<Settings>): Promise<void> {
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
    if (this.lastState) {
      await this.renderOne(ev.action, ev.payload.settings.habitId ?? null, this.lastState)
        .catch(e => console.error("[dayGLANCE] habit render:", e));
    }
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    const settings = await ev.action.getSettings();
    if (settings.habitId) send({ type: MSG_DAY_HABIT_INCREMENT, id: settings.habitId });
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      const settings = await act.getSettings<Settings>();
      await this.renderOne(act, settings.habitId ?? null, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(action: any, habitId: string | null, state: DayGlanceState): Promise<void> {
    if (!habitId) {
      await action.setImage(renderKey({ value: "Habit", sub: "select in settings", dim: true }));
      await action.setTitle("");
      return;
    }
    const habit = state.habits.find((h) => h.id === habitId);
    if (!habit) {
      await action.setImage(renderKey({ value: "—", sub: "habit not found", dim: true }));
      await action.setTitle("");
      return;
    }
    const valueStr = `${habit.count}/${habit.target}`;
    const sub = truncate(habit.name, 14);
    const barColor = habit.complete ? "#22c55e" : habit.ringColorHex;
    await action.setImage(renderKey({ value: valueStr, sub, barColor }));
    await action.setTitle("");
  }
}
