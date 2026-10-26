/** A rebind hook is bounded by the Host mutation budget like every other lifecycle hook. */
import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost } from '../src/index.js'

/** Creates the provider `A` whose Feature output changes with each version. */
const createProvider = (version: number) =>
  definePlugin({
    name: 'A',
    features: { service: defineFeature(() => ({ version })) },
    install: () => ({})
  })

describe('hung rebind hook', () => {
  it('treats an overdue rebind as failed and restarts the dependent', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: 20, pipelineDrainTimeoutMs: false }
    })
    const first = createProvider(1)
    /** Provider version the dependent saw at its latest install. */
    let installedVersion = 0
    const dispose = vi.fn()
    const dependent = definePlugin({
      name: 'B',
      features: {
        bound: defineFeature((_core, dependencies) => ({ version: dependencies.service.version }), {
          service: first.getFeature('service')
        })
      },
      install: (core) => {
        installedVersion = core.features.bound.version
        return {}
      },
      onDependencyReplaced: () => new Promise<void>(() => {}),
      dispose
    })
    await host.use(first, dependent)
    expect(installedVersion).toBe(1)

    await host.replace('A', createProvider(2))
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(installedVersion).toBe(2)
    await expect(
      host.use(definePlugin({ name: 'after', install: () => ({}) }))
    ).resolves.toHaveLength(1)
    await host.dispose()
  })
})
