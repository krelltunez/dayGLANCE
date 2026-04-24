import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send } from "../client";

@action({ UUID: "app.dayglance.streamdeck.next-task" })
export class NextTaskAction extends SingletonAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionRef: any = null;
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private showNext = false; // false = currentTask, true = nextTask

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.actionRef = ev.action;
    this.unsubscribe?.();
    this.unsubscribe = onState((s) => {
      this.lastState = s;
      void this.render(s);
    });
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    this.showNext = ev.payload.ticks > 0 ? true : false;
    if (this.lastState) void this.render(this.lastState);
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const task = this.showNext
      ? this.lastState?.nextTask
      : (this.lastState?.currentTask ?? this.lastState?.nextTask);
    if (task) send({ type: "task:complete", id: task.id });
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const task = this.showNext
      ? state.nextTask
      : (state.currentTask ?? state.nextTask);
    await this.actionRef.setTitle(task ? truncate(task.title, 20) : "No tasks");
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
