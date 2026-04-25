import {
  action,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, Task, onState, send, MSG_DAY_TASK_COMPLETE } from "../client";
import { renderKey, renderStrip, stripTags, truncate } from "../render";

@action({ UUID: "app.dayglance.streamdeck.up-next" })
export class UpNextAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((ev.payload as any).controller === "Encoder") {
      this.encoderRefs.add(ev.action);
    }
    if (!this.unsubscribe) {
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] up-next render:", e));
      });
      // Refresh countdown every minute between state pushes
      this.refreshTimer = setInterval(() => {
        if (this.lastState) {
          this.renderAll(this.lastState).catch(e => console.error("[dayGLANCE] up-next refresh:", e));
        }
      }, 60_000);
    }
    if (this.lastState) await this.renderOne(ev.action, this.lastState);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    this.encoderRefs.delete(ev.action);
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      if (this.refreshTimer !== null) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = null;
      }
    }
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    await this.completeIfInProgress();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await this.completeIfInProgress();
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) await this.completeIfInProgress();
  }

  private async completeIfInProgress(): Promise<void> {
    const task = this.lastState?.currentTask;
    if (task) send({ type: MSG_DAY_TASK_COMPLETE, id: task.id });
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const isEncoder = this.encoderRefs.has(act);
    const renderOpts = buildRenderOpts(state);
    await act.setImage(renderKey(renderOpts));
    if (isEncoder) {
      await act.setFeedback({ canvas: renderStrip(renderOpts) });
    } else {
      await act.setTitle("");
    }
  }
}

function buildRenderOpts(state: DayGlanceState): Parameters<typeof renderKey>[0] {
  const nowMin = nowMinutes();

  if (state.currentTask) {
    const task = state.currentTask;
    const endMin = timeToMin(task.startTime!) + task.duration;
    const remaining = Math.max(0, endMin - nowMin);
    return {
      value: truncate(stripTags(task.title), 12),
      sub: formatRemaining(remaining),
      barColor: task.colorHex,
    };
  }

  if (state.nextTask) {
    const task = state.nextTask;
    const startMin = timeToMin(task.startTime!);
    const until = Math.max(0, startMin - nowMin);
    return {
      value: truncate(stripTags(task.title), 12),
      sub: formatCountdown(until),
      barColor: task.colorHex,
    };
  }

  return { value: "All clear", sub: "nothing up next", dim: true };
}

function nowMinutes(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function formatCountdown(minutes: number): string {
  if (minutes === 0) return "starting now";
  if (minutes < 60) return `in ${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
}

function formatRemaining(minutes: number): string {
  if (minutes === 0) return "ending now";
  if (minutes < 60) return `${minutes}m left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m left` : `${h}h left`;
}
