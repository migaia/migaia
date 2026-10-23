import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'

/** Creates an unbounded Host for deterministic dependency installation. */
const createHost = (): PluginHost<Record<string, never>> =>
  new PluginHost({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })

/** Creates a provider/consumer pair and records the injected object identity. */
const createPair = () => {
  const output = { read: () => 42 }
  const cache = defineFeature(() => output)
  const provider = definePlugin({ name: 'provider', features: { cache }, install: () => ({}) })
  let received: object | undefined
  const useCache = defineFeature(
    (_core, dependencies) => {
      received = dependencies.cache
      return { read: dependencies.cache.read }
    },
    { cache: provider.getFeature('cache') }
  )
  const consumer = definePlugin({ name: 'consumer', features: { useCache }, install: () => ({}) })
  return { provider, consumer, output, received: () => received }
}

describe('feature dependencies', () => {
  it('orders batches and injects the provider output identity', async () => {
    for (const reverse of [false, true]) {
      const pair = createPair()
      const host = createHost()
      await host.use(...(reverse ? [pair.consumer, pair.provider] : [pair.provider, pair.consumer]))
      expect(pair.received()).toBe(pair.output)
    }
  })

  it('rejects missing providers before install', async () => {
    const pair = createPair()
    const host = createHost()
    await expect(host.use(pair.consumer)).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteMissing
    })
  })

  it('rejects dependency cycles before any install executes', async () => {
    let installs = 0
    const aFeature = defineFeature(() => ({ value: 'a' }))
    const aSeed = definePlugin({ name: 'a', features: { value: aFeature }, install: () => ({}) })
    const b = definePlugin({
      name: 'b',
      features: {
        value: defineFeature(() => ({ value: 'b' }), { a: aSeed.getFeature('value') })
      },
      install: () => {
        installs += 1
        return {}
      }
    })
    const a = definePlugin({
      name: 'a',
      features: { value: defineFeature(() => ({ value: 'a' }), { b: b.getFeature('value') }) },
      install: () => {
        installs += 1
        return {}
      }
    })
    const host = createHost()
    await expect(host.use(a, b)).rejects.toMatchObject({
      code: PluginHostErrorCode.dependencyCycle
    })
    expect(installs).toBe(0)
  })

  it('builds a shared Feature diamond once with dependency-first installation', async () => {
    /** One provider output must be shared by both branches. */
    const output = { value: 7 }
    /** Installation order witnesses the static dependency schedule through the consumer API. */
    const order: string[] = []
    /** The sole root creates the provider output consumed by both branches. */
    const root = definePlugin({
      name: 'root',
      features: { value: defineFeature(() => output) },
      install: () => {
        order.push('root')
        return {}
      }
    })
    /** One branch retains the exact root output through a Feature reference. */
    const left = definePlugin({
      name: 'left',
      features: {
        value: defineFeature((_core, dependencies) => ({ read: () => dependencies.root }), {
          root: root.getFeature('value')
        })
      },
      install: () => {
        order.push('left')
        return {}
      }
    })
    /** The second branch shares the same root without constructing a replacement. */
    const right = definePlugin({
      name: 'right',
      features: {
        value: defineFeature((_core, dependencies) => ({ read: () => dependencies.root }), {
          root: root.getFeature('value')
        })
      },
      install: () => {
        order.push('right')
        return {}
      }
    })
    /** The leaf joins both dependency branches in the host-owned graph. */
    const leaf = definePlugin({
      name: 'leaf',
      features: {
        value: defineFeature(
          (_core, dependencies) => ({
            read: () => [dependencies.left.read(), dependencies.right.read()]
          }),
          { left: left.getFeature('value'), right: right.getFeature('value') }
        )
      },
      install: () => {
        order.push('leaf')
        return {}
      }
    })
    /** Canonical consumer host validates dependency scheduling through public installation. */
    const host = createHost()
    const [handle] = await host.use(leaf, right, left, root)
    expect(order).toEqual(['root', 'right', 'left', 'leaf'])
    expect(handle.getFeature('value').read()).toEqual([output, output])
    await host.dispose()
  })
})
