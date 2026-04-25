import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";
import { DayGlanceState, onState } from "../client";

@action({ UUID: "app.dayglance.streamdeck.agenda" })
export class AgendaAction extends SingletonAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private actionRef: any = null;
  private unsubscribe: (() => void) | null = null;

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.actionRef = ev.action;
    this.unsubscribe?.();
    this.unsubscribe = onState((s) => void this.render(s));
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    // reserved for future navigation
  }

  private async render(state: DayGlanceState): Promise<void> {
    if (!this.actionRef) return;
    const { completed, total } = state.today;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    await this.actionRef.setTitle(`${completed}/${total}\n${pct}%`);
  }
}
