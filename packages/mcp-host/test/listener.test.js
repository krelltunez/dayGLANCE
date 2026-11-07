// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
  startMcpListener,
  isLoopbackAddress,
  normalizeAllowlist,
  generateMcpToken,
  LOCALHOST_NAMES,
  DEFAULT_MCP_PATH,
} from '../src/index.js';

// The listener on a real socket. What it pins: the guard order (path → Host →
// Origin → token), the SDK's localhost guards as the default, a configured
// Host/Origin allowlist for a host reached by name, one indistinguishable 401
// with the host's realm, a fresh McpServer per request (§3.7), and every
// refusal to start: no token on any bind (with its own message on a
// non-loopback one), a malformed allowlist, a bad port.

const TOKEN = generateMcpToken();
const quiet = () => {};

/** The OS picks a free port; the listener refuses port 0 by design, so we hand it the number. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

let built = 0;
function createServer() {
  built += 1;
  const server = new McpServer({ name: 'TestApp', version: '0.0.0' });
  server.registerTool('ping', { description: 'ping' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
  return server;
}

const running = [];
async function start(opts = {}) {
  const port = await freePort();
  const srv = startMcpListener({ name: 'TestApp', createServer, token: TOKEN, portOverride: port, defaultPort: 1, log: quiet, logError: quiet, ...opts });
  if (!srv) throw new Error('listener refused to start');
  running.push(srv);
  await new Promise((resolve, reject) => {
    srv.once('listening', resolve);
    srv.once('error', reject);
  });
  return { srv, port };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => new Promise((resolve) => s.close(() => resolve()))));
});

/**
 * One raw request with a chosen Host header (fetch will not let a caller set
 * Host). Returns the status, headers and body text.
 */
function raw(port, { path = '/mcp', host, origin, token, method = 'POST' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      host: host ?? `127.0.0.1:${port}`,
    };
    if (origin !== undefined) headers.origin = origin;
    if (token !== undefined) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

describe('the default guards are the SDK localhost ones, exactly', () => {
  // Its own server, outside `running`, which afterEach empties.
  let port;
  let srv;
  beforeAll(async () => {
    port = await freePort();
    srv = startMcpListener({ name: 'TestApp', createServer, token: TOKEN, portOverride: port, defaultPort: 1, log: quiet, logError: quiet });
    await new Promise((resolve) => srv.once('listening', resolve));
  });
  afterAll(() => new Promise((resolve) => srv.close(() => resolve())));

  it('localhost names pass the Host guard (and stop at the token)', async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, 'LOCALHOST']) {
      expect((await raw(port, { host })).status, host).toBe(401);
    }
  });

  it('any other Host is refused before the token is looked at', async () => {
    for (const host of [`mybox.lan:${port}`, 'evil.example', `192.168.1.10:${port}`]) {
      const res = await raw(port, { host, token: TOKEN });
      expect(res.status, host).toBe(403);
      expect(res.body).toContain('Invalid Host');
    }
  });

  it('a localhost Origin passes, a web Origin is refused, no Origin passes', async () => {
    expect((await raw(port, { origin: 'http://localhost:5173' })).status).toBe(401);
    expect((await raw(port, { origin: 'https://evil.example', token: TOKEN })).status).toBe(403);
    expect((await raw(port, {})).status).toBe(401);
  });
});

describe('guard order: path → Host → Origin → token', () => {
  it('each guard answers before the next one runs', async () => {
    const { port } = await start();
    // Wrong path wins over everything, even a bad Host.
    expect((await raw(port, { path: '/', host: 'evil.example' })).status).toBe(404);
    expect((await raw(port, { path: '/mcp/extra' })).status).toBe(404);
    // Bad Host wins over a bad Origin and a missing token.
    const badHost = await raw(port, { host: 'evil.example', origin: 'https://evil.example' });
    expect(badHost.status).toBe(403);
    expect(badHost.body).toContain('Invalid Host');
    // Good Host, bad Origin: the Origin guard, still before the token.
    const badOrigin = await raw(port, { origin: 'https://evil.example' });
    expect(badOrigin.status).toBe(403);
    expect(badOrigin.body).toContain('Invalid Origin');
    // Good Host and Origin, bad token: the one 401.
    expect((await raw(port, { token: 'nope' })).status).toBe(401);
  });

  it('a custom path replaces /mcp', async () => {
    const { port } = await start({ path: '/glance/mcp' });
    expect((await raw(port, { path: DEFAULT_MCP_PATH })).status).toBe(404);
    expect((await raw(port, { path: '/glance/mcp' })).status).toBe(401);
  });
});

describe('a host reached by name: configured allowlists', () => {
  it('allowedHosts replaces the localhost list (port-agnostic, case-folded)', async () => {
    const { port } = await start({ allowedHosts: ['mybox.lan', 'MCP.Example.com'] });
    expect((await raw(port, { host: `mybox.lan:${port}` })).status).toBe(401);
    expect((await raw(port, { host: 'mcp.example.com' })).status).toBe(401);
    expect((await raw(port, { host: 'MCP.EXAMPLE.COM:443' })).status).toBe(401);
    // Replaced, not extended: localhost is now refused.
    expect((await raw(port, { host: `127.0.0.1:${port}`, token: TOKEN })).status).toBe(403);
    expect((await raw(port, { host: 'other.lan', token: TOKEN })).status).toBe(403);
  });

  it('LOCALHOST_NAMES extends rather than replaces', async () => {
    const { port } = await start({ allowedHosts: [...LOCALHOST_NAMES, 'mybox.lan'] });
    expect((await raw(port, { host: `127.0.0.1:${port}` })).status).toBe(401);
    expect((await raw(port, { host: 'mybox.lan' })).status).toBe(401);
    expect((await raw(port, { host: 'evil.example' })).status).toBe(403);
  });

  it('allowedOrigins replaces the localhost Origin list; requests without an Origin still pass', async () => {
    const { port } = await start({ allowedOrigins: ['app.example', 'vscode-webview://*'] });
    expect((await raw(port, { origin: 'https://app.example' })).status).toBe(401);
    expect((await raw(port, { origin: 'vscode-webview://abc123' })).status).toBe(401);
    expect((await raw(port, { origin: 'http://localhost:5173', token: TOKEN })).status).toBe(403);
    expect((await raw(port, {})).status).toBe(401);
  });

  it('an empty Origin list refuses every browser origin and nothing else', async () => {
    const { port } = await start({ allowedOrigins: [] });
    expect((await raw(port, { origin: 'http://localhost:5173', token: TOKEN })).status).toBe(403);
    expect((await raw(port, {})).status).toBe(401);
  });
});

describe('the token', () => {
  it('one 401 with the host realm for every reason', async () => {
    const { port } = await start();
    const missing = await raw(port, {});
    const wrong = await raw(port, { token: 'nope' });
    for (const res of [missing, wrong]) {
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer realm="TestApp MCP"');
    }
    expect(missing.body).toBe(wrong.body);
  });

  it('a configured realm replaces the default', async () => {
    const { port } = await start({ realm: 'Home MCP' });
    expect((await raw(port, {})).headers['www-authenticate']).toBe('Bearer realm="Home MCP"');
  });

  it('a getter is read on every request: rotation locks out the old token at once, and empty fails closed', async () => {
    let current = TOKEN;
    const { port } = await start({ token: () => current });
    expect((await raw(port, { token: TOKEN })).status).not.toBe(401);
    current = generateMcpToken();
    expect((await raw(port, { token: TOKEN })).status).toBe(401);
    current = '';
    expect((await raw(port, { token: TOKEN })).status).toBe(401);
    expect((await raw(port, {})).status).toBe(401);
  });
});

describe('serving MCP', () => {
  it('the official client initializes and calls a tool; the server is built per request (§3.7)', async () => {
    const { port } = await start();
    built = 0;
    const client = new Client({ name: 'mcp-host-test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } });
    await client.connect(transport);
    const result = await client.callTool({ name: 'ping', arguments: {} });
    expect(result.content).toEqual([{ type: 'text', text: 'pong' }]);
    await client.callTool({ name: 'ping', arguments: {} });
    expect(built).toBeGreaterThanOrEqual(2);
    await client.close();
  });

  it('logs where it listens, and a bind failure loudly, with no other port tried', async () => {
    const { port } = await start();
    const logs = [];
    const errors = [];
    const second = startMcpListener({ name: 'TestApp', createServer, token: TOKEN, portOverride: port, defaultPort: 1, log: (m) => logs.push(m), logError: (m) => errors.push(m) });
    running.push(second);
    await new Promise((resolve) => second.once('error', resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(
      `[TestApp] MCP server could not start: port ${port} is already in use by another process. ` +
      'Pick a different port explicitly; TestApp will not scan for a free one, because configured MCP clients point at a fixed port.',
    );
    expect(logs).toEqual([]);

    const ok = [];
    const port2 = await freePort();
    const third = startMcpListener({ name: 'TestApp', createServer, token: TOKEN, portOverride: port2, defaultPort: 1, log: (m) => ok.push(m), logError: quiet });
    running.push(third);
    await new Promise((resolve) => third.once('listening', resolve));
    expect(ok).toEqual([`[TestApp] MCP server listening on http://127.0.0.1:${port2}/mcp`]);
  });
});

describe('refusals to start', () => {
  const attempt = (opts) => {
    const errors = [];
    const srv = startMcpListener({ name: 'TestApp', createServer, token: TOKEN, portOverride: 1, defaultPort: 1, log: quiet, logError: (m) => errors.push(m), ...opts });
    if (srv) running.push(srv);
    return { srv, errors };
  };

  it('no token on loopback: refused, loudly', () => {
    for (const token of ['', () => '']) {
      const { srv, errors } = attempt({ token });
      expect(srv).toBeNull();
      expect(errors).toEqual(['[TestApp] MCP server not started: no bearer token configured (refusing to listen unauthenticated).']);
    }
  });

  it('no token on a non-loopback bind: refused, naming the address', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'localhost', 'mybox.lan']) {
      const { srv, errors } = attempt({ token: '', host });
      expect(srv, host).toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('non-loopback bind address');
      expect(errors[0]).toContain(JSON.stringify(host));
      expect(errors[0]).toContain('refusing to listen unauthenticated on the network');
    }
  });

  it('a malformed or empty Host allowlist is refused rather than failing every request later', () => {
    for (const allowedHosts of [[], ['mybox:8080'], ['http://mybox'], ['*'], ['*.lan'], ['::1'], [''], [42], 'mybox.lan']) {
      const { srv, errors } = attempt({ allowedHosts });
      expect(srv, JSON.stringify(allowedHosts)).toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/^\[TestApp\] MCP server not started: /);
    }
  });

  it('an Origin allowlist may not let every web origin in', () => {
    for (const allowedOrigins of [['https://*'], ['http://*'], ['*'], ['https://app.example']]) {
      const { srv } = attempt({ allowedOrigins });
      expect(srv, JSON.stringify(allowedOrigins)).toBeNull();
    }
  });

  it('a bad port, bind address, path or realm is refused', () => {
    expect(attempt({ portOverride: 0 }).errors[0]).toContain('port 0');
    expect(attempt({ portOverride: undefined, defaultPort: 0 }).errors[0]).toContain('default MCP port');
    expect(attempt({ host: '' }).srv).toBeNull();
    expect(attempt({ path: 'mcp' }).srv).toBeNull();
    expect(attempt({ realm: 'a"b' }).srv).toBeNull();
  });

  it('missing name or createServer is a programming error, thrown', () => {
    expect(() => startMcpListener({ createServer, token: TOKEN, defaultPort: 1 })).toThrow(TypeError);
    expect(() => startMcpListener({ name: 'TestApp', token: TOKEN, defaultPort: 1 })).toThrow(TypeError);
  });
});

describe('a non-loopback bind with a token', () => {
  it('starts, logs the address, and still applies the guards', async () => {
    const logs = [];
    const { srv, port } = await start({ host: '0.0.0.0', log: (m) => logs.push(m) });
    expect(srv.address().address).toBe('0.0.0.0');
    expect(logs).toEqual([`[TestApp] MCP server listening on http://0.0.0.0:${port}/mcp`]);
    expect((await raw(port, {})).status).toBe(401);
    expect((await raw(port, { host: 'mybox.lan', token: TOKEN })).status).toBe(403);
  });
});

describe('isLoopbackAddress', () => {
  it('true only for loopback literals', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1']) expect(isLoopbackAddress(a), a).toBe(true);
    for (const a of ['0.0.0.0', '::', '192.168.1.10', '10.0.0.1', 'localhost', '[::1]', '::ffff:10.0.0.1', '', undefined, 127]) {
      expect(isLoopbackAddress(a), String(a)).toBe(false);
    }
  });
});

describe('normalizeAllowlist', () => {
  it('folds case and keeps bare hostnames, bracketed IPv6 and non-web scheme wildcards', () => {
    expect(normalizeAllowlist('Host', ['MyBox.LAN', '[::1]', ' 10.0.0.2 '])).toEqual({ ok: true, list: ['mybox.lan', '[::1]', '10.0.0.2'] });
    expect(normalizeAllowlist('Origin', ['vscode-webview://*'], { allowSchemeWildcards: true })).toEqual({ ok: true, list: ['vscode-webview://*'] });
    expect(normalizeAllowlist('Host', ['vscode-webview://*']).ok).toBe(false);
  });
});
