import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('ST-C6 cold package import', () => {
  it('creates no runtime on import and shares the canonical default only on first store creation', () => {
    /** A fresh native module graph observes the existing read-only copy registration boundary. */
    const script = `
      const key = Symbol.for('@migaia/reactive.runtime-copies');
      const before = Object.hasOwn(globalThis, key);
      const light = await import('@migaia/store-light');
      const cold = !Object.hasOwn(globalThis, key);
      const first = light.createStore({ value: 1 });
      const made = Object.hasOwn(globalThis, key);
      const second = light.createStore({ value: 2 });
      const reactive = await import('@migaia/reactive');
      const shared = first.$runtime === second.$runtime;
      const rootShared = first.$runtime === reactive.defaultRuntime;
      await first.$dispose(); await second.$dispose();
      console.log(JSON.stringify({ before, cold, made, shared, rootShared }));
    `
    /** The real built package entry is resolved from its own manifest, without a loader or mocks. */
    const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8'
    })
    expect(JSON.parse(output)).toEqual({
      before: false,
      cold: true,
      made: true,
      shared: true,
      rootShared: true
    })
  })
})
