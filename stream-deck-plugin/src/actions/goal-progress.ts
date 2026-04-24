import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

@action({ UUID: "app.dayglance.streamdeck.goal-progress" })
export class GoalProgressAction extends SingletonAction {
  private goalIndex = 0;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.refresh(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    this.goalIndex = Math.max(0, this.goalIndex + ev.payload.ticks);
    await this.refresh(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.refresh(ev.action);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async refresh(actionRef: any): Promise<void> {
    // TODO: render goal at this.goalIndex from WS state (arc + progress %)
    await actionRef.setTitle("Goals");
  }
}
