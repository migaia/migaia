import { describe, expect, it, vi } from 'vitest'
import {
  defineFeature,
  definePlugin,
  getPluginRuntimeIntegration,
  PluginHost,
  PluginHostErrorCode,
  type IPluginHostCore
} from '../src/index.js'

describe('lazy activation', () => {
  it('PHL-T1 PH-B2 releases committed resources after shared publication fails on a non-extensible Host', async () => {
    /** Non-extensible Host instances already support public handle publication. */
    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    Object.preventExtensions(host)
    /** A genuine family token and minted core drive the normal shared-slot publisher. */
    let family = {}
    /** Keep the canonical integration observable without reaching into private state. */
    let integration: ReturnType<typeof getPluginRuntimeIntegration> | undefined
    /** The second attempt uses ordinary handle extensions on the same supported Host. */
    let shared = true
    /** Resource cleanup must occur at failed activation, before a successful retry. */
    const released = vi.fn()
    /** Each attempt owns a resource through the actual plugin core. */
    const plugin = definePlugin({
      name: 'publication',
      activation: 'lazy',
      install: (core) => {
        core.onDispose(released)
        integration = getPluginRuntimeIntegration(core)
        if (shared) {
          /** This genuine reservation is staged before the actual Host publisher runs. */
          const slot = integration.acquireSharedSlot('sharedValue', family, () => ({ value: 1 }))
          slot.register({ value: 1 })
          slot.contribute({ value: 1 }, 'first')
        }
        return { tag: () => 1 }
      }
    })
    const [handle] = await host.use(plugin)
    for (const attempt of [1, 2]) {
      /** Both attempts must reach native publication, rather than collide with a leaked family. */
      const activation = host.activate('publication')
      await expect(activation).rejects.toBeInstanceOf(TypeError)
      await expect(activation).rejects.toMatchObject({
        code: PluginHostErrorCode.pluginInstallFailed
      })
      expect(released).toHaveBeenCalledTimes(attempt)
      expect(integration!.readSharedExtension('sharedValue')).toBeUndefined()
      family = {}
    }
    shared = false
    await host.activate('publication')
    expect(handle.extensions.tag()).toBe(1)
    expect(released).toHaveBeenCalledTimes(2)
    await host.dispose()
    expect(released).toHaveBeenCalledTimes(3)
  })

  it('PHL-T2 A26 clears candidate stages and extension owners after failed activation', async () => {
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
    /** Cleanup rejection must not replace the reserved-extension failure or skip stage rollback. */
    const cleanupFailure = new Error('lazy cleanup')
    /** Counts the exact stage entries visible after the successful retry. */
    let stageCalls = 0
    /** Each retry must bind shared publication to its own install batch. */
    const sharedFamily = {}
    const plugin = definePlugin({
      name: 'l',
      activation: 'lazy',
      install: (core: IPluginHostCore<number>) => {
        core.onDispose(() => {
          if (fail) throw cleanupFailure
        })
        /** Retry must publish from the current attempt rather than a cached prior batch. */
        const slot = getPluginRuntimeIntegration(core).acquireSharedSlot(
          'candidateSlot',
          sharedFamily,
          () => ({ value: 1 })
        )
        slot.register({ value: 1 })
        core.usePipeline((value, next) => {
          stageCalls += 1
          next(value + 1)
        })
        return fail ? { tag: () => 1, config: 1 } : { tag: () => 1 }
      }
    })
    const [handle] = await host.use(plugin)
    await expect(host.activate('l')).rejects.toMatchObject({
      code: PluginHostErrorCode.extensionReserved,
      errors: [cleanupFailure]
    })
    expect(host.run()).toBe(0)
    expect(Reflect.get(host, 'candidateSlot')).toBeUndefined()
    fail = false
    await host.activate('l')
    expect(host.run()).toBe(1)
    expect(stageCalls).toBe(1)
    expect(Reflect.get(host, 'candidateSlot')).toEqual({ value: 1 })
    expect(Object.keys(handle.extensions)).toEqual(['tag'])
    await host.dispose()
  })

  it('PHL-T3 activates explicitly once and transitively for required consumers', async () => {
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
