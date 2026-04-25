import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState, send, MSG_DAY_ROUTINE_COMPLETE } from "../client";
import { renderKey, truncate } from "../render";

@action({ UUID: "app.dayglance.streamdeck.routine" })
export class RoutineAction extends SingletonAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionRef: any = null;
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.actionRef = ev.action;
    this.unsubscribe?.();
    this.unsubscribe = onState((s) => {
      this.lastState = s;
      this.render(s).catch(e => console.error("[dayGLANCE] routine render:", e));
    });
    if (this.lastState) await this.render(this.lastState);
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    const routine = this.lastState?.nextRoutine;
    if (routine) send({ type: MSG_DAY_ROUTINE_COMPLETE, id: routine.id });
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const routine = state.nextRoutine;
    if (!routine) {
      await this.actionRef.setImage(renderKey({ value: "✓", sub: "all done", barColor: "#22c55e" }));
    } else {
      const name = truncate(routine.name, 14);
      const sub = routine.startTime ?? "routine";
      await this.actionRef.setImage(renderKey({ value: name, sub }));
    }
    await this.actionRef.setTitle("");
  }
}
