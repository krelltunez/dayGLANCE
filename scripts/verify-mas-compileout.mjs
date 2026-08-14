// §7 compile-out verification, against the BUILT artifact (never the source).
// Asserts the Claude Desktop setup path is structurally absent from a MAS
// build and present in a direct build.
//
// Usage:
//   node scripts/verify-mas-compileout.mjs --mas   <path to dayGLANCE.app>
//   node scripts/verify-mas-compileout.mjs --direct <path to dayGLANCE.app>
//
// For the MAS .pkg, expand first:
//   pkgutil --expand-full dist-app/dayGLANCE-<ver>.pkg /tmp/pkg
//   node scripts/verify-mas-compileout.mjs --mas /tmp/pkg/<...>/dayGLANCE.app
//
// Checks, per mode:
//   MAS:    dist-electron/mcpDesktopSetup.js and mcpDesktopConfig.js absent
//           from app.asar; the setup button string absent from the renderer
//           assets inside app.asar; no Resources/mcp-bridge directory.
//   direct: all three present.
//
// The button string is asserted against the built renderer bundle, so this
// catches a broken __MAS_BUILD__ define wiring even when the asar filters
// work: the requirement is an artifact property, not a config property.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const [mode, appPath] = process.argv.slice(2);
if (!['--mas', '--direct'].includes(mode) || !appPath) {
  console.error('usage: node scripts/verify-mas-compileout.mjs --mas|--direct <path to dayGLANCE.app or resources dir>');
  process.exit(2);
}
const expectPresent = mode === '--direct';

// Accept the .app bundle (macOS), or a resources directory directly
// (Windows/Linux layouts, where resources/ sits beside the executable).
const resourcesDir = existsSync(join(appPath, 'Contents', 'Resources'))
  ? join(appPath, 'Contents', 'Resources')
  : appPath;
const asarPath = join(resourcesDir, 'app.asar');
if (!existsSync(asarPath)) {
  console.error(`no app.asar at ${asarPath}. Pass the .app bundle or its resources directory.`);
  process.exit(2);
}

const asarList = execFileSync('npx', ['asar', 'list', asarPath], { encoding: 'utf-8' });

const problems = [];
const check = (name, present) => {
  const okay = present === expectPresent;
  console.log(`${okay ? 'OK  ' : 'FAIL'} ${name}: ${present ? 'present' : 'absent'} (expected ${expectPresent ? 'present' : 'absent'})`);
  if (!okay) problems.push(name);
};

check('dist-electron/mcpDesktopSetup.js in app.asar', asarList.includes('/dist-electron/mcpDesktopSetup.js'));
check('dist-electron/mcpDesktopConfig.js in app.asar', asarList.includes('/dist-electron/mcpDesktopConfig.js'));
check('Resources/mcp-bridge bundled bridge', existsSync(join(resourcesDir, 'mcp-bridge', 'bridge.js')));

// Bloat guard, both modes: no source or project directory may ever reach the
// asar. electron-builder 26 prepends '**/*' to a matcher containing only
// negations (see electron-builder.config.cjs), which once packaged the whole
// repo — sources, docs, session config — into a MAS candidate. The four §7
// checks above would all pass on a direct build with this regression, so it
// gets its own unconditional assertion.
for (const dir of ['electron', 'docs', '.claude', 'dayglance-ios']) {
  const present = asarList.split('\n').some((l) => l.startsWith(`/${dir}/`));
  console.log(`${present ? 'FAIL' : 'OK  '} project dir /${dir} in app.asar: ${present ? 'present' : 'absent'} (expected absent)`);
  if (present) problems.push(`/${dir} in app.asar`);
}

// The renderer bundle: grep the whole asar blob for the button's user-facing
// string. Grepping the container is crude but exactly right here: if the
// bytes are anywhere in the artifact, the path is not compiled out.
const marker = 'Set up Claude Desktop';
let markerFound = false;
try {
  execFileSync('grep', ['-q', marker, asarPath]);
  markerFound = true;
} catch { /* grep exits 1 when absent */ }
check(`renderer marker string "${marker}"`, markerFound);

if (problems.length > 0) {
  console.error(`\n${mode === '--mas' ? 'MAS' : 'Direct'} artifact FAILED §7 verification: ${problems.join(', ')}`);
  process.exit(1);
}
console.log(`\n${mode === '--mas' ? 'MAS' : 'Direct'} artifact passes §7 verification.`);
