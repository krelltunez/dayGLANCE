import {
  action,
  DialRotateEvent,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

@action({ UUID: "app.dayglance.streamdeck.agenda" })
export class AgendaAction extends SingletonAction {
  private scrollOffset = 0;

  override async onWillAppear(_ev: WillAppearEvent): Promise<void> {
    await this.refresh();
  }

  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    this.scrollOffset = Math.max(0, this.scrollOffset + ev.payload.ticks);
    await this.refresh();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    this.scrollOffset = Math.max(0, this.scrollOffset + 1);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    // TODO: render today's agenda from WS state
  }
}
