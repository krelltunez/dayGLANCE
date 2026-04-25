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
import { DayGlanceState, onState } from "../client";
import { renderKey, renderStrip, stripTags, truncate } from "../render";

type DisplayMode = "date" | "next-event" | "focus";
const MODES: DisplayMode[] = ["date", "next-event", "focus"];

@action({ UUID: "app.dayglance.streamdeck.quick-glance" })
export class QuickGlanceAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();
  private modeIndex = 0;
  private pinned = false;

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
    }
    if (this.lastState) await this.renderOne(ev.action, this.lastState);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    this.encoderRefs.delete(ev.action);
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (this.pinned) return;
    const total = MODES.length;
    this.modeIndex = ((this.modeIndex + ev.payload.ticks) % total + total) % total;
    if (this.lastState) await this.renderAll(this.lastState);
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    this.pinned = !this.pinned;
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    this.pinned = !this.pinned;
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      this.pinned = !this.pinned;
      return;
    }
    if (this.pinned) return;
    const total = MODES.length;
    const delta = ev.payload.tapPos[0] < 100 ? -1 : 1;
    this.modeIndex = ((this.modeIndex + delta) % total + total) % total;
    if (this.lastState) await this.renderAll(this.lastState);
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
      renderOpts = { value: `${month} ${day}`, sub: weekday };
    } else if (mode === "next-event") {
      const task = state.currentTask ?? state.nextTask;
      renderOpts = task
        ? { value: truncate(stripTags(task.title), 12), sub: "next up" }
        : { value: "Clear", sub: "no events", dim: true };
    } else {
      const { active, phase, secondsRemaining } = state.focus;
      if (!active) {
        renderOpts = { value: "Focus", sub: "off", dim: true };
      } else {
        const m = Math.floor(secondsRemaining / 60);
        const s = secondsRemaining % 60;
        const barColor = phase === "work" ? "#f97316" : "#22c55e";
        renderOpts = { value: `${m}:${s.toString().padStart(2, "0")}`, sub: phase, barColor };
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
