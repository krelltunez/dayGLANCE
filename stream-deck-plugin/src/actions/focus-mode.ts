import {
  action,
  DialDownEvent,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_FOCUS_START, MSG_DAY_FOCUS_STOP, MSG_DAY_FOCUS_SKIP, MSG_DAY_FOCUS_SET_DURATION } from "../client";
import { renderKey, renderFocusSlot, renderFocusSlotKey, renderFocusSetupSlot } from "../render";

@action({ UUID: "app.dayglance.streamdeck.focus" })
export class FocusAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private slotIndexMap = new Map<any, number>();
  private adjusting: "work" | "break" = "work";
  private dialPressedAt: number | null = null;
  private readonly LONG_PRESS_MS = 400;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((ev.payload as any).controller === "Encoder") {
      this.encoderRefs.add(ev.action);
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

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    this.dialPressedAt = Date.now();
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    const held = this.dialPressedAt !== null && (Date.now() - this.dialPressedAt) >= this.LONG_PRESS_MS;
    this.dialPressedAt = null;

    const { active, available } = this.lastState?.focus ?? { active: false, available: false };
    if (active) {
      // Any knob press during a session: advance to next phase
      send({ type: MSG_DAY_FOCUS_SKIP });
    } else if (held) {
      // Long press when idle: toggle which duration the dial adjusts
      this.adjusting = this.adjusting === "work" ? "break" : "work";
      if (this.lastState) await this.renderAll(this.lastState);
    } else if (available) {
      // Short press when idle: start session
      send({ type: MSG_DAY_FOCUS_START });
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (!this.lastState) return;
    const { active, workMinutes, breakMinutes } = this.lastState.focus;
    if (active) return; // dial does nothing during a session

    if (this.adjusting === "work") {
      const newWork = Math.max(1, Math.min(120, workMinutes + ev.payload.ticks));
      send({ type: MSG_DAY_FOCUS_SET_DURATION, workMinutes: newWork });
    } else {
      const newBreak = Math.max(1, Math.min(60, breakMinutes + ev.payload.ticks));
      send({ type: MSG_DAY_FOCUS_SET_DURATION, breakMinutes: newBreak });
    }
    // State subscription will re-render once the app echoes the update back
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const { active, available } = this.lastState?.focus ?? { active: false, available: false };
    if (active) {
      send({ type: MSG_DAY_FOCUS_SKIP });
    } else if (available) {
      send({ type: MSG_DAY_FOCUS_START });
    }
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      if (this.lastState?.focus.active) send({ type: MSG_DAY_FOCUS_STOP });
      return;
    }
    const { active, available } = this.lastState?.focus ?? { active: false, available: false };
    if (active) {
      send({ type: MSG_DAY_FOCUS_SKIP });
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
    const { available, active, phase, secondsRemaining, running, workMinutes, breakMinutes, cycleCount } = state.focus;
    const cycles = cycleCount ?? 0;

    if (isEncoder) {
      const slotIndex = this.slotIndexMap.get(act) ?? 0;
      if (active) {
        await act.setImage(renderFocusSlotKey(slotIndex, phase, secondsRemaining, cycles));
        await act.setFeedback({ canvas: renderFocusSlot(slotIndex, phase, secondsRemaining, cycles) });
      } else {
        // Setup screen: slots 0+1 show work/break durations; slots 2-3 show pending rings
        const barColor = this.adjusting === "work" ? "#f97316" : "#22c55e";
        const value = this.adjusting === "work" ? `${workMinutes}m` : `${breakMinutes}m`;
        const sub = this.adjusting === "work" ? "work" : "break";
        await act.setImage(renderKey({ value, sub, dim: !available, barColor }));
        await act.setFeedback({ canvas: renderFocusSetupSlot(slotIndex, workMinutes, breakMinutes, this.adjusting) });
      }
      return;
    }

    // Non-encoder key button
    if (!active) {
      const barColor = this.adjusting === "work" ? "#f97316" : "#22c55e";
      const value = this.adjusting === "work" ? `${workMinutes}m` : `${breakMinutes}m`;
      await act.setImage(renderKey({ value, sub: available ? "press to start" : "unavailable", dim: !available, barColor }));
    } else {
      const m = Math.floor(secondsRemaining / 60);
      const s = secondsRemaining % 60;
      const time = `${m}:${s.toString().padStart(2, "0")}`;
      const sub = running ? (phase === "work" ? "work" : "break") : "paused";
      const barColor = phase === "work" ? "#f97316" : "#22c55e";
      await act.setImage(renderKey({ value: time, sub, barColor }));
    }
    await act.setTitle("");
  }
}
