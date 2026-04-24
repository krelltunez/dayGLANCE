import { WebSocketServer, WebSocket } from 'ws';
import { BrowserWindow, ipcMain } from 'electron';

const WS_PORT = 7892;

export function createWsServer(win: BrowserWindow): WebSocketServer {
  const wss = new WebSocketServer({ port: WS_PORT });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        win.webContents.send('ws:command', msg);
      } catch {
        // drop malformed frames
      }
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Broadcast state updates from the renderer to all connected clients
  ipcMain.on('ws:push-state', (_event, state: unknown) => {
    const payload = JSON.stringify(state);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  console.log(`[dayGLANCE] Local API listening on ws://localhost:${WS_PORT}`);
  return wss;
}
