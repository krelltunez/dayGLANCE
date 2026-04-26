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
import { DayGlanceState, onState, send, MSG_DAY_TASK_COMPLETE } from "../client";
import { renderKey, renderStrip, stripTags, truncate } from "../render";

@action({ UUID: "com.dayglance.streamdeck.next-task" })
export class NextTaskAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();
  private showNext = false;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((ev.payload as any).controller === "Encoder") {
      this.encoderRefs.add(ev.action);
    }
    if (!this.unsubscribe) {
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] next-task render:", e));
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
    this.showNext = ev.payload.ticks > 0;
    if (this.lastState) await this.renderAll(this.lastState);
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    await this.completeCurrentTask();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await this.completeCurrentTask();
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      await this.completeCurrentTask();
      return;
    }
    this.showNext = ev.payload.tapPos[0] >= 100;
    if (this.lastState) await this.renderAll(this.lastState);
  }

  private async completeCurrentTask(): Promise<void> {
    const task = this.showNext
      ? this.lastState?.nextTask
      : (this.lastState?.currentTask ?? this.lastState?.nextTask);
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
    const task = this.showNext
      ? state.nextTask
      : (state.currentTask ?? state.nextTask);
    const label = this.showNext ? "next task" : "current task";
    const renderOpts = task
      ? { value: truncate(stripTags(task.title), 12), sub: label }
      : { value: "No tasks", dim: true as const };
    await act.setImage(renderKey(renderOpts));
    if (isEncoder) {
      await act.setFeedback({ canvas: renderStrip(renderOpts) });
    } else {
      await act.setTitle("");
    }
  }
}
