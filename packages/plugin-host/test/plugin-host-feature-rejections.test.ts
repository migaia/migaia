import { describe, expect, it } from 'vitest'

import { defineFeature, definePlugin } from '../src/index.js'
import { FeatureHost } from './plugin-host-fixtures.js'

describe('PluginHost', () => {
  it('reports rejected Feature thenables without awaiting or publishing them', async () => {
    const original = new Error('late-feature-rejection')
    const diagnostics: string[] = []
    const invalid = defineFeature((() => Promise.reject(original)) as never)
    const host = new FeatureHost({
      diagnostic: (message: string) => diagnostics.push(message)
    } as any)
    let thrown: any
    try {
      await host.use(
        definePlugin({
          name: 'invalid-feature',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      )
    } catch (error) {
      thrown = error
    }
    await Promise.resolve()
    await Promise.resolve()
    expect(thrown.cause.cause).toBe(original)
    expect(diagnostics.join('|')).toContain('late-feature-rejection')
  })

  it('contains synchronous and asynchronous diagnostic failures without replacing a late Feature cause', async () => {
    const original = new Error('feature-late-cause')
    const reporterFailure = new Error('reporter-late-failure')
    const invalid = defineFeature((() => Promise.reject(original)) as never)
    const host = new FeatureHost({ diagnostic: () => Promise.reject(reporterFailure) } as any)
    await expect(
      host.use(
        definePlugin({
          name: 'invalid-reporter',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      )
    ).rejects.toMatchObject({ cause: { cause: original } })
    await Promise.resolve()
    const throwingHost = new FeatureHost({
      diagnostic: () => {
        throw reporterFailure
      }
    } as any)
    await expect(
      throwingHost.use(
        definePlugin({
          name: 'invalid-throwing-reporter',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      )
    ).rejects.toMatchObject({ cause: { cause: original } })
  })

  it('captures a custom Feature thenable once and rejects useSync before it settles', async () => {
    let getterCalls = 0
    let thenCalls = 0
    let reject!: (error: unknown) => void
    const original = new Error('custom-late')
    // oxlint-disable-next-line unicorn/no-thenable -- hostile Feature output verifies observed late rejection.
    const value = Object.defineProperty({}, 'then', {
      get: () => {
        getterCalls += 1
        return (_resolve: unknown, onReject: (error: unknown) => void) => {
          thenCalls += 1
          reject = onReject
        }
      }
    })
    const invalid = defineFeature((() => value) as never)
    let installs = 0
    const host = new FeatureHost()
    let thrown: any
    try {
      host.installSync([
        definePlugin({
          name: 'custom-invalid',
          features: { invalid },
          featureExpose: {},
          install: () => {
            installs += 1
            return {}
          }
        })
      ])
    } catch (error) {
      thrown = error
    }
    expect(installs).toBe(0)
    expect(getterCalls).toBe(1)
    expect(thenCalls).toBe(1)
    reject(original)
    await Promise.resolve()
    expect(thrown.cause.cause).toBe(original)
  })

  it('preserves a throwing then getter as the Feature failure cause', () => {
    const original = new Error('then-getter')
    const invalid = defineFeature((() =>
      // oxlint-disable-next-line unicorn/no-thenable -- hostile Feature output verifies getter-failure preservation.
      Object.defineProperty({}, 'then', {
        get: () => {
          throw original
        }
      })) as never)
    const host = new FeatureHost()
    let thrown: any
    try {
      host.installSync([
        definePlugin({
          name: 'getter-invalid',
          install: () => ({}),
          features: { invalid },
          featureExpose: {}
        })
      ])
    } catch (error) {
      thrown = error
    }
    expect(thrown.cause.cause).toBe(original)
  })

  it('constructs Feature outputs per registration before plugin install', async () => {
    const expose = { value: () => 21 }
    const base = defineFeature(
      (core: { readonly featureExpose: { readonly value: () => number } }) => ({
        read: () => core.featureExpose.value()
      })
    )
    const derived = defineFeature(
      (_core, dependencies) => ({
        twice: () => dependencies.base.read() * 2
      }),
      { base }
    )
    const plugin = definePlugin({
      name: 'native-feature',
      features: { derived },
      featureExpose: expose,
      install: (core) => {
        const featureCore = core as typeof core & {
          readonly features: { readonly derived: { readonly twice: () => number } }
        }
        return { result: featureCore.features.derived.twice() }
      }
    })
    const host = new FeatureHost()
    const [first] = await host.use(plugin)
    expect(first.extensions.result).toBe(42)
    const [second] = await new FeatureHost().use(plugin)
    expect(second.extensions.result).toBe(42)
    expect(Object.isFrozen(expose)).toBe(false)
  })
})
