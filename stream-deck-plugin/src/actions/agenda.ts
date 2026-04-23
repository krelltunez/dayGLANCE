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

@action({ UUID: "app.dayglance.streamdeck.agenda" })
export class AgendaAction extends SingletonAction<Settings> {
  private scrollOffset = 0;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    await this.refresh(ev.action.getSettings());
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    this.scrollOffset = Math.max(0, this.scrollOffset + ev.payload.ticks);
    await this.refresh(ev.action.getSettings());
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    this.scrollOffset = Math.max(0, this.scrollOffset + 1);
    await this.refresh(ev.action.getSettings());
  }

  private async refresh(_settings: Promise<Settings>): Promise<void> {
    // TODO: fetch today's events from dayGLANCE backend and render to touch bar
  }
}
