import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  KeyUpEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";
import { renderGoalKey, renderGoalStrip } from "../render";

@action({ UUID: "com.dayglance.streamdeck.goal-progress" })
export class GoalProgressAction extends SingletonAction {
  private unsubscribe: (() => void) | null = null;
  private lastState: DayGlanceState | null = null;
  private visibleCount = 0;
  // 0 = overview, 1..N = goal at index (viewIndex - 1)
  private viewIndex = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private encoderRefs = new Set<any>();
  private keyLongPressTimer: ReturnType<typeof setTimeout> | null = null;

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
        const count = s.goals?.length ?? 0;
        if (this.viewIndex > count) this.viewIndex = 0;
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

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    await this.cycleView(ev.payload.ticks);
  }

  override async onDialUp(_ev: DialUpEvent): Promise<void> {
    // No action for goals from the deck yet
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    this.keyLongPressTimer = setTimeout(async () => {
      this.keyLongPressTimer = null;
      // No long-press action for goals yet
    }, 500);
  }

  override async onKeyUp(_ev: KeyUpEvent): Promise<void> {
    if (this.keyLongPressTimer !== null) {
      clearTimeout(this.keyLongPressTimer);
      this.keyLongPressTimer = null;
      await this.cycleView(1);
    }
  }

  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) return;
    const delta = ev.payload.tapPos[0] < 100 ? -1 : 1;
    await this.cycleView(delta);
  }

  private async cycleView(delta: number): Promise<void> {
    if (!this.lastState) return;
    const count = this.lastState.goals?.length ?? 0;
    if (count === 0) return;
    const total = count + 1;
    this.viewIndex = ((this.viewIndex + delta) % total + total) % total;
    await this.renderAll(this.lastState);
  }

  private async renderAll(state: DayGlanceState): Promise<void> {
    for (const act of this.actions) {
      await this.renderOne(act, state);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async renderOne(act: any, state: DayGlanceState): Promise<void> {
    const isEncoder = this.encoderRefs.has(act);
    const goals = sortGoals(state.goals ?? []);
    const linkedProjectCount = (state.projects ?? []).filter(p => p.goalTitle).length;

    let keyImg: string;
    let stripImg: string;

    if (this.viewIndex === 0 || goals.length === 0) {
      const avgProgress = goals.length > 0
        ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / goals.length)
        : 0;
      const opts = { title: "", progress: 0, colorHex: "#f97316", overview: true, goalCount: goals.length, avgProgress, linkedProjectCount };
      keyImg = renderGoalKey(opts);
      stripImg = renderGoalStrip(opts);
    } else {
      const goal = goals[this.viewIndex - 1];
      const opts = { title: goal.title, progress: goal.progress, colorHex: goal.colorHex, daysLeft: goal.daysLeft };
      keyImg = renderGoalKey(opts);
      stripImg = renderGoalStrip(opts);
    }

    await act.setImage(keyImg);
    if (isEncoder) {
      await act.setFeedback({ canvas: stripImg });
    } else {
      await act.setTitle("");
    }
  }
}

// Sort by target date asc (soonest first); goals without a target go last,
// ordered by progress desc so unstarted ones sit at the bottom.
function sortGoals<T extends { daysLeft: number | null; progress: number }>(goals: T[]): T[] {
  return [...goals].sort((a, b) => {
    if (a.daysLeft !== null && b.daysLeft !== null) return a.daysLeft - b.daysLeft;
    if (a.daysLeft !== null) return -1;
    if (b.daysLeft !== null) return 1;
    return b.progress - a.progress;
  });
}
