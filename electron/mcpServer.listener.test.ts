// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { generateMcpToken } from '@glance-apps/mcp-host';
import { startMcpServer } from './mcpServer.js';

// What dayGLANCE asks of the host kit's listener (#2280 step 1): loopback,
// the SDK's localhost Host and Origin guards (no allowlist of its own), its
// realm in the 401, and the log lines it wrote before the listener moved to
// @glance-apps/mcp-host. The guards themselves are tested in
// packages/mcp-host/test/listener.test.js; the tool surface in
// mcpServer.transport.test.ts.

const TOKEN = generateMcpToken();

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function post(port: number, host: string): Promise<{ status: number; challenge: string | undefined }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host, 'content-type': 'application/json' } },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, challenge: res.headers['www-authenticate'] }));
      },
    );
    req.on('error', reject);
    req.end('{}');
  });
}

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
});

describe('the dayGLANCE listener on the host kit', () => {
  it('binds loopback, logs as before, and keeps the localhost Host guard', async () => {
    const port = await freePort();
    const logs: string[] = [];
    const srv = startMcpServer({ token: TOKEN, portOverride: port, log: (m) => logs.push(m), logError: () => {} });
    if (!srv) throw new Error('listener refused to start');
    servers.push(srv);
    await new Promise<void>((resolve) => srv.once('listening', () => resolve()));

    expect((srv.address() as net.AddressInfo).address).toBe('127.0.0.1');
    expect(logs).toEqual([`[dayGLANCE] MCP server listening on http://127.0.0.1:${port}/mcp`]);

    const local = await post(port, `127.0.0.1:${port}`);
    expect(local.status).toBe(401);
    expect(local.challenge).toBe('Bearer realm="dayGLANCE MCP"');
    expect((await post(port, `localhost:${port}`)).status).toBe(401);
    // A name is refused by the Host guard: dayGLANCE configures no allowlist.
    expect((await post(port, `mybox.lan:${port}`)).status).toBe(403);
  });

  it('refuses with the same log lines as before', async () => {
    const errors: string[] = [];
    const port = await freePort();
    expect(startMcpServer({ token: '', portOverride: port, log: () => {}, logError: (m) => errors.push(m) })).toBeNull();
    expect(startMcpServer({ token: TOKEN, portOverride: 'x', log: () => {}, logError: (m) => errors.push(m) })).toBeNull();
    expect(errors).toEqual([
      '[dayGLANCE] MCP server not started: no bearer token configured (refusing to listen unauthenticated).',
      '[dayGLANCE] MCP server not started: Invalid MCP port override: "x"',
    ]);
  });

  it('logs a collision with the dayGLANCE no-scan message', async () => {
    const port = await freePort();
    const first = startMcpServer({ token: TOKEN, portOverride: port, log: () => {}, logError: () => {} });
    if (!first) throw new Error('listener refused to start');
    servers.push(first);
    await new Promise<void>((resolve) => first.once('listening', () => resolve()));

    const errors: string[] = [];
    const second = startMcpServer({ token: TOKEN, portOverride: port, log: () => {}, logError: (m) => errors.push(m) });
    if (!second) throw new Error('listener refused to start');
    servers.push(second);
    await new Promise<void>((resolve) => second.once('error', () => resolve()));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(errors).toEqual([
      `[dayGLANCE] MCP server could not start: port ${port} is already in use by another process. ` +
      'Pick a different port explicitly; dayGLANCE will not scan for a free one, because configured MCP clients point at a fixed port.',
    ]);
  });
});
