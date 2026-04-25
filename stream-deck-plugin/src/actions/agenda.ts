import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";
import { renderKey, stripTags, truncate } from "../render";

@action({ UUID: "app.dayglance.streamdeck.agenda" })
export class AgendaAction extends SingletonAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionRef: any = null;
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  // 0 = overview (X/Y + Z%), 1..N = task at index (viewIndex - 1)
  private viewIndex: number = 0;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.actionRef = ev.action;
    this.viewIndex = 0;
    this.unsubscribe?.();
    this.unsubscribe = onState((s) => {
      this.lastState = s;
      const count = s.scheduledTasks?.length ?? 0;
      if (this.viewIndex > count) this.viewIndex = 0;
      this.render(s).catch(e => console.error("[dayGLANCE] agenda render:", e));
    });
    if (this.lastState) await this.render(this.lastState);
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    if (!this.lastState) return;
    const count = this.lastState.scheduledTasks?.length ?? 0;
    if (count === 0) return;
    this.viewIndex = (this.viewIndex + 1) % (count + 1);
    await this.render(this.lastState);
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const tasks = state.scheduledTasks ?? [];
    if (this.viewIndex === 0 || tasks.length === 0) {
      const { completed, total } = state.today;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      await this.actionRef.setImage(renderKey({ value: `${completed}/${total}`, sub: `${pct}% done` }));
    } else {
      const task = tasks[this.viewIndex - 1];
      const title = truncate(stripTags(task.title), 12);
      const time = task.startTime ? formatTime(task.startTime) : "";
      await this.actionRef.setImage(renderKey({
        value: title,
        sub: time,
        barColor: task.colorHex,
      }));
    }
    await this.actionRef.setTitle("");
  }
}

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  return `${parseInt(h, 10)}:${m}`;
}
