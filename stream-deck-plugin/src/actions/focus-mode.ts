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
import {
  DayGlanceState, onState, send,
  MSG_DAY_FOCUS_START, MSG_DAY_FOCUS_TIMER_START, MSG_DAY_FOCUS_STOP, MSG_DAY_FOCUS_SKIP,
  MSG_DAY_FOCUS_SET_DURATION, MSG_DAY_FOCUS_DISMISS_STATS, MSG_DAY_TASK_COMPLETE,
} from "../client";
import { renderKey, renderStrip, renderFocusSlot, renderFocusSlotKey, renderFocusSetupSlot } from "../render";

// Three operating modes for the Focus encoder:
//   idle   — panel closed (active=false)
//   setup  — panel open, settings screen showing (active=true, setup=true)
//   session — timer running or paused (active=true, setup=false)

@action({ UUID: "app.dayglance.streamdeck.focus" })
export class FocusAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private slotIndexMap = new Map<any, number>();
  private adjusting: "work" | "break" | "longBreak" = "work";
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

    const focus = this.lastState?.focus;
    if (!focus) return;

    if (focus.showStats) {
      send({ type: MSG_DAY_FOCUS_DISMISS_STATS });
    } else if (!focus.active) {
      // Idle: open the session start screen in the app
      send({ type: MSG_DAY_FOCUS_START });
    } else if (focus.setup) {
      if (held) {
        // Long press on setup screen: cycle through work → break → long break
        this.adjusting = this.adjusting === "work" ? "break" : this.adjusting === "break" ? "longBreak" : "work";
        if (this.lastState) await this.renderAll(this.lastState);
      } else {
        // Short press on setup screen: start the timer
        send({ type: MSG_DAY_FOCUS_TIMER_START });
      }
    } else {
      // Session in progress
      if (held) {
        // Long press: complete the next focus task
        const nextTask = this.lastState?.focus.nextFocusTask;
        if (nextTask) send({ type: MSG_DAY_TASK_COMPLETE, id: nextTask.id });
      } else {
        // Short press: advance to next phase
        send({ type: MSG_DAY_FOCUS_SKIP });
      }
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (!this.lastState) return;
    const { active, setup, workMinutes, breakMinutes, longBreakMinutes } = this.lastState.focus;
    // Dial only adjusts durations while the setup screen is showing
    if (!active || !setup) return;

    if (this.adjusting === "work") {
      send({ type: MSG_DAY_FOCUS_SET_DURATION, workMinutes: Math.max(1, Math.min(120, workMinutes + ev.payload.ticks)) });
    } else if (this.adjusting === "break") {
      send({ type: MSG_DAY_FOCUS_SET_DURATION, breakMinutes: Math.max(1, Math.min(60, breakMinutes + ev.payload.ticks)) });
    } else {
      send({ type: MSG_DAY_FOCUS_SET_DURATION, longBreakMinutes: Math.max(1, Math.min(60, longBreakMinutes + ev.payload.ticks)) });
    }
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const focus = this.lastState?.focus;
    if (!focus) return;
    if (focus.showStats) {
      send({ type: MSG_DAY_FOCUS_DISMISS_STATS });
    } else if (!focus.active) {
      send({ type: MSG_DAY_FOCUS_START });
    } else if (focus.setup) {
      send({ type: MSG_DAY_FOCUS_TIMER_START });
    } else {
      send({ type: MSG_DAY_FOCUS_SKIP });
    }
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      if (this.lastState?.focus.active) send({ type: MSG_DAY_FOCUS_STOP });
      return;
    }
    const focus = this.lastState?.focus;
    if (!focus) return;
    if (focus.showStats) {
      send({ type: MSG_DAY_FOCUS_DISMISS_STATS });
    } else if (!focus.active) {
      send({ type: MSG_DAY_FOCUS_START });
    } else if (focus.setup) {
      send({ type: MSG_DAY_FOCUS_TIMER_START });
    } else {
      send({ type: MSG_DAY_FOCUS_SKIP });
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
    const { available, active, setup, phase, secondsRemaining, running, workMinutes, breakMinutes, longBreakMinutes, cycleCount } = state.focus;
    const cycles = cycleCount ?? 0;

    if (isEncoder) {
      const slotIndex = this.slotIndexMap.get(act) ?? 0;

      if (!active) {
        // Idle: slot 0 = standard Focus display; slots 1-3 = pending rings
        const idleKeyOpts = slotIndex === 0
          ? { value: "Focus", sub: available ? "press to start" : "unavailable", dim: !available, barColor: "#f97316" }
          : { value: `${slotIndex + 1}`, sub: `cycle ${slotIndex + 1}`, dim: true, barColor: "#f97316" };
        await act.setImage(renderKey(idleKeyOpts));
        // Strip mirrors the key: slot 0 = Focus label, slots 1-3 = pending rings
        const idleStrip = slotIndex === 0
          ? renderStrip(idleKeyOpts)
          : renderFocusSlot(slotIndex, "work", 0, 0);
        await act.setFeedback({ canvas: idleStrip });
      } else if (setup) {
        // Setup screen open: slots 0-2 show durations; slot 3 = pending ring
        const barColor = this.adjusting === "longBreak" ? "#16a34a" : this.adjusting === "break" ? "#22c55e" : "#f97316";
        const value = this.adjusting === "work" ? `${workMinutes}m` : this.adjusting === "break" ? `${breakMinutes}m` : `${longBreakMinutes}m`;
        const sub = this.adjusting === "work" ? "work" : this.adjusting === "break" ? "break" : "long break";
        await act.setImage(renderKey({ value, sub, barColor }));
        await act.setFeedback({ canvas: renderFocusSetupSlot(slotIndex, workMinutes, breakMinutes, longBreakMinutes, this.adjusting) });
      } else {
        // Session active: per-slot Pomodoro view
        await act.setImage(renderFocusSlotKey(slotIndex, phase, secondsRemaining, cycles));
        await act.setFeedback({ canvas: renderFocusSlot(slotIndex, phase, secondsRemaining, cycles) });
      }
      return;
    }

    // Non-encoder key button
    if (!active) {
      await act.setImage(renderKey({ value: "Focus", sub: available ? "press to start" : "unavailable", dim: !available, barColor: "#f97316" }));
    } else if (setup) {
      const barColor = this.adjusting === "longBreak" ? "#16a34a" : this.adjusting === "break" ? "#22c55e" : "#f97316";
      const value = this.adjusting === "work" ? `${workMinutes}m` : this.adjusting === "break" ? `${breakMinutes}m` : `${longBreakMinutes}m`;
      await act.setImage(renderKey({ value, sub: "press to start", barColor }));
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
