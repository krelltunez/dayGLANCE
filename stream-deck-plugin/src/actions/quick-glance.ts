import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

type DisplayMode = "date" | "weather" | "next-event";

const MODES: DisplayMode[] = ["date", "weather", "next-event"];

@action({ UUID: "app.dayglance.streamdeck.quick-glance" })
export class QuickGlanceAction extends SingletonAction {
  private modeIndex = 0;
  private pinned = false;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    await this.refresh(ev.action);
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    if (this.pinned) return;
    this.modeIndex = (this.modeIndex + ev.payload.ticks + MODES.length) % MODES.length;
    await this.refresh(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    this.pinned = !this.pinned;
    await this.refresh(ev.action);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async refresh(actionRef: any): Promise<void> {
    const mode = MODES[this.modeIndex];
    // TODO: render mode data from WS state
    await actionRef.setTitle(mode);
  }
}
