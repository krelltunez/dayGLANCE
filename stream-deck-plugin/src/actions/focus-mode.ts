import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_FOCUS_START, MSG_DAY_FOCUS_STOP } from "../client";
import { renderKey } from "../render";

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
    if (this.lastState) await this.render(this.lastState);
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    if (this.lastState?.focus.active) return;
    const settings = await ev.action.getSettings();
    const newDuration = Math.max(5, (settings.sessionDurationMinutes ?? 25) + ev.payload.ticks);
    await ev.action.setSettings({ sessionDurationMinutes: newDuration });
    await this.actionRef.setImage(renderKey({ value: `${newDuration}m`, sub: "focus", barColor: "#3b82f6" }));
    await this.actionRef.setTitle("");
  }

  override async onDialUp(_ev: DialUpEvent<Settings>): Promise<void> {
    this.toggle();
  }

  override async onKeyDown(_ev: KeyDownEvent<Settings>): Promise<void> {
    this.toggle();
  }

  private toggle(): void {
    const { available, active } = this.lastState?.focus ?? { available: false, active: false };
    if (!available && !active) return;
    if (!active) {
      send({ type: MSG_DAY_FOCUS_START });
    } else {
      send({ type: MSG_DAY_FOCUS_STOP });
    }
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const { available, active, phase, secondsRemaining, running } = state.focus;
    if (!active) {
      await this.actionRef.setImage(renderKey({ value: "Focus", sub: available ? "press to start" : "unavailable", dim: !available }));
    } else {
      const m = Math.floor(secondsRemaining / 60);
      const s = secondsRemaining % 60;
      const time = `${m}:${s.toString().padStart(2, "0")}`;
      const sub = running ? (phase === "work" ? "work" : "break") : "paused";
      const barColor = phase === "work" ? "#f97316" : "#22c55e";
      await this.actionRef.setImage(renderKey({ value: time, sub, barColor }));
    }
    await this.actionRef.setTitle("");
  }
}
