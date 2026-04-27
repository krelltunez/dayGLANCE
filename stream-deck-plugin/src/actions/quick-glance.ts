import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  KeyUpEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";
import { renderKey, renderStrip, stripTags, truncate } from "../render";

type DisplayMode = "date" | "next-event" | "focus";
const MODES: DisplayMode[] = ["date", "next-event", "focus"];
const AUTO_ROTATE_MS = 10_000;

@action({ UUID: "com.dayglance.streamdeck.quick-glance" })
export class QuickGlanceAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();
  private modeIndex = 0;
  private pinned = false;
  private autoRotateTimer: ReturnType<typeof setInterval> | null = null;
  private keyLongPressTimer: ReturnType<typeof setTimeout> | null = null;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((ev.payload as any).controller === "Encoder") {
      this.encoderRefs.add(ev.action);
    }
    if (!this.unsubscribe) {
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] quick-glance render:", e));
      });
      this.startAutoRotate();
    }
    if (this.lastState) await this.renderOne(ev.action, this.lastState);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    this.encoderRefs.delete(ev.action);
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.stopAutoRotate();
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (this.pinned) return;
    await this.cycleMode(ev.payload.ticks);
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    this.togglePin();
    if (this.lastState) await this.renderAll(this.lastState);
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    this.keyLongPressTimer = setTimeout(async () => {
      this.keyLongPressTimer = null;
      this.togglePin();
      if (this.lastState) await this.renderAll(this.lastState);
    }, 500);
  }

  override async onKeyUp(_ev: KeyUpEvent): Promise<void> {
    if (this.keyLongPressTimer !== null) {
      clearTimeout(this.keyLongPressTimer);
      this.keyLongPressTimer = null;
      if (!this.pinned) await this.cycleMode(1);
    }
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      this.togglePin();
      if (this.lastState) await this.renderAll(this.lastState);
      return;
    }
    if (this.pinned) return;
    const delta = ev.payload.tapPos[0] < 100 ? -1 : 1;
    await this.cycleMode(delta);
  }

  private async cycleMode(delta: number): Promise<void> {
    const total = MODES.length;
    this.modeIndex = ((this.modeIndex + delta) % total + total) % total;
    this.startAutoRotate(); // reset the timer on manual cycle
    if (this.lastState) await this.renderAll(this.lastState);
  }

  private togglePin(): void {
    this.pinned = !this.pinned;
    if (this.pinned) {
      this.stopAutoRotate();
    } else {
      this.startAutoRotate();
    }
  }

  private startAutoRotate(): void {
    this.stopAutoRotate();
    this.autoRotateTimer = setInterval(async () => {
      if (!this.lastState) return;
      this.modeIndex = (this.modeIndex + 1) % MODES.length;
      await this.renderAll(this.lastState).catch(e => console.error("[dayGLANCE] quick-glance auto-rotate:", e));
    }, AUTO_ROTATE_MS);
  }

  private stopAutoRotate(): void {
    if (this.autoRotateTimer !== null) {
      clearInterval(this.autoRotateTimer);
      this.autoRotateTimer = null;
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
    const mode = MODES[this.modeIndex];
    let renderOpts: Parameters<typeof renderKey>[0];

    if (mode === "date") {
      const { weekday, month, day } = formatDate(state.today.date);
      const sub = this.pinned ? `${weekday} ●` : weekday;
      renderOpts = { value: `${month} ${day}`, sub };
    } else if (mode === "next-event") {
      const task = state.currentTask ?? state.nextTask;
      if (task) {
        const timeLabel = task.startTime ? eventTimeLabel(task.startTime, task.duration, state.use24Hour ?? false) : "";
        const sub = this.pinned ? `${timeLabel} ●` : timeLabel;
        renderOpts = { value: truncate(stripTags(task.title), 12), sub };
      } else {
        const sub = this.pinned ? "no events ●" : "no events";
        renderOpts = { value: "Clear", sub, dim: true };
      }
    } else {
      const { active, phase, secondsRemaining } = state.focus;
      if (!active) {
        const sub = this.pinned ? "off ●" : "off";
        renderOpts = { value: "Focus", sub, dim: true };
      } else {
        const m = Math.floor(secondsRemaining / 60);
        const s = secondsRemaining % 60;
        const barColor = phase === "work" ? "#f97316" : "#22c55e";
        const sub = this.pinned ? `${phase} ●` : phase;
        renderOpts = { value: `${m}:${s.toString().padStart(2, "0")}`, sub, barColor };
      }
    }

    await act.setImage(renderKey(renderOpts));
    if (isEncoder) {
      await act.setFeedback({ canvas: renderStrip(renderOpts) });
    } else {
      await act.setTitle("");
    }
  }
}

function formatDate(iso: string): { weekday: string; month: string; day: string } {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "long" }),
    month: date.toLocaleDateString("en-US", { month: "short" }),
    day: String(d),
  };
}

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function nowMin(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function formatTime(t: string, use24Hour: boolean): string {
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr.padStart(2, "0");
  if (use24Hour) return `${h.toString().padStart(2, "0")}:${m}`;
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const ampm = h >= 12 ? "PM" : "AM";
  return `${displayHour}:${m} ${ampm}`;
}

function eventTimeLabel(startTime: string, duration: number, use24Hour: boolean): string {
  const start = toMin(startTime);
  const now = nowMin();
  if (start > now) return formatTime(startTime, use24Hour);
  if (duration > 0 && start + duration > now) return "In Progress";
  return "Overdue";
}
