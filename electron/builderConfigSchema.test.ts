// Validates electron-builder.config.cjs against electron-builder's OWN JSON
// schema, the same one it runs at build time.
//
// This exists because a config that loads fine in Node can still be rejected by
// electron-builder, and nothing in the pull-request path would notice: ci.yml
// runs the Vite web build and never invokes electron-builder, so a malformed
// config's first contact with reality is the release build.
//
// The specific failure that prompted it: artifactName was put inside a target
// entry. TargetConfiguration is additionalProperties:false with only `target`
// and `arch`, so the extra key invalidated the entry, and electron-builder
// reported "configuration.linux.target.0 should be one of these: string" —
// which points at the array, not at the offending property. The build died in
// 14 seconds having packaged nothing.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadConfig(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    delete require.cache[require.resolve('../electron-builder.config.cjs')];
    return require('../electron-builder.config.cjs');
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

/** electron-builder's schema rejects unknown keys it injects itself. */
function validate(config: Record<string, unknown>) {
  const Ajv = require('ajv');
  const schema = require('app-builder-lib/scheme.json');
  const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
  const check = ajv.compile(schema);
  // Mirrors what electron-builder strips before validating.
  const { ...rest } = config;
  const ok = check(rest);
  return { ok, errors: check.errors ?? [] };
}

describe('electron-builder.config.cjs matches electron-builder’s schema', () => {
  it.each([
    ['direct build', undefined],
    ['MAS build', 'com.dayglance'],
  ])('%s validates', (_label, appId) => {
    const { ok, errors } = validate(loadConfig({ DAYGLANCE_APP_ID: appId }));
    const detail = errors
      .map((e: { instancePath?: string; message?: string }) => `${e.instancePath} ${e.message}`)
      .join('\n');
    expect(ok, detail).toBe(true);
  });

  it('target entries carry only target and arch, the keys the schema allows', () => {
    // TargetConfiguration is additionalProperties:false. Anything else belongs
    // in a per-target block (appImage, deb) or on the platform.
    const config = loadConfig({ DAYGLANCE_APP_ID: undefined });
    for (const platform of ['mac', 'win', 'linux']) {
      const targets = (config[platform]?.target ?? []) as Record<string, unknown>[];
      for (const t of targets) {
        if (typeof t === 'string') continue;
        expect(Object.keys(t).sort(), `${platform}: ${JSON.stringify(t)}`)
          .toEqual(expect.arrayContaining(['target']));
        for (const key of Object.keys(t)) {
          expect(['target', 'arch'], `${platform}.target has illegal key "${key}"`).toContain(key);
        }
      }
    }
  });
});
