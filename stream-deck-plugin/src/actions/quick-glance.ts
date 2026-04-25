import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";
import { renderKey } from "../render";

type DisplayMode = "date" | "next-event" | "focus";
const MODES: DisplayMode[] = ["date", "next-event", "focus"];

@action({ UUID: "app.dayglance.streamdeck.quick-glance" })
export class QuickGlanceAction extends SingletonAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionRef: any = null;
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private modeIndex = 0;
  private pinned = false;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.actionRef = ev.action;
    this.unsubscribe?.();
    this.unsubscribe = onState((s) => {
      this.lastState = s;
      void this.render(s);
    });
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (this.pinned) return;
    this.modeIndex = (this.modeIndex + ev.payload.ticks + MODES.length) % MODES.length;
    if (this.lastState) void this.render(this.lastState);
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    this.pinned = !this.pinned;
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const mode = MODES[this.modeIndex];

    if (mode === "date") {
      const { weekday, month, day } = formatDate(state.today.date);
      await this.actionRef.setImage(renderKey({ value: `${month} ${day}`, sub: weekday }));
    } else if (mode === "next-event") {
      const task = state.currentTask ?? state.nextTask;
      if (task) {
        await this.actionRef.setImage(renderKey({ value: truncate(task.title, 18), sub: "next up" }));
      } else {
        await this.actionRef.setImage(renderKey({ value: "Clear", sub: "no events", dim: true }));
      }
    } else {
      const { active, phase, secondsRemaining } = state.focus;
      if (!active) {
        await this.actionRef.setImage(renderKey({ value: "Focus", sub: "off", dim: true }));
      } else {
        const m = Math.floor(secondsRemaining / 60);
        const s = secondsRemaining % 60;
        const barColor = phase === "work" ? "#f97316" : "#22c55e";
        await this.actionRef.setImage(renderKey({ value: `${m}:${s.toString().padStart(2, "0")}`, sub: phase, barColor }));
      }
    }
    await this.actionRef.setTitle("");
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
