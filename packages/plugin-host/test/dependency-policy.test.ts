import { describe, expect, it } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'

/** Creates the required provider-consumer fixture used by removal and disable policy checks. */
const createFixture = async () => {
  const host = new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
  const value = defineFeature(() => ({ value: 1 }))
  const provider = definePlugin({ name: 'A', features: { value }, install: () => ({}) })
  const useValue = defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
    value: provider.getFeature('value')
  })
  const consumer = definePlugin({ name: 'B', features: { useValue }, install: () => ({}) })
  const [consumerHandle, providerHandle] = await host.use(consumer, provider)
  return { host, providerHandle, consumerHandle }
}

describe('dependency mutation policy', () => {
  it('rejects, plans, and cascades removal', async () => {
    const { host, providerHandle, consumerHandle } = await createFixture()
    await expect(host.unUse('A')).rejects.toMatchObject({
      code: PluginHostErrorCode.dependencyBlocked,
      detail: { blockedBy: ['B'] }
    })
    expect(providerHandle.name).toBe('A')
    expect(consumerHandle.name).toBe('B')
    await expect(host.unUse('A', { cascade: true, dryRun: true })).resolves.toMatchObject({
      order: ['B', 'A']
    })
    expect(providerHandle.name).toBe('A')
    await expect(host.unUse('A', { cascade: true })).resolves.toEqual({ ok: true })
    expect(() => providerHandle.extensions).toThrow()
    expect(() => consumerHandle.extensions).toThrow()
  })
})
