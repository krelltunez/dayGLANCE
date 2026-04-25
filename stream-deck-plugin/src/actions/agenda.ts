import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_TASK_COMPLETE } from "../client";
import { renderKey, renderStrip, stripTags, truncate } from "../render";

@action({ UUID: "app.dayglance.streamdeck.agenda" })
export class AgendaAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  // 0 = overview (X/Y + Z%), 1..N = task at index (viewIndex - 1)
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
        const count = s.scheduledTasks?.length ?? 0;
        if (this.viewIndex > count) this.viewIndex = 0;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] agenda render:", e));
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
    const count = this.lastState.scheduledTasks?.length ?? 0;
    if (count === 0) return;
    const total = count + 1;
    this.viewIndex = ((this.viewIndex + ev.payload.ticks) % total + total) % total;
    await this.renderAll(this.lastState);
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    await this.completeCurrentTask();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await this.completeCurrentTask();
  }

  private async completeCurrentTask(): Promise<void> {
    if (!this.lastState || this.viewIndex === 0) return;
    const task = this.lastState.scheduledTasks?.[this.viewIndex - 1];
    if (task) send({ type: MSG_DAY_TASK_COMPLETE, id: task.id });
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const tasks = state.scheduledTasks ?? [];
    const isEncoder = this.encoderRefs.has(act);

    let renderOpts: Parameters<typeof renderKey>[0];

    if (this.viewIndex === 0 || tasks.length === 0) {
      const { completed, total } = state.today;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      renderOpts = { value: `${completed}/${total}`, sub: `${pct}% done` };
    } else {
      const task = tasks[this.viewIndex - 1];
      const title = truncate(stripTags(task.title), 12);
      const sub = task.completed ? "Completed" : (task.startTime ? formatTime(task.startTime) : "");
      renderOpts = { value: title, sub, barColor: task.colorHex, strikethrough: task.completed };
    }

    await act.setImage(renderKey(renderOpts));
    if (isEncoder) {
      await act.setFeedback({ canvas: renderStrip(renderOpts) });
    } else {
      await act.setTitle("");
    }
  }
}

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  return `${parseInt(h, 10)}:${m}`;
}
