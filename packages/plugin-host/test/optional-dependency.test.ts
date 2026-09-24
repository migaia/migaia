import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'

/** Creates one optional provider-consumer pair and captures the injected value. */
const createPair = () => {
  const output = { value: 1 }
  const value = defineFeature(() => output)
  const provider = definePlugin({ name: 'A', features: { value }, install: () => ({}) })
  let received: object | undefined
  const optional = defineFeature(
    (_core, dependencies) => {
      received = dependencies.value
      return { present: dependencies.value !== undefined }
    },
    { value: provider.getFeature('value', { optional: true }) }
  )
  const consumer = definePlugin({ name: 'B', features: { optional }, install: () => ({}) })
  return { provider, consumer, output, received: () => received }
}

describe('optional dependencies', () => {
  it('resolves once without blocking provider removal', async () => {
    const absent = createPair()
    const first = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await first.use(absent.consumer)
    expect(absent.received()).toBeUndefined()

    const present = createPair()
    const second = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await second.use(present.provider, present.consumer)
    expect(present.received()).toBe(present.output)
    expect((await second.unUse('A', { dryRun: true })).edges).toEqual([
      { provider: 'A', consumer: 'B', optional: true }
    ])
    await expect(second.unUse('A')).resolves.toEqual({ ok: true })
    expect(second.plugin.disabled()).toEqual([])
    expect((await second.unUse('B', { dryRun: true })).edges).toEqual([
      { provider: 'A', consumer: 'B', optional: true, status: 'optional-absent' }
    ])
    await expect(second.unUse('B')).resolves.toEqual({ ok: true })
  })
})
