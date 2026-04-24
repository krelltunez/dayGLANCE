import WebSocket from "ws";

export type Task = {
  id: string;
  title: string;
  startTime: string | null;
  duration: number;
  colorHex: string;
  tags: string[];
};

export type FocusState = {
  active: boolean;
  phase: string;
  secondsRemaining: number;
  running: boolean;
  workMinutes: number;
  breakMinutes: number;
};

export type DayGlanceState = {
  currentTask: Task | null;
  nextTask: Task | null;
  today: { total: number; completed: number; date: string };
  focus: FocusState;
};

export type Command =
  | { type: "focus:start" }
  | { type: "focus:stop" }
  | { type: "focus:skip" }
  | { type: "task:complete"; id: string };

type StateListener = (state: DayGlanceState) => void;

const WS_URL = "ws://localhost:7892";
const RETRY_MS = 3000;

let ws: WebSocket | null = null;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let lastState: DayGlanceState | null = null;
const listeners = new Set<StateListener>();

function connect(): void {
  clearTimeout(retryTimer);
  ws = new WebSocket(WS_URL);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "state") {
        lastState = msg as DayGlanceState;
        for (const listener of listeners) listener(lastState);
      }
    } catch {
      // drop malformed frames
    }
  });

  ws.on("close", () => {
    retryTimer = setTimeout(connect, RETRY_MS);
  });

  ws.on("error", () => {
    // "close" fires after "error" — retry is handled there
  });
}

export function send(command: Command): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(command));
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
