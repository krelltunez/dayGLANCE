#!/usr/bin/env node
/**
 * AST-based audit for undefined references in extracted components.
 *
 * Parses each JSX file, walks the AST, and reports any Identifier or
 * JSXIdentifier that is referenced but never declared in the current
 * scope (import, destructuring, function param, local const/let/var,
 * or standard JS/React globals).
 *
 * Usage:
 *   node scripts/audit-undefined-refs.mjs [file1.jsx file2.jsx ...]
 *
 * If no files are given, audits all 8 Phase 9b extracted components.
 */

import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// babel traverse default export interop
const traverse = _traverse.default || _traverse;

// ── Globals that are always available ────────────────────────────────
const JS_GLOBALS = new Set([
  // Values & constructors
  'undefined', 'null', 'NaN', 'Infinity', 'globalThis',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect',
  'Date', 'RegExp', 'Error', 'TypeError', 'RangeError', 'SyntaxError',
  'JSON', 'Math', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
  'Intl', 'ArrayBuffer', 'DataView', 'Float32Array', 'Float64Array',
  'Int8Array', 'Int16Array', 'Int32Array', 'Uint8Array', 'Uint16Array',
  'Uint32Array',
  // Timers & scheduling
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
  // DOM / Browser
  'window', 'document', 'navigator', 'location', 'history',
  'console', 'alert', 'confirm', 'prompt', 'fetch', 'URL',
  'HTMLElement', 'Event', 'CustomEvent', 'MutationObserver',
  'ResizeObserver', 'IntersectionObserver', 'AbortController',
  'FormData', 'Headers', 'Request', 'Response', 'Blob', 'File',
  'FileReader', 'WebSocket', 'Worker', 'SharedWorker',
  'getComputedStyle', 'matchMedia', 'visualViewport',
  // React (imported but treat as always-available since React is in scope)
  'React', 'Fragment',
  // Common patterns that aren't real references
  'module', 'exports', 'require', 'process', '__dirname', '__filename',
]);

// ── Default files to audit ───────────────────────────────────────────
const DEFAULT_FILES = [
  'src/components/GlanceSidebar.jsx',
  'src/components/InboxSidebar.jsx',
  'src/components/CalendarHeader.jsx',
  'src/components/TimeGrid.jsx',
  'src/components/MobileTimeGrid.jsx',
  'src/components/MobileAllDaySection.jsx',
  'src/components/MobileBottomSheets.jsx',
  'src/components/MobileGlanceSection.jsx',
];

// ── Parse & audit one file ───────────────────────────────────────────
function auditFile(filePath) {
  const code = readFileSync(filePath, 'utf-8');
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['jsx', 'optionalChaining', 'nullishCoalescingOperator'],
  });

  const issues = [];

  traverse(ast, {
    // Check every identifier reference
    ReferencedIdentifier(path) {
      const { name } = path.node;

      // Skip globals
      if (JS_GLOBALS.has(name)) return;

      // Skip if it's bound in scope (import, param, local declaration, etc.)
      if (path.scope.hasBinding(name)) return;

      // Skip JSX element names that are lowercase (HTML elements)
      if (path.parent.type === 'JSXOpeningElement' && /^[a-z]/.test(name)) return;

      // Skip property access (obj.prop — we only care about the root `obj`)
      if (path.parent.type === 'MemberExpression' && path.parent.property === path.node && !path.parent.computed) return;

      // Skip object property keys in { key: value } patterns
      if (path.parent.type === 'ObjectProperty' && path.parent.key === path.node && !path.parent.computed) return;

      // Skip JSX attribute names (<div className=...> — className is not a variable)
      if (path.parent.type === 'JSXAttribute') return;

      // Record the issue
      issues.push({
        name,
        line: path.node.loc.start.line,
        col: path.node.loc.start.column,
      });
    },

    // Also check JSX element references (component names like <Foo />)
    JSXIdentifier(path) {
      const { name } = path.node;

      // Only check opening elements (not closing, not attributes)
      if (path.parent.type !== 'JSXOpeningElement' && path.parent.type !== 'JSXMemberExpression') return;

      // Skip lowercase (HTML elements)
      if (/^[a-z]/.test(name)) return;

      // Skip React and Fragment
      if (JS_GLOBALS.has(name)) return;

      // Check if it's in scope
      if (path.scope.hasBinding(name)) return;

      issues.push({
        name,
        line: path.node.loc.start.line,
        col: path.node.loc.start.column,
        jsx: true,
      });
    },
  });

  // Deduplicate by name (report each missing identifier once with first occurrence)
  const seen = new Map();
  for (const issue of issues) {
    if (!seen.has(issue.name)) {
      seen.set(issue.name, { ...issue, count: 1 });
    } else {
      seen.get(issue.name).count++;
    }
  }

  return [...seen.values()];
}

// ── Main ─────────────────────────────────────────────────────────────
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : DEFAULT_FILES;

const root = resolve(process.cwd());
let totalIssues = 0;

for (const file of files) {
  const fullPath = resolve(root, file);
  const shortName = file.replace(/^src\/components\//, '');

  try {
    const issues = auditFile(fullPath);
    if (issues.length > 0) {
      console.log(`\n=== ${shortName} ===`);
      for (const { name, line, col, count, jsx } of issues) {
        const tag = jsx ? ' (JSX component)' : '';
        console.log(`  ${name}${tag} — line ${line}:${col} (${count} ref${count > 1 ? 's' : ''})`);
      }
      totalIssues += issues.length;
    }
  } catch (err) {
    console.error(`\nERROR parsing ${shortName}: ${err.message}`);
  }
}

if (totalIssues === 0) {
  console.log('\n✅ All files clean — no undefined references found.');
} else {
  console.log(`\n❌ Found ${totalIssues} undefined identifier(s) across ${files.length} file(s).`);
}
