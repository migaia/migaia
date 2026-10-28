import { describe, expect, it } from 'vitest'

import { defineFeature, definePlugin } from '../src/index.ts'
import { openComposition } from '../src/composition-entry.ts'
import { FeatureHost } from './plugin-host-fixtures.ts'

describe('PluginHost', () => {
  it('keeps object extension members named install and expose while rejecting the legacy function sentinel', async () => {
    const object = definePlugin({
      name: 'fixture-object',
      install: () => ({ install: true, expose: true })
    })
    const legacySentinel = definePlugin('legacy-sentinel', () => ({ legacy: true }) as never)
    const host = new FeatureHost()
    const [handle] = await host.use(object)
    expect(handle.extensions).toMatchObject({ install: true, expose: true })
    await expect(host.use(legacySentinel)).rejects.toMatchObject({
      cause: { code: 'INVALID_OPTION' }
    })
    expect(openComposition(host).getCurrentSnapshot().extensions).not.toHaveProperty('legacy')
    await host.dispose()
  })

  it('captures one descriptor per registration and forwards only its declared hooks', async () => {
    let descriptorCalls = 0
    let installCalls = 0
    let exposeCalls = 0
    const plugin = definePlugin('descriptor-hooks', (core) => {
      descriptorCalls += 1
      expect(typeof core.onDispose).toBe('function')
      return {
        install: () => {
          installCalls += 1
          return { installed: descriptorCalls }
        },
        expose: () => {
          exposeCalls += 1
          return { exposed: descriptorCalls }
        }
      }
    })
    const [first] = await new FeatureHost().use(plugin)
    const [second] = await new FeatureHost().use(plugin)
    expect(first.extensions).toMatchObject({ installed: 1, exposed: 1 })
    expect(second.extensions).toMatchObject({ installed: 2, exposed: 2 })
    expect([descriptorCalls, installCalls, exposeCalls]).toEqual([2, 2, 2])
  })

  it('rejects descriptor expose collisions without invoking callback results as hooks', async () => {
    // @ts-expect-error rejects overlapping install/expose Host projections statically.
    const plugin = definePlugin('descriptor-collision', () => ({
      install: () => ({ duplicate: 1 }),
      expose: () => ({ duplicate: 2 })
    }))
    await expect(new FeatureHost().use(plugin)).rejects.toMatchObject({
      cause: { code: 'EXTENSION_DUPLICATE' }
    })
  })

  it('rejects Feature-core reads from a descriptor before Feature initialization', async () => {
    const plugin = definePlugin('early-feature-read', (core) => {
      void (core as unknown as { readonly features: object }).features
      return { install: () => ({}) }
    })
    await expect(new FeatureHost().use(plugin)).rejects.toMatchObject({
      cause: {
        code: 'INVALID_OPTION',
        message: expect.stringContaining('Feature core is not ready')
      }
    })
  })

  it('initializes Feature output after descriptor featureExpose and before install', async () => {
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => ({ read: core.featureExpose.read }))
    const plugin = definePlugin(
      'feature-ready',
      (core) => ({
        featureExpose: () => ({ read: () => 11 }),
        install: () => ({ value: core.features.feature.read() })
      }),
      { feature }
    )
    const host = new FeatureHost()
    const [handle] = await host.use(plugin)
    expect(handle.extensions.value).toBe(11)
    await host.dispose()
  })

  it('snapshots only trusted enumerable direct Feature dependencies without running factories', () => {
    let calls = 0
    const dependency = defineFeature(() => {
      calls += 1
      return { dependency: true }
    })
    const feature = defineFeature(() => ({ feature: true }), { dependency })
    expect(feature).toEqual({})
    expect(Object.isFrozen(feature)).toBe(true)
    expect(calls).toBe(0)
    expect(() => defineFeature(() => ({}), { dependency, invalid: {} as never })).toThrow(
      'feature dependencies must contain defined features'
    )
    expect(() => defineFeature(() => ({}), Object.create({ dependency }))).toThrow(
      'feature dependencies must be a plain record'
    )
  })

  it('accepts descriptor Feature shorthand on the same opaque authority', async () => {
    let calls = 0
    const feature = defineFeature({ install: () => ({ value: ++calls }) })
    const plugin = definePlugin({
      name: 'descriptor-feature',
      features: { feature },
      featureExpose: {},
      install: (core) => ({ value: (core as any).features.feature.value })
    })
    const [result] = await new FeatureHost().use(plugin)
    expect(result.extensions.value).toBe(1)
    expect(calls).toBe(1)
  })

  it('rejects forged Feature records before any factory callback', () => {
    let getterCalls = 0
    const descriptor = Object.defineProperty({}, 'install', {
      enumerable: true,
      get: () => {
        getterCalls += 1
        return () => ({})
      }
    })
    expect(() => defineFeature(descriptor as never)).toThrow()
    expect(getterCalls).toBe(0)
    let calls = 0
    const valid = defineFeature(() => {
      calls += 1
      return {}
    })
    expect(() =>
      definePlugin({
        name: 'forged-feature',
        install: () => ({}),
        features: { valid, forged: {} as never },
        featureExpose: {}
      })
    ).toThrow()
    expect(calls).toBe(0)
  })

  it('injects only featureExpose into Feature factories, never lifecycle core', async () => {
    const feature = defineFeature<
      { readonly read: () => number },
      Record<never, never>,
      { readonly read: () => number }
    >((core) => {
      expect('getShared' in core).toBe(false)
      expect('onDispose' in core).toBe(false)
      return { read: () => core.featureExpose.read() }
    })
    const plugin = definePlugin({
      name: 'feature-core-isolation',
      features: { feature },
      featureExpose: { read: () => 7 },
      install: (core) => ({ read: core.features.feature.read() })
    })
    const host = new FeatureHost()
    const [handle] = await host.use(plugin)
    expect(handle.extensions.read).toBe(7)
    await host.dispose()
  })
})
