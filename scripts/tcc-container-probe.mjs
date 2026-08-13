#!/usr/bin/env node
// TCC container-protection probe — the Phase 0.5 experiment script
// (docs/mcp-server-spec.md §10, Phase 0.5; background in §3.4).
//
// THE QUESTION IT ANSWERS: on macOS 15+, can an outside process read the MAS
// build's discovery file inside dayGLANCE's app container, and when TCC
// container protection intervenes, which app does the consent prompt name?
// The prompt is attributed to the RESPONSIBLE PROCESS, so the same read must
// be tried from several launch contexts. This one script serves all of them.
//
// PREREQ (spec §10 Phase 0.5 step 1): a mas-dev build of dayGLANCE launched
// once, so ~/Library/Containers/com.dayglance exists, with a test mcp.json
// placed at the §3.4 path inside it. dayGLANCE itself writes one when the MCP
// server is enabled; for a pure path test any JSON works.
//
// RUN CONTEXT 1 — Claude Desktop (the case that matters: the responsible
// process is Claude Desktop, exactly the chain the real bridge would have).
// Add to ~/Library/Application Support/Claude/claude_desktop_config.json:
//
//   {
//     "mcpServers": {
//       "dayglance-container-probe": {
//         "command": "/usr/local/bin/node",        // absolute path (`which node`)
//         "args": ["/ABSOLUTE/PATH/TO/dayGLANCE/scripts/tcc-container-probe.mjs"]
//       }
//     }
//   }
//
// Restart Claude Desktop. The probe runs ONCE at spawn (before any consent
// can be granted mid-session, the interesting moment) and logs to stderr,
// which Claude Desktop writes to ~/Library/Logs/Claude/mcp-server-dayglance-
// container-probe.log. It then stays up as a minimal MCP server exposing one
// tool, probe_container_read, so Allow/Deny retests are one chat message
// ("call probe_container_read") instead of an app restart.
//
// RUN CONTEXT 2 — Terminal (responsible process: Terminal.app):
//
//   node scripts/tcc-container-probe.mjs --once
//
// RUN CONTEXT 3 — a second GUI app, to confirm attribution follows the
// responsible process: add the same stdio entry to any other MCP host you
// have (Cursor, VS Code), or wrap the --once command in a minimal Automator
// "Application" and double-click it.
//
// OBSERVE, per spec §10 Phase 0.5 steps 3-5:
//   - whether a consent prompt appears at all, and its exact wording
//   - WHICH app the prompt names (the responsible process, not node)
//   - Allow  → the read succeeds (ok: true below)
//   - Deny   → the specific error code (expected EPERM; denial is sticky)
//   - where the toggle lands in System Settings (Privacy & Security →
//     Files & Folders? App Management? note the exact pane)
//   - macOS 14 baseline: no prompt, read succeeds
//
// The probe output is findings-ready JSON. ENOENT at any ancestor means a
// setup gap (container or file missing), not a TCC denial: fix the prereq
// and rerun. EPERM with every ancestor present is the TCC (or sandbox
// container-protection) denial the experiment is looking for.
//
// Dependency-free BY DESIGN: Claude Desktop spawns a bare `node` with no
// node_modules in reach, so the stdio side speaks newline-delimited JSON-RPC
// by hand instead of importing the SDK.

import { readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

// The §3.4 MAS container discovery path: container-home shape per
// icloud.ts:31-33, userData pin per main.ts:37, bundle id com.dayglance
// (the MAS identity — the direct-download build uses com.dayglance.app and
// an unprotected path outside any container).
const DEFAULT_TARGET = join(
  homedir(),
  'Library', 'Containers', 'com.dayglance',
  'Data', 'Library', 'Application Support', 'dayGLANCE', 'mcp.json',
);

const args = process.argv.slice(2);
const pathArg = args.find((a) => !a.startsWith('--'));
const TARGET = pathArg ?? DEFAULT_TARGET;
// --once forces single-shot; --serve forces server mode; default: a TTY on
// stdin means a human at a shell (single-shot), a pipe means an MCP host.
const ONCE = args.includes('--once') || (!args.includes('--serve') && process.stdin.isTTY);

function macosVersion() {
  try {
    return execSync('sw_vers -productVersion', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown (not macOS?)';
  }
}

/** Never echo credentials into logs and findings docs: mask long values. */
function maskSecrets(text) {
  try {
    const parsed = JSON.parse(text);
    const mask = (v) => (typeof v === 'string' && v.length > 12
      ? `${v.slice(0, 4)}…${v.slice(-4)} (${v.length} chars)`
      : v);
    for (const k of Object.keys(parsed)) parsed[k] = mask(parsed[k]);
    return { parsed: true, value: parsed };
  } catch {
    return { parsed: false, preview: text.slice(0, 120) };
  }
}

/**
 * One probe: stat every ancestor (to localize WHERE access dies — a missing
 * container is a setup gap, a denied one is the finding), then read the file.
 */
function probe() {
  const result = {
    at: new Date().toISOString(),
    macos: macosVersion(),
    node: process.version,
    // The spawning chain decides TCC attribution; record what this end can see.
    ppid: process.ppid,
    target: TARGET,
    ancestors: [],
  };

  const parts = TARGET.split('/').filter(Boolean);
  // Start probing at ~/Library/Containers/<bundle-id> (or the override
  // path's 4th component): shallower ancestors never carry container TCC.
  for (let depth = 4; depth <= parts.length; depth++) {
    const p = '/' + parts.slice(0, depth).join('/');
    try {
      const st = statSync(p);
      result.ancestors.push({ path: p, exists: true, kind: st.isDirectory() ? 'dir' : 'file' });
    } catch (err) {
      result.ancestors.push({ path: p, error: err.code ?? String(err), errno: err.errno });
      break; // deeper stats add nothing once one level fails
    }
  }

  try {
    const text = readFileSync(TARGET, 'utf-8');
    result.ok = true;
    result.bytes = Buffer.byteLength(text);
    result.content = maskSecrets(text);
    result.meaning = 'Read SUCCEEDED. Either no TCC protection applies (macOS 14 baseline), consent was already granted, or this process is exempt.';
  } catch (err) {
    result.ok = false;
    result.error = { code: err.code, errno: err.errno, message: err.message };
    result.meaning = err.code === 'ENOENT'
      ? 'Path missing, NOT a TCC denial: launch the mas-dev build once and place mcp.json (spec §10 Phase 0.5 step 1).'
      : err.code === 'EPERM'
        ? 'Operation not permitted with the path present: this is the TCC container-protection denial (or a sticky earlier Deny). Note which app the prompt named, if one appeared.'
        : `Unexpected code ${err.code}: record it verbatim in the findings.`;
  }
  return result;
}

// ── single-shot mode (Terminal / second GUI app wrapper) ────────────────────
if (ONCE) {
  console.log(JSON.stringify(probe(), null, 2));
  process.exit(0);
}

// ── MCP stdio server mode (Claude Desktop) ──────────────────────────────────
// Probe IMMEDIATELY at spawn: the first read after a fresh install is the
// moment the consent prompt fires, and it must happen under this process
// chain, not lazily after the user has already clicked around.
const startupResult = probe();
console.error(`[container-probe] startup probe: ${JSON.stringify(startupResult)}`);

const TOOL = {
  name: 'probe_container_read',
  description:
    "Re-read dayGLANCE's MAS container discovery file and report contents or the exact error code. " +
    'Use after changing the consent state (Allow/Deny, System Settings toggle) to observe the new behavior.',
  inputSchema: { type: 'object', properties: {} },
};

const respond = (id, result) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
};
const respondError = (id, code, message) => {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
};

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // not ours to diagnose; skip malformed lines
    }
    const { id, method, params } = msg;
    if (id === undefined) continue; // notifications (e.g. notifications/initialized) need no reply
    switch (method) {
      case 'initialize':
        respond(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'dayglance-container-probe', version: '1.0.0' },
        });
        break;
      case 'ping':
        respond(id, {});
        break;
      case 'tools/list':
        respond(id, { tools: [TOOL] });
        break;
      case 'tools/call': {
        if (params?.name !== TOOL.name) {
          respondError(id, -32602, `Unknown tool ${JSON.stringify(params?.name)}`);
          break;
        }
        const r = probe();
        console.error(`[container-probe] tool probe: ${JSON.stringify(r)}`);
        respond(id, { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] });
        break;
      }
      default:
        respondError(id, -32601, `Method not found: ${method}`);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
