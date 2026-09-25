import { describe, expect, it, vi } from 'vitest'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostErrorCode,
  type IPluginHostCore
} from '../src/index.js'

describe('lazy activation', () => {
  it('A26 clears candidate stages and extension owners after failed activation', async () => {
    /** Host exposes stage execution count after each activation attempt. */
    class LazyStageHost extends PluginHost<Record<string, never>, number> {
      run(): number {
        let result = 0
        this.runPipeline(0, (value) => {
          result = value
        })
        return result
      }
    }
    const host = new LazyStageHost({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    /** First result mounts tag before a reserved extension key rejects activation. */
    let fail = true
    /** Counts the exact stage entries visible after the successful retry. */
    let stageCalls = 0
    const plugin = definePlugin({
      name: 'l',
      activation: 'lazy',
      install: (core: IPluginHostCore<number>) => {
        core.usePipeline((value, next) => {
          stageCalls += 1
          next(value + 1)
        })
        return fail ? { tag: () => 1, config: 1 } : { tag: () => 1 }
      }
    })
    const [handle] = await host.use(plugin)
    await expect(host.activate('l')).rejects.toMatchObject({
      code: PluginHostErrorCode.extensionReserved
    })
    expect(host.run()).toBe(0)
    fail = false
    await host.activate('l')
    expect(host.run()).toBe(1)
    expect(stageCalls).toBe(1)
    expect(Object.keys(handle.extensions)).toEqual(['tag'])
    await host.dispose()
  })

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
