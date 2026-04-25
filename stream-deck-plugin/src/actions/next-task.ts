import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_TASK_COMPLETE } from "../client";
import { renderKey, stripTags, truncate } from "../render";

@action({ UUID: "app.dayglance.streamdeck.next-task" })
export class NextTaskAction extends SingletonAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionRef: any = null;
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private showNext = false;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.actionRef = ev.action;
    this.unsubscribe?.();
    this.unsubscribe = onState((s) => {
      this.lastState = s;
      this.render(s).catch(e => console.error("[dayGLANCE] next-task render:", e));
    });
    if (this.lastState) await this.render(this.lastState);
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    this.showNext = ev.payload.ticks > 0;
    if (this.lastState) this.render(this.lastState).catch(e => console.error("[dayGLANCE] next-task render:", e));
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const task = this.showNext
      ? this.lastState?.nextTask
      : (this.lastState?.currentTask ?? this.lastState?.nextTask);
    if (task) send({ type: MSG_DAY_TASK_COMPLETE, id: task.id });
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const task = this.showNext
      ? state.nextTask
      : (state.currentTask ?? state.nextTask);
    const label = this.showNext ? "next task" : "current task";
    if (task) {
      await this.actionRef.setImage(renderKey({ value: truncate(stripTags(task.title), 18), sub: label }));
    } else {
      await this.actionRef.setImage(renderKey({ value: "No tasks", dim: true }));
    }
    await this.actionRef.setTitle("");
  }
}
