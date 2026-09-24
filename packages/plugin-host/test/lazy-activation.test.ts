import { describe, expect, it, vi } from 'vitest'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'

describe('lazy activation', () => {
  it('activates explicitly once and transitively for required consumers', async () => {
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const install = vi.fn(() => ({ call: () => 1 }))
    const value = defineFeature(() => ({ value: 1 }))
    const lazy = definePlugin({ name: 'L', activation: 'lazy', features: { value }, install })
    const [handle] = await host.use(lazy)
    expect(install).not.toHaveBeenCalled()
    expect(() => handle.extensions).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.pluginNotActivated })
    )
    const first = host.activate('L')
    const second = host.activate('L')
    expect(first).toBe(second)
    await first
    expect(install).toHaveBeenCalledTimes(1)

    const dependentFeature = defineFeature(
      (_core, dependencies) => ({ value: dependencies.value.value }),
      { value: lazy.getFeature('value') }
    )
    const dependent = definePlugin({
      name: 'M',
      features: { dependentFeature },
      install: () => ({})
    })
    await host.unUse('L')
    const nextHost = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    await nextHost.use(dependent, lazy)
    expect(install).toHaveBeenCalledTimes(2)
  })
})
