import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_FOCUS_START, MSG_DAY_FOCUS_STOP, MSG_DAY_FOCUS_SKIP } from "../client";
import { renderKey, renderStrip } from "../render";

type Settings = { sessionDurationMinutes: number };

@action({ UUID: "app.dayglance.streamdeck.focus" })
export class FocusAction extends SingletonAction<Settings> {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    this.visibleCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((ev.payload as any).controller === "Encoder") {
      this.encoderRefs.add(ev.action);
    }
    if (!this.unsubscribe) {
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] focus render:", e));
      });
    }
    if (this.lastState) await this.renderOne(ev.action, this.lastState);
  }

  override async onWillDisappear(ev: WillDisappearEvent<Settings>): Promise<void> {
    this.encoderRefs.delete(ev.action);
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    if (this.lastState?.focus.active) return;
    const settings = await ev.action.getSettings();
    const newDuration = Math.max(5, (settings.sessionDurationMinutes ?? 25) + ev.payload.ticks);
    await ev.action.setSettings({ sessionDurationMinutes: newDuration });
    const previewOpts = { value: `${newDuration}m`, sub: "focus", barColor: "#3b82f6" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const act of this.actions as unknown as any[]) {
      await act.setImage(renderKey(previewOpts));
      if (this.encoderRefs.has(act)) {
        await act.setFeedback({ canvas: renderStrip(previewOpts) });
      } else {
        await act.setTitle("");
      }
    }
  }

  override async onDialUp(_ev: DialUpEvent<Settings>): Promise<void> {
    this.toggle();
  }

  override async onKeyDown(_ev: KeyDownEvent<Settings>): Promise<void> {
    this.toggle();
  }

  override async onTouchTap(ev: TouchTapEvent<Settings>): Promise<void> {
    if (ev.payload.hold) {
      this.toggle();
      return;
    }
    // Tap: switch work/break phase if a session is active
    if (this.lastState?.focus.active) {
      send({ type: MSG_DAY_FOCUS_SKIP });
    }
  }

  private toggle(): void {
    const { available, active } = this.lastState?.focus ?? { available: false, active: false };
    if (active) {
      send({ type: MSG_DAY_FOCUS_STOP });
    } else if (available) {
      send({ type: MSG_DAY_FOCUS_START });
    }
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const isEncoder = this.encoderRefs.has(act);
    const { available, active, phase, secondsRemaining, running } = state.focus;
    let renderOpts: Parameters<typeof renderKey>[0];

    if (!active) {
      renderOpts = { value: "Focus", sub: available ? "press to start" : "unavailable", dim: !available };
    } else {
      const m = Math.floor(secondsRemaining / 60);
      const s = secondsRemaining % 60;
      const time = `${m}:${s.toString().padStart(2, "0")}`;
      const sub = running ? (phase === "work" ? "work" : "break") : "paused";
      const barColor = phase === "work" ? "#f97316" : "#22c55e";
      renderOpts = { value: time, sub, barColor };
    }

    await act.setImage(renderKey(renderOpts));
    if (isEncoder) {
      await act.setFeedback({ canvas: renderStrip(renderOpts) });
    } else {
      await act.setTitle("");
    }
  }
}
