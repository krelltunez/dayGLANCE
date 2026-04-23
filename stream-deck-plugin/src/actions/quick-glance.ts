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

type DisplayMode = "date" | "weather" | "next-event";

const MODES: DisplayMode[] = ["date", "weather", "next-event"];

@action({ UUID: "app.dayglance.streamdeck.quick-glance" })
export class QuickGlanceAction extends SingletonAction<Settings> {
  private modeIndex = 0;
  private pinned = false;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    await this.refresh(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    if (this.pinned) return;
    this.modeIndex = (this.modeIndex + ev.payload.ticks + MODES.length) % MODES.length;
    await this.refresh(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    this.pinned = !this.pinned;
    await this.refresh(ev.action);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async refresh(actionRef: any): Promise<void> {
    const mode = MODES[this.modeIndex];
    // TODO: fetch data for current mode from dayGLANCE backend
    await actionRef.setTitle(mode);
  }
}
