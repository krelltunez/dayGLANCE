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
  MSG_DAY_HG_START, MSG_DAY_HG_TIMER_START, MSG_DAY_HG_STOP,
  MSG_DAY_HG_SKIP, MSG_DAY_HG_SET_DURATION, MSG_DAY_HG_COMPLETE,
  MSG_DAY_HG_TASK_COMPLETE,
} from "../client";
import {
  renderKey, renderHGIdleKey, renderHGIdleSlot,
  renderFocusSlot, renderFocusSlotKey, renderFocusSetupSlot,
  truncate,
} from "../render";

// Four operating modes:
//   idle     — no active HG session; up to 4 scheduled sessions shown in slots
//   setup    — session entered, settings screen showing (hg.active.setup=true)
//   session  — timer running/paused (hg.active, !setup, !completed)
//   complete — post-session stats screen (hg.active.completed=true)

@action({ UUID: "com.dayglance.streamdeck.hyperglance" })
export class HyperGlanceAction extends SingletonAction {
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
  private pulseOn = false;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;

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
        this.updatePulse(s);
        this.renderAll(s).catch(e => console.error("[dayGLANCE] hg render:", e));
      });
    }
    if (this.lastState) await this.renderOne(ev.action, this.lastState);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    this.encoderRefs.delete(ev.action);
    this.slotIndexMap.delete(ev.action);
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.stopPulse();
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  override async onDialDown(_ev: DialDownEvent): Promise<void> {
    this.dialPressedAt = Date.now();
  }

  override async onDialUp(ev: DialUpEvent): Promise<void> {
    const held = this.dialPressedAt !== null && (Date.now() - this.dialPressedAt) >= this.LONG_PRESS_MS;
    this.dialPressedAt = null;

    const hg = this.lastState?.hg;
    if (!hg) return;

    if (hg.active?.completed) {
      send({ type: MSG_DAY_HG_COMPLETE });
    } else if (hg.active && !hg.active.setup) {
      // Session in progress
      if (held) {
        const nextTask = hg.active.nextTask;
        if (nextTask) send({ type: MSG_DAY_HG_TASK_COMPLETE, id: nextTask.id });
      } else {
        send({ type: MSG_DAY_HG_SKIP });
      }
    } else if (hg.active && hg.active.setup) {
      if (held) {
        this.adjusting = this.adjusting === "work" ? "break" : this.adjusting === "break" ? "longBreak" : "work";
        if (this.lastState) await this.renderAll(this.lastState);
      } else {
        send({ type: MSG_DAY_HG_TIMER_START });
      }
    } else {
      // Idle — start the session for this slot's project
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slotIndex = this.slotIndexMap.get((ev as any).action) ?? 0;
      const session = hg.scheduled[slotIndex];
      if (session) send({ type: MSG_DAY_HG_START, projectId: session.projectId, date: session.date });
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    const hg = this.lastState?.hg;
    if (!hg?.active?.setup) return;
    const { workMinutes, breakMinutes, longBreakMinutes } = hg.active;
    if (this.adjusting === "work") {
      send({ type: MSG_DAY_HG_SET_DURATION, workMinutes: Math.max(1, Math.min(120, workMinutes + ev.payload.ticks)) });
    } else if (this.adjusting === "break") {
      send({ type: MSG_DAY_HG_SET_DURATION, breakMinutes: Math.max(1, Math.min(60, breakMinutes + ev.payload.ticks)) });
    } else {
      send({ type: MSG_DAY_HG_SET_DURATION, longBreakMinutes: Math.max(1, Math.min(60, longBreakMinutes + ev.payload.ticks)) });
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const hg = this.lastState?.hg;
    if (!hg) return;
    if (hg.active?.completed) {
      send({ type: MSG_DAY_HG_COMPLETE });
    } else if (hg.active && !hg.active.setup) {
      send({ type: MSG_DAY_HG_SKIP });
    } else if (hg.active?.setup) {
      send({ type: MSG_DAY_HG_TIMER_START });
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slotIndex = this.slotIndexMap.get((ev as any).action) ?? 0;
      const session = hg.scheduled[slotIndex];
      if (session) send({ type: MSG_DAY_HG_START, projectId: session.projectId, date: session.date });
    }
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      if (this.lastState?.hg.active) send({ type: MSG_DAY_HG_STOP });
      return;
    }
    const hg = this.lastState?.hg;
    if (!hg) return;
    if (hg.active?.completed) {
      send({ type: MSG_DAY_HG_COMPLETE });
    } else if (hg.active && !hg.active.setup) {
      send({ type: MSG_DAY_HG_SKIP });
    } else if (hg.active?.setup) {
      send({ type: MSG_DAY_HG_TIMER_START });
    } else {
      const session = hg.scheduled[0];
      if (session) send({ type: MSG_DAY_HG_START, projectId: session.projectId, date: session.date });
    }
  }

  // ── Pulse management ───────────────────────────────────────────────────────

  private updatePulse(state: DayGlanceState): void {
    const hasReachable = !state.hg.active && state.hg.scheduled.some(s => s.reachable);
    if (hasReachable && !this.pulseTimer) {
      this.pulseTimer = setInterval(() => {
        this.pulseOn = !this.pulseOn;
        if (this.lastState) {
          this.renderAll(this.lastState).catch(() => {/* swallow */});
        }
      }, 700);
    } else if (!hasReachable && this.pulseTimer) {
      this.stopPulse();
    }
  }

  private stopPulse(): void {
    if (this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
    }
    this.pulseOn = false;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const isEncoder = this.encoderRefs.has(act);
    const { hg } = state;
    const active = hg.active;

    if (isEncoder) {
      const slotIndex = this.slotIndexMap.get(act) ?? 0;

      if (active?.completed) {
        // Completion screen — show project name with checkmark
        const barColor = active.colorHex;
        await act.setImage(renderKey({ value: "✓", sub: truncate(active.title, 14), barColor }));
        await act.setFeedback({ canvas: renderHGIdleSlot(
          { title: "Session Complete!", colorHex: barColor, startTime: "press to exit" },
          false,
        )});

      } else if (active && !active.setup) {
        // Active session — reuse focus slot rendering; map HG phase names to focus names
        const phase = active.phase === "shortBreak" ? "break" : active.phase;
        await act.setImage(renderFocusSlotKey(slotIndex, phase, active.secondsRemaining, active.cycleCount));
        await act.setFeedback({ canvas: renderFocusSlot(slotIndex, phase, active.secondsRemaining, active.cycleCount) });

      } else if (active?.setup) {
        // Setup screen
        const barColor = this.adjusting === "longBreak" ? "#16a34a" : this.adjusting === "break" ? "#22c55e" : active.colorHex;
        const value = this.adjusting === "work" ? `${active.workMinutes}m` : this.adjusting === "break" ? `${active.breakMinutes}m` : `${active.longBreakMinutes}m`;
        const sub = this.adjusting === "work" ? "work" : this.adjusting === "break" ? "break" : "long break";
        await act.setImage(renderKey({ value, sub, barColor }));
        await act.setFeedback({ canvas: renderFocusSetupSlot(slotIndex, active.workMinutes, active.breakMinutes, active.longBreakMinutes, this.adjusting) });

      } else {
        // Idle — show scheduled session for this slot
        const session = hg.scheduled[slotIndex] ?? null;
        const reachable = session?.reachable ?? false;
        await act.setImage(renderHGIdleKey(session, reachable && this.pulseOn));
        await act.setFeedback({ canvas: renderHGIdleSlot(session, reachable && this.pulseOn) });
      }
      return;
    }

    // Non-encoder key button
    if (active?.completed) {
      await act.setImage(renderKey({ value: "✓", sub: truncate(active.title, 14), barColor: active.colorHex }));
    } else if (active && !active.setup) {
      const phase = active.phase === "shortBreak" ? "break" : active.phase;
      const m = Math.floor(active.secondsRemaining / 60);
      const s = active.secondsRemaining % 60;
      const barColor = phase === "work" ? active.colorHex : "#22c55e";
      await act.setImage(renderKey({ value: `${m}:${s.toString().padStart(2, "0")}`, sub: phase === "work" ? "work" : "break", barColor }));
    } else if (active?.setup) {
      const barColor = this.adjusting === "longBreak" ? "#16a34a" : this.adjusting === "break" ? "#22c55e" : active.colorHex;
      const value = this.adjusting === "work" ? `${active.workMinutes}m` : this.adjusting === "break" ? `${active.breakMinutes}m` : `${active.longBreakMinutes}m`;
      await act.setImage(renderKey({ value, sub: "press to start", barColor }));
    } else {
      const session = hg.scheduled[0] ?? null;
      await act.setImage(renderHGIdleKey(session, session?.reachable && this.pulseOn));
    }
    await act.setTitle("");
  }
}
