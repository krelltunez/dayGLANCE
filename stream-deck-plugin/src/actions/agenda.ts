import {
  action,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";
import { renderKey, stripTags, truncate } from "../render";

@action({ UUID: "app.dayglance.streamdeck.agenda" })
export class AgendaAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  // 0 = overview (X/Y + Z%), 1..N = task at index (viewIndex - 1)
  private viewIndex: number = 0;
  private visibleCount = 0;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
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

  override async onWillDisappear(_ev: WillDisappearEvent): Promise<void> {
    this.visibleCount = Math.max(0, this.visibleCount - 1);
    if (this.visibleCount === 0) {
      this.unsubscribe?.();
      this.unsubscribe = null;
    }
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    await this.cycle();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    await this.cycle();
  }

  private async cycle(): Promise<void> {
    if (!this.lastState) return;
    const count = this.lastState.scheduledTasks?.length ?? 0;
    if (count === 0) return;
    this.viewIndex = (this.viewIndex + 1) % (count + 1);
    await this.renderAll(this.lastState);
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const tasks = state.scheduledTasks ?? [];
    let image: string;
    if (this.viewIndex === 0 || tasks.length === 0) {
      const { completed, total } = state.today;
      const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
      image = renderKey({ value: `${completed}/${total}`, sub: `${pct}% done` });
    } else {
      const task = tasks[this.viewIndex - 1];
      const title = truncate(stripTags(task.title), 12);
      const time = task.startTime ? formatTime(task.startTime) : "";
      image = renderKey({ value: title, sub: time, barColor: task.colorHex, strikethrough: task.completed });
    }
    if (act.controller === "Encoder") {
      await act.setFeedback({ icon: image });
    } else {
      await act.setImage(image);
      await act.setTitle("");
    }
  }
}

function formatTime(t: string): string {
  const [h, m] = t.split(":");
  return `${parseInt(h, 10)}:${m}`;
}
