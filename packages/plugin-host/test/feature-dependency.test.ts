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
})
