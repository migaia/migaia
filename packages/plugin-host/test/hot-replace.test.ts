import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'

/** Creates a provider with one stable feature name and a versioned output. */
const createProvider = (version: number, installError?: Error) => {
  const service = defineFeature(() => ({ version }))
  return definePlugin({
    name: 'A',
    features: { service },
    install: () => {
      if (installError) throw installError
      return { version: () => version }
    }
  })
}

describe('hot replacement', () => {
  it('rebinds hooks, restarts other dependents, and preserves the old provider on install failure', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const first = createProvider(1)
    let reboundVersion = 1
    let rebindCalls = 0
    let restartedVersion = 0
    const reboundFeature = defineFeature(
      (_core, dependencies) => ({ version: dependencies.service.version }),
      { service: first.getFeature('service') }
    )
    const reboundDispose = vi.fn()
    const rebound = definePlugin({
      name: 'B',
      features: { reboundFeature },
      install: (core) => {
        reboundVersion = core.features.reboundFeature.version
        return {}
      },
      onDependencyReplaced: (_name, outputs) => {
        rebindCalls += 1
        reboundVersion = (outputs.service as { readonly version: number }).version
      },
      dispose: reboundDispose
    })
    const restartedFeature = defineFeature(
      (_core, dependencies) => ({ version: dependencies.service.version }),
      { service: first.getFeature('service') }
    )
    const restartedDispose = vi.fn()
    const restarted = definePlugin({
      name: 'C',
      features: { restartedFeature },
      install: (core) => {
        restartedVersion = core.features.restartedFeature.version
        return {}
      },
      dispose: restartedDispose
    })
    const [providerHandle] = await host.use(first, rebound, restarted)

    await host.replace('A', createProvider(2))
    expect(reboundVersion).toBe(2)
    expect(rebindCalls).toBe(1)
    expect(reboundDispose).not.toHaveBeenCalled()
    expect(restartedVersion).toBe(2)
    expect(restartedDispose).toHaveBeenCalledTimes(1)
    expect(providerHandle.extensions.version()).toBe(2)

    const failure = new Error('replacement failed')
    await expect(host.replace('A', createProvider(3, failure))).rejects.toMatchObject({
      cause: failure
    })
    expect(providerHandle.extensions.version()).toBe(2)
    await expect(
      host.replace('A', definePlugin({ name: 'other', install: () => ({}) }))
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.replaceNameMismatch
    })
  })
})
