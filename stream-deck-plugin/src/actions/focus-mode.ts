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
import { DayGlanceState, onState, send, MSG_DAY_FOCUS_START, MSG_DAY_FOCUS_STOP, MSG_DAY_FOCUS_SKIP, MSG_DAY_FOCUS_SET_DURATION } from "../client";
import { renderKey, renderStrip, renderFocusSlot, renderFocusSlotKey } from "../render";

@action({ UUID: "app.dayglance.streamdeck.focus" })
export class FocusAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private slotIndexMap = new Map<any, number>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((ev.payload as any).controller === "Encoder") {
      this.encoderRefs.add(ev.action);
      // Column position (0–3) determines which Pomodoro cycle this slot represents
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const col: number = (ev.payload as any).coordinates?.column ?? 0;
      this.slotIndexMap.set(ev.action, col % 4);
    }
    if (!this.unsubscribe) {
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] focus render:", e));
      });
    }
    if (this.lastState) await this.renderOne(ev.action, this.lastState);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    this.encoderRefs.delete(ev.action);
    this.slotIndexMap.delete(ev.action);
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (!this.lastState) return;
    const { active, phase, workMinutes, breakMinutes } = this.lastState.focus;

    if (!active) {
      // Before session: adjust work duration
      const newWork = Math.max(1, Math.min(120, workMinutes + ev.payload.ticks));
      send({ type: MSG_DAY_FOCUS_SET_DURATION, workMinutes: newWork });
      await this.renderPreview(`${newWork}m`, "work session", "#f97316");
    } else if (phase === "work") {
      // During work: adjust upcoming break duration
      const newBreak = Math.max(1, Math.min(60, breakMinutes + ev.payload.ticks));
      send({ type: MSG_DAY_FOCUS_SET_DURATION, breakMinutes: newBreak });
      await this.renderPreview(`${newBreak}m`, "next break", "#22c55e");
    } else {
      // During break: adjust work duration for next session
      const newWork = Math.max(1, Math.min(120, workMinutes + ev.payload.ticks));
      send({ type: MSG_DAY_FOCUS_SET_DURATION, workMinutes: newWork });
      await this.renderPreview(`${newWork}m`, "next session", "#f97316");
    }
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    this.toggle();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    this.toggle();
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      this.toggle();
      return;
    }
    // Tap: skip phase if active, start if not
    if (this.lastState?.focus.active) {
      send({ type: MSG_DAY_FOCUS_SKIP });
    } else {
      this.toggle();
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

  private async renderPreview(value: string, sub: string, barColor: string): Promise<void> {
    const opts = { value, sub, barColor };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const act of this.actions as unknown as any[]) {
      await act.setImage(renderKey(opts));
      if (this.encoderRefs.has(act)) {
        await act.setFeedback({ canvas: renderStrip(opts) });
      } else {
        await act.setTitle("");
      }
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
    const { available, active, phase, secondsRemaining, running, workMinutes, cycleCount } = state.focus;
    const cycles = cycleCount ?? 0;

    if (isEncoder) {
      const slotIndex = this.slotIndexMap.get(act) ?? 0;
      if (active) {
        await act.setImage(renderFocusSlotKey(slotIndex, phase, secondsRemaining, cycles));
        await act.setFeedback({ canvas: renderFocusSlot(slotIndex, phase, secondsRemaining, cycles) });
      } else {
        // Idle: slot 0 shows work duration hint; other slots show their pending number
        const idleOpts = slotIndex === 0
          ? { value: `${workMinutes}m`, sub: available ? "press to start" : "unavailable", dim: !available, barColor: "#f97316" }
          : { value: `${slotIndex + 1}`, sub: `cycle ${slotIndex + 1}`, dim: true, barColor: "#f97316" };
        await act.setImage(renderKey(idleOpts));
        await act.setFeedback({ canvas: renderStrip(idleOpts) });
      }
      return;
    }

    // Non-encoder key button — standard start/stop view
    let renderOpts: Parameters<typeof renderKey>[0];
    if (!active) {
      renderOpts = {
        value: `${workMinutes}m`,
        sub: available ? "press to start" : "unavailable",
        dim: !available,
        barColor: "#f97316",
      };
    } else {
      const m = Math.floor(secondsRemaining / 60);
      const s = secondsRemaining % 60;
      const time = `${m}:${s.toString().padStart(2, "0")}`;
      const sub = running ? (phase === "work" ? "work" : "break") : "paused";
      const barColor = phase === "work" ? "#f97316" : "#22c55e";
      renderOpts = { value: time, sub, barColor };
    }
    await act.setImage(renderKey(renderOpts));
    await act.setTitle("");
  }
}
