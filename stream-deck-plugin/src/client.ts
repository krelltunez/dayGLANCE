import WebSocket from "ws";
import {
  PROTOCOL_VERSION,
  MSG_DAY_STATE,
  MSG_DAY_FOCUS_START,
  MSG_DAY_FOCUS_TIMER_START,
  MSG_DAY_FOCUS_STOP,
  MSG_DAY_FOCUS_SKIP,
  MSG_DAY_FOCUS_SET_DURATION,
  MSG_DAY_FOCUS_DISMISS_STATS,
  MSG_DAY_HG_START,
  MSG_DAY_HG_TIMER_START,
  MSG_DAY_HG_STOP,
  MSG_DAY_HG_SKIP,
  MSG_DAY_HG_SET_DURATION,
  MSG_DAY_HG_COMPLETE,
  MSG_DAY_HG_TASK_COMPLETE,
  MSG_DAY_TASK_COMPLETE,
  MSG_DAY_HABIT_INCREMENT,
  MSG_DAY_ROUTINE_COMPLETE,
  type DayGlanceState,
  type InboundCommand,
} from "../../electron/protocol";

// Re-export everything action files need — keeps their imports pointing at ../client only
export type { DayGlanceState, Task, FocusState, HGState, HGScheduledSession, HGActiveSession } from "../../electron/protocol";
export {
  MSG_DAY_FOCUS_START, MSG_DAY_FOCUS_TIMER_START, MSG_DAY_FOCUS_STOP, MSG_DAY_FOCUS_SKIP,
  MSG_DAY_FOCUS_SET_DURATION, MSG_DAY_FOCUS_DISMISS_STATS,
  MSG_DAY_HG_START, MSG_DAY_HG_TIMER_START, MSG_DAY_HG_STOP, MSG_DAY_HG_SKIP,
  MSG_DAY_HG_SET_DURATION, MSG_DAY_HG_COMPLETE, MSG_DAY_HG_TASK_COMPLETE,
  MSG_DAY_TASK_COMPLETE, MSG_DAY_HABIT_INCREMENT, MSG_DAY_ROUTINE_COMPLETE,
} from "../../electron/protocol";

// CommandPayload is the caller-facing API — send() stamps v internally
type CommandPayload =
  | { type: typeof MSG_DAY_FOCUS_START }
  | { type: typeof MSG_DAY_FOCUS_TIMER_START }
  | { type: typeof MSG_DAY_FOCUS_STOP }
  | { type: typeof MSG_DAY_FOCUS_SKIP }
  | { type: typeof MSG_DAY_FOCUS_SET_DURATION; workMinutes?: number; breakMinutes?: number; longBreakMinutes?: number }
  | { type: typeof MSG_DAY_FOCUS_DISMISS_STATS }
  | { type: typeof MSG_DAY_HG_START; projectId: string; date: string }
  | { type: typeof MSG_DAY_HG_TIMER_START }
  | { type: typeof MSG_DAY_HG_STOP }
  | { type: typeof MSG_DAY_HG_SKIP }
  | { type: typeof MSG_DAY_HG_SET_DURATION; workMinutes?: number; breakMinutes?: number; longBreakMinutes?: number }
  | { type: typeof MSG_DAY_HG_COMPLETE }
  | { type: typeof MSG_DAY_HG_TASK_COMPLETE; id: string }
  | { type: typeof MSG_DAY_TASK_COMPLETE; id: string }
  | { type: typeof MSG_DAY_HABIT_INCREMENT; id: string }
  | { type: typeof MSG_DAY_ROUTINE_COMPLETE; id: string };

type StateListener = (state: DayGlanceState) => void;

const WS_URL = "ws://localhost:7892";
const RETRY_MS = 3000;

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastState: DayGlanceState | null = null;
const listeners = new Set<StateListener>();

function connect(): void {
  clearTimeout(retryTimer);
  console.log("[dayGLANCE] connecting to", WS_URL);
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("[dayGLANCE] WS connected");
  });

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === MSG_DAY_STATE) {
        lastState = msg as DayGlanceState;
        for (const listener of listeners) listener(lastState);
      }
    } catch {
      // drop malformed frames
    }
  });

  ws.on("close", () => {
    console.log("[dayGLANCE] WS closed, retrying in", RETRY_MS, "ms");
    retryTimer = setTimeout(connect, RETRY_MS);
  });

  ws.on("error", () => {
    // "close" fires after "error" — retry is handled there
  });
}

export function send(command: CommandPayload): void {
  if (ws?.readyState === WebSocket.OPEN) {
    const wire: InboundCommand = { v: PROTOCOL_VERSION, ...command } as InboundCommand;
    ws.send(JSON.stringify(wire));
  }
}

/** Subscribe to state updates. Returns an unsubscribe function.
 *  Immediately invokes listener with the last known state if available. */
export function onState(listener: StateListener): () => void {
  listeners.add(listener);
  if (lastState) listener(lastState);
  return () => listeners.delete(listener);
}

connect();
