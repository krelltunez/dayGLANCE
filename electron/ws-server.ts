import { WebSocketServer, WebSocket } from 'ws';
import { BrowserWindow, ipcMain } from 'electron';
import { randomBytes } from 'node:crypto';
import { MSG_DAY_TOKEN, MSG_DAY_AUTH, PROTOCOL_VERSION } from './protocol.js';
import type { OutboundMessage } from './protocol.js';

const WS_PORT = 7892;

// A browser client (property inspector) that fails to present a valid token this
// quickly is dropped — closes the "connect and sit idle to hold a slot" vector.
const AUTH_TIMEOUT_MS = 5000;

// Accepts a getter so commands are always routed to the current main window,
// even if it was closed and recreated after startup (possible when the tray
// keeps the process alive).
export function createWsServer(getMainWindow: () => BrowserWindow | null): WebSocketServer {
  // Bind to loopback only — never reachable from the network.
  const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });
  const clients = new Set<WebSocket>();
  // Session tokens currently valid for browser (property-inspector) auth. Each
  // Origin-less native client is issued one on connect and it is revoked when
  // that client disconnects, so a token only works while its issuer is alive.
  const validTokens = new Set<string>();
  let lastState: string | null = null;

  // A fixed-port WebSocketServer with no 'error' handler turns EADDRINUSE (port
  // 7892 already taken by another process/instance) into an uncaught exception
  // that crashes the whole app at startup. Log and carry on without the local
  // API instead — the rest of the app does not depend on it.
  wss.on('error', (err) => {
    console.error('[dayGLANCE] Local API unavailable (WebSocket server error):', err);
  });

  wss.on('listening', () => {
    console.log(`[dayGLANCE] Local API listening on ws://localhost:${WS_PORT}`);
  });

  // Fully register a trusted socket: start streaming state and accept commands.
  const registerClient = (ws: WebSocket): void => {
    clients.add(ws);
    if (lastState) {
      ws.send(lastState);
    } else {
      // Renderer hasn't pushed yet — ask it to send current state now.
      getMainWindow()?.webContents.send('ws:request-state');
    }

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        getMainWindow()?.webContents.send('ws:command', msg);
      } catch {
        // drop malformed frames
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  };

  wss.on('connection', (ws, req) => {
    const origin = req.headers['origin'];

    if (!origin) {
      // No Origin header — a native/Node client (the Stream Deck plugin backend,
      // curl, etc.). Browsers ALWAYS send an Origin on a WebSocket handshake, so
      // a drive-by web page can never reach this branch. Trust it, and issue a
      // session token it can relay to its (browser-based) property inspector.
      const token = randomBytes(32).toString('hex');
      validTokens.add(token);
      ws.on('close', () => validTokens.delete(token));
      registerClient(ws);
      ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: MSG_DAY_TOKEN, token }));
      return;
    }

    // Origin header present — a browser client. This includes both a malicious
    // page (whose sandboxed iframe serializes its opaque origin to the string
    // "null") and the legitimate Stream Deck property inspector webview. We can't
    // tell them apart by Origin, so we trust NEITHER on Origin alone: the client
    // must present a valid session token as its first frame before we register it
    // or send it any state. No token, wrong token, or silence → terminated.
    const authTimer = setTimeout(() => ws.terminate(), AUTH_TIMEOUT_MS);
    ws.once('message', (raw) => {
      clearTimeout(authTimer);
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.type === MSG_DAY_AUTH && typeof msg.token === 'string' && validTokens.has(msg.token)) {
          registerClient(ws);
          return;
        }
      } catch {
        // fall through to terminate
      }
      ws.terminate();
    });
    // Swallow errors while unauthenticated so a mid-handshake reset can't throw.
    ws.on('error', () => { /* handled once registered */ });
  });

  // Broadcast state updates from the renderer to all connected clients
  ipcMain.on('ws:push-state', (_event, state: OutboundMessage) => {
    const payload = JSON.stringify(state);
    lastState = payload;
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  return wss;
}
