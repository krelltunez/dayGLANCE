import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

@action({ UUID: "app.dayglance.streamdeck.next-task" })
export class NextTaskAction extends SingletonAction {
  private taskIndex = 0;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.refresh(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    this.taskIndex = Math.max(0, this.taskIndex + ev.payload.ticks);
    await this.refresh(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    // TODO: send task:complete via WS, then advance
    this.taskIndex = 0;
    await this.refresh(ev.action);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async refresh(actionRef: any): Promise<void> {
    // TODO: render task at this.taskIndex from WS state
    await actionRef.setTitle("Next task");
  }
}
