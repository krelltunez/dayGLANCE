import {
  action,
  DialRotateEvent,
  DialUpEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

type Settings = {
  instanceUrl: string;
  apiToken: string;
  sessionDurationMinutes: number;
};

type Phase = "idle" | "work" | "break";

@action({ UUID: "app.dayglance.streamdeck.focus" })
export class FocusAction extends SingletonAction<Settings> {
  private phase: Phase = "idle";
  private remainingSeconds = 0;
  private sessionCount = 0;
  private tickInterval: ReturnType<typeof setInterval> | undefined;

  override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
    const settings = await ev.action.getSettings();
    await ev.action.setTitle(this.buildTitle());
    // TODO: poll dayGLANCE backend for current focus state and sync
    void settings;
  }

  override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
    if (this.phase !== "idle") return;
    const settings = await ev.action.getSettings();
    const delta = ev.payload.ticks;
    const newDuration = Math.max(5, (settings.sessionDurationMinutes ?? 25) + delta);
    await ev.action.setSettings({ ...settings, sessionDurationMinutes: newDuration });
    await ev.action.setTitle(`${newDuration}m`);
  }

  override async onDialUp(ev: DialUpEvent<Settings>): Promise<void> {
    await this.toggleSession(ev.action);
  }

  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    await this.toggleSession(ev.action);
  }

  private async toggleSession(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actionRef: any
  ): Promise<void> {
    if (this.phase === "idle") {
      const settings: Settings = await actionRef.getSettings();
      this.phase = "work";
      this.remainingSeconds = (settings.sessionDurationMinutes ?? 25) * 60;
      this.startTick(actionRef);
      // TODO: POST to dayGLANCE backend to start focus mode
    } else {
      this.stopTick();
      this.phase = "idle";
      await actionRef.setState(0);
      await actionRef.setTitle("Focus");
      // TODO: POST to dayGLANCE backend to end focus mode
    }
  }

  private startTick(actionRef: unknown): void {
    this.tickInterval = setInterval(async () => {
      this.remainingSeconds--;
      if (this.remainingSeconds <= 0) {
        this.stopTick();
        if (this.phase === "work") {
          this.sessionCount++;
          this.phase = "break";
          this.remainingSeconds = 5 * 60;
          this.startTick(actionRef);
        } else {
          this.phase = "idle";
        }
      }
      // @ts-expect-error actionRef typed as unknown for simplicity
      await actionRef.setTitle(this.buildTitle());
    }, 1000);
  }

  private stopTick(): void {
    if (this.tickInterval !== undefined) {
      clearInterval(this.tickInterval);
      this.tickInterval = undefined;
    }
  }

  private buildTitle(): string {
    if (this.phase === "idle") return "Focus";
    const m = Math.floor(this.remainingSeconds / 60);
    const s = this.remainingSeconds % 60;
    const tomatoes = "🍅".repeat(this.sessionCount);
    const label = this.phase === "work" ? "Work" : "Break";
    return `${label}\n${m}:${s.toString().padStart(2, "0")}\n${tomatoes}`;
  }
}
