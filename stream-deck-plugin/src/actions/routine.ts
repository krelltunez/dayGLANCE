import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_ROUTINE_COMPLETE } from "../client";
import { renderKey, truncate } from "../render";

@action({ UUID: "app.dayglance.streamdeck.routine" })
export class RoutineAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.visibleCount++;
    if (!this.unsubscribe) {
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] routine render:", e));
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

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const routine = this.lastState?.nextRoutine;
    if (routine) send({ type: MSG_DAY_ROUTINE_COMPLETE, id: routine.id });
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const routine = state.nextRoutine;
    if (!routine) {
      await act.setImage(renderKey({ value: "✓", sub: "all done", barColor: "#22c55e" }));
    } else {
      await act.setImage(renderKey({ value: truncate(routine.name, 14), sub: routine.startTime ?? "routine" }));
    }
    await act.setTitle("");
  }
}
