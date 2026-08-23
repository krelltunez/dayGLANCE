import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CI cannot compile the iOS app, so the one project-layout rule that silently
 * breaks Control Center is guarded here.
 *
 * `openAppWhenRun` foregrounds the app only if the control's `AppIntent` is a
 * member of BOTH the app target and the widget extension target. While
 * ControlWidgets.swift sat in DayGlanceWidget/ (extension-only per project.yml
 * `sources`), tapping a control did nothing whatsoever: the app never launched,
 * so nothing drained the pending action the intent had just written to the App
 * Group. Nothing catches that at build time, and no unit test on the JS side
 * can see it either, because the drain code is correct.
 *
 * The rule: the file must live in a directory listed under `sources` for both
 * targets. Shared/ is the only such directory.
 */
const IOS = join(dirname(fileURLToPath(import.meta.url)), '../dayglance-ios');

const APP_TARGET = 'DayGlance';
const WIDGET_TARGET = 'DayGlanceWidget';

/**
 * Minimal reader for the `targets.<name>.sources[].path` values in project.yml.
 * Deliberately dependency-free: js-yaml is only present transitively, and this
 * needs to read two nested keys, not parse arbitrary YAML.
 */
function sourcePathsByTarget(yaml) {
  const out = {};
  let target = null;
  let inSources = false;
  for (const line of yaml.split('\n')) {
    if (/^\S/.test(line)) { target = null; inSources = false; continue; }
    const targetMatch = line.match(/^ {2}([A-Za-z0-9_]+):\s*$/);
    if (targetMatch) {
      target = targetMatch[1];
      out[target] = out[target] ?? [];
      inSources = false;
      continue;
    }
    if (!target) continue;
    if (/^ {4}sources:\s*$/.test(line)) { inSources = true; continue; }
    // Any other key at the target's own nesting level closes the sources block.
    if (/^ {4}[A-Za-z0-9_]+:/.test(line)) { inSources = false; continue; }
    if (!inSources) continue;
    const pathMatch = line.match(/^ {6}- path:\s*(\S+)\s*$/);
    if (pathMatch) out[target].push(pathMatch[1]);
  }
  return out;
}

describe('iOS Control Center controls', () => {
  const sources = sourcePathsByTarget(readFileSync(join(IOS, 'project.yml'), 'utf8'));

  it('parses both targets out of project.yml', () => {
    expect(sources[APP_TARGET], 'app target sources').toBeDefined();
    expect(sources[WIDGET_TARGET], 'widget target sources').toBeDefined();
    expect(sources[APP_TARGET].length).toBeGreaterThan(0);
    expect(sources[WIDGET_TARGET].length).toBeGreaterThan(0);
  });

  it('ships ControlWidgets.swift from a directory both targets compile', () => {
    const shared = sources[APP_TARGET].filter((p) => sources[WIDGET_TARGET].includes(p));
    expect(shared, 'no directory is compiled into both targets').not.toEqual([]);

    const home = shared.find((dir) => existsSync(join(IOS, dir, 'ControlWidgets.swift')));
    expect(
      home,
      'ControlWidgets.swift must sit in a directory listed under sources for BOTH ' +
        `${APP_TARGET} and ${WIDGET_TARGET} (shared: ${shared.join(', ')}). An intent ` +
        'that is extension-only will not foreground the app, so tapping a Control ' +
        'Center control does nothing at all.',
    ).toBeDefined();
  });

  it('does not leave a second copy in the extension-only directory', () => {
    expect(existsSync(join(IOS, WIDGET_TARGET, 'ControlWidgets.swift'))).toBe(false);
  });

  it('keeps every control the widget bundle registers in that shared file', () => {
    const shared = sources[APP_TARGET].filter((p) => sources[WIDGET_TARGET].includes(p));
    const home = shared.find((dir) => existsSync(join(IOS, dir, 'ControlWidgets.swift')));
    const controls = readFileSync(join(IOS, home, 'ControlWidgets.swift'), 'utf8');
    const bundle = readFileSync(
      join(IOS, WIDGET_TARGET, 'DayGlanceWidgetBundle.swift'),
      'utf8',
    );

    // Whatever the bundle instantiates inside its iOS 18 block are the controls;
    // each must be defined in the dual-membership file, not somewhere the app
    // target cannot see.
    const block = bundle.match(/if #available\(iOS 18\.0, \*\) \{([\s\S]*?)\}/);
    expect(block, 'widget bundle no longer gates controls on iOS 18').not.toBeNull();

    const registered = [...block[1].matchAll(/^\s*([A-Za-z0-9_]+)\(\)/gm)].map((m) => m[1]);
    expect(registered.length, 'no controls registered in the bundle').toBeGreaterThan(0);

    const missing = registered.filter((name) => !controls.includes(`struct ${name}:`));
    expect(missing, 'controls defined outside the shared file').toEqual([]);
  });

  it('opens the app from each control intent', () => {
    const shared = sources[APP_TARGET].filter((p) => sources[WIDGET_TARGET].includes(p));
    const home = shared.find((dir) => existsSync(join(IOS, dir, 'ControlWidgets.swift')));
    const controls = readFileSync(join(IOS, home, 'ControlWidgets.swift'), 'utf8');

    const intents = [...controls.matchAll(/struct ([A-Za-z0-9_]+ControlIntent): AppIntent \{([\s\S]*?)\n\}/g)];
    expect(intents.length, 'no control intents found').toBeGreaterThan(0);

    const notOpening = intents
      .filter(([, , body]) => !/openAppWhenRun: Bool = true/.test(body))
      .map(([, name]) => name);
    expect(notOpening, 'these intents would run without foregrounding the app').toEqual([]);
  });
});
