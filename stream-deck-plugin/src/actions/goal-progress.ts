import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

type Settings = {
  instanceUrl: string;
  apiToken: string;
};

@action({ UUID: "app.dayglance.streamdeck.goal-progress" })
export class GoalProgressAction extends SingletonAction<Settings> {
  private goalIndex = 0;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    await this.refresh(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    this.goalIndex = Math.max(0, this.goalIndex + ev.payload.ticks);
    await this.refresh(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    await this.refresh(ev.action);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async refresh(actionRef: any): Promise<void> {
    // TODO: fetch goals from dayGLANCE backend, render goal at this.goalIndex
    // with arc + progress % on the touch bar layout
    await actionRef.setTitle("Goals");
  }
}
