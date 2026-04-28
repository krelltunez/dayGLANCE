import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyUpEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";
import { renderKey, renderStrip, stripTags, truncate } from "../render";

@action({ UUID: "com.dayglance.streamdeck.tomorrow" })
export class TomorrowAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  // 0 = overview (count + "Tomorrow"), 1..N = task at index (viewIndex - 1)
  private viewIndex: number = 0;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((ev.payload as any).controller === "Encoder") {
      this.encoderRefs.add(ev.action);
    }
    if (!this.unsubscribe) {
      this.viewIndex = 0;
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        const count = s.tomorrow?.tasks?.length ?? 0;
        if (this.viewIndex > count) this.viewIndex = 0;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] tomorrow render:", e));
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
    if (!this.lastState) return;
    const count = this.lastState.tomorrow?.tasks?.length ?? 0;
    if (count === 0) return;
    const total = count + 1;
    this.viewIndex = ((this.viewIndex + ev.payload.ticks) % total + total) % total;
    await this.renderAll(this.lastState);
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    await this.cycleView(1);
  }

  override async onKeyUp(_ev: KeyUpEvent): Promise<void> {
    await this.cycleView(1);
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (!this.lastState) return;
    const delta = ev.payload.tapPos[0] < 100 ? -1 : 1;
    await this.cycleView(delta);
  }

  private async cycleView(delta: number): Promise<void> {
    if (!this.lastState) return;
    const count = this.lastState.tomorrow?.tasks?.length ?? 0;
    if (count === 0) return;
    const total = count + 1;
    this.viewIndex = ((this.viewIndex + delta) % total + total) % total;
    await this.renderAll(this.lastState);
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const tasks = state.tomorrow?.tasks ?? [];
    const isEncoder = this.encoderRefs.has(act);

    let renderOpts: Parameters<typeof renderKey>[0];

    if (this.viewIndex === 0 || tasks.length === 0) {
      const total = state.tomorrow?.total ?? 0;
      renderOpts = {
        value: total > 0 ? String(total) : "—",
        sub: "Tomorrow",
      };
    } else {
      const task = tasks[this.viewIndex - 1];
      const title = truncate(stripTags(task.title), 12);
      const use24Hour = state.use24Hour ?? false;
      const sub = task.isAllDay ? "All Day"
        : task.startTime ? formatTime(task.startTime, use24Hour)
        : "";
      renderOpts = { value: title, sub, barColor: task.colorHex };
    }

    await act.setImage(renderKey(renderOpts));
    if (isEncoder) {
      await act.setFeedback({ canvas: renderStrip(renderOpts) });
    } else {
      await act.setTitle("");
    }
  }
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
