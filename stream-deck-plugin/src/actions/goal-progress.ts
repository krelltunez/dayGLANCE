import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";
import { renderKey, renderStrip } from "../render";

@action({ UUID: "app.dayglance.streamdeck.goal-progress" })
export class GoalProgressAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
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
      this.unsubscribe = onState((s) => {
        this.lastState = s;
        this.renderAll(s).catch(e => console.error("[dayGLANCE] goal-progress render:", e));
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

  override async onDialRotate(_ev: DialRotateEvent): Promise<void> {
    // TODO: cycle through goals when goal data is added to state
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    // TODO: interact with goal when goal data is added to state
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    // TODO: interact with goal when goal data is added to state
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const isEncoder = this.encoderRefs.has(act);
    const { completed, total } = state.today;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const renderOpts = { value: `${pct}%`, sub: "Today" };
    await act.setImage(renderKey(renderOpts));
    if (isEncoder) {
      await act.setFeedback({ canvas: renderStrip(renderOpts) });
    } else {
      await act.setTitle("");
    }
  }
}
