import { WebSocketServer, WebSocket } from 'ws';
import { BrowserWindow, ipcMain } from 'electron';
import type { OutboundMessage } from './protocol.js';

const WS_PORT = 7892;

// Accepts a getter so commands are always routed to the current main window,
// even if it was closed and recreated after startup (possible when the tray
// keeps the process alive).
export function createWsServer(getMainWindow: () => BrowserWindow | null): WebSocketServer {
  // Bind to loopback only — never reachable from the network.
  const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });
  const clients = new Set<WebSocket>();
  let lastState: string | null = null;

  wss.on('connection', (ws, req) => {
    // Browser-initiated WebSocket connections always include an Origin header;
    // native clients (e.g. the Stream Deck plugin) do not. Reject browser
    // connections to prevent any web page from reaching this server.
    if (req.headers['origin']) {
      ws.terminate();
      return;
    }

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

  console.log(`[dayGLANCE] Local API listening on ws://localhost:${WS_PORT}`);
  return wss;
}
