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

@action({ UUID: "app.dayglance.streamdeck.next-task" })
export class NextTaskAction extends SingletonAction<Settings> {
  private taskIndex = 0;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    await this.refresh(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    this.taskIndex = Math.max(0, this.taskIndex + ev.payload.ticks);
    await this.refresh(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    // TODO: mark current task complete via dayGLANCE backend, then advance
    this.taskIndex = 0;
    await this.refresh(ev.action);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async refresh(actionRef: any): Promise<void> {
    // TODO: fetch tasks from dayGLANCE backend and render task at this.taskIndex
    await actionRef.setTitle("Next task");
  }
}
