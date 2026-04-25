import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";

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
    let title: string;

    if (mode === "date") {
      title = formatDate(state.today.date);
    } else if (mode === "next-event") {
      const task = state.currentTask ?? state.nextTask;
      title = task ? truncate(task.title, 20) : "No events";
    } else {
      const { active, phase, secondsRemaining } = state.focus;
      if (!active) {
        title = "Focus\noff";
      } else {
        const m = Math.floor(secondsRemaining / 60);
        const s = secondsRemaining % 60;
        title = `${phase}\n${m}:${s.toString().padStart(2, "0")}`;
      }
    }

    await this.actionRef.setTitle(title);
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
