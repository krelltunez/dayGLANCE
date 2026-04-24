import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send } from "../client";

type Settings = { sessionDurationMinutes: number };

@action({ UUID: "app.dayglance.streamdeck.focus" })
export class FocusAction extends SingletonAction<Settings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionRef: any = null;
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    this.actionRef = ev.action;
    this.unsubscribe?.();
    this.unsubscribe = onState((s) => {
      this.lastState = s;
      void this.render(s);
    });
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    if (this.lastState?.focus.active) return;
    const settings = await ev.action.getSettings();
    const newDuration = Math.max(5, (settings.sessionDurationMinutes ?? 25) + ev.payload.ticks);
    await ev.action.setSettings({ sessionDurationMinutes: newDuration });
    await ev.action.setTitle(`${newDuration}m`);
  }

  override async onDialUp(_ev: DialUpEvent<Settings>): Promise<void> {
    this.toggle();
  }

  override async onKeyDown(_ev: KeyDownEvent<Settings>): Promise<void> {
    this.toggle();
  }

  private toggle(): void {
    if (!this.lastState?.focus.active) {
      send({ type: "focus:start" });
    } else {
      send({ type: "focus:stop" });
    }
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const { active, phase, secondsRemaining, running } = state.focus;
    if (!active) {
      await this.actionRef.setTitle("Focus");
      await this.actionRef.setState(0);
    } else {
      const m = Math.floor(secondsRemaining / 60);
      const s = secondsRemaining % 60;
      const label = phase === "work" ? "Work" : "Break";
      const timer = running ? `${m}:${s.toString().padStart(2, "0")}` : "Paused";
      await this.actionRef.setTitle(`${label}\n${timer}`);
      await this.actionRef.setState(1);
    }
  }
}
