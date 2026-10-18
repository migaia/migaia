import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  defineFeature,
  definePlugin,
  getPluginRuntimeIntegration,
  PluginHost,
  PluginHostErrorCode,
  type IPluginHostCore
} from '../src/index.js'

describe('lazy activation', () => {
  it.each(['notification', 'update'] as const)(
    'PHP-T2 preserves a cold %s signal through activation and removal',
    async (entry) => {
      /** Cold enablement can observe lifetime before any core or install attempt exists. */
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** Every observer must receive the same exact registration signal. */
      const signals: IAbortSignal[] = []
      await host.use(
        definePlugin({
          name: 'cold',
          activation: 'lazy',
          onDisable: (context) => {
            signals.push(context.signal)
          },
          onEnable: (context) => {
            signals.push(context.signal)
          },
          update: (_next, core) => {
            signals.push(core.lifecycle.signal)
          },
          install: (core) => {
            signals.push(core.lifecycle.signal)
            return {}
          }
        })
      )
      expect(signals).toHaveLength(0)
      if (entry === 'notification') {
        await host.plugin.disable('cold')
        await host.plugin.enable('cold')
      } else await host.config.update('cold', () => ({ value: 1 }))
      await host.activate('cold')
      expect(signals).toHaveLength(entry === 'notification' ? 4 : 3)
      expect(signals.every((signal) => signal === signals[0])).toBe(true)
      expect(signals[0]!.aborted).toBe(false)
      await host.unUse('cold')
      expect(signals[0]!.aborted).toBe(true)
      await host.dispose()
    }
  )

  it.each(['setup', 'install'] as const)(
    'PHA-T1 rejects synchronous %s activation reentry before sharing the pending request',
    async (phase) => {
      /** Reentry targets the same public registration and pending activation. */
      const host = new PluginHost<Record<string, never>>({
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
      })
      /** A synchronous hook must not receive the Promise that depends on its own completion. */
      const reenter = () => {
        expect(() => host.activate('reentrant')).toThrow(
          expect.objectContaining({ code: PluginHostErrorCode.lifecycleMutation })
        )
        return {}
      }
      /** Definition overloads preserve whether setup is present in the supported public API. */
      const plugin =
        phase === 'setup'
          ? definePlugin({
              name: 'reentrant',
              activation: 'lazy',
              setup: reenter,
              install: () => ({})
            })
          : definePlugin({ name: 'reentrant', activation: 'lazy', install: reenter })
      await host.use(plugin)
      await host.activate('reentrant')
      await host.dispose()
    }
  )

  it.each([false, 20] as const)(
    'PHA-T2 shares asynchronous activation callers with mutationTimeoutMs=%s',
    async (timeout) => {
      /** The operation deadline advances only when the test explicitly advances its clock. */
      const scheduler = createManualScheduler()
      const host = new PluginHost<Record<string, never>>({
        scheduler,
        execution: { mutationTimeoutMs: timeout, pipelineDrainTimeoutMs: false }
      })
      /** Resolves once the hook has entered, so the outside request runs during its await. */
      let entered!: () => void
      const started = new Promise<void>((resolve) => {
        entered = resolve
      })
      /** Allows the asynchronous hook continuation to read the shared request. */
      let proceed!: () => void
      const gate = new Promise<void>((resolve) => {
        proceed = resolve
      })
      /** Signals that the continuation has captured its exact public Promise identity. */
      let observed!: () => void
      const captured = new Promise<void>((resolve) => {
        observed = resolve
      })
      /** An await continuation has no portable hook-origin identity. */
      let inside: ReturnType<typeof host.activate> | undefined
      await host.use(
        definePlugin({
          name: 'asynchronous',
          activation: 'lazy',
          install: async () => {
            entered()
            await gate
            inside = host.activate('asynchronous')
            observed()
            if (timeout !== false) await inside
            return {}
          }
        })
      )
      const first = host.activate('asynchronous')
      await started
      expect(host.activate('asynchronous')).toBe(first)
      proceed()
      await captured
      expect(inside).toBe(first)
      if (timeout === false) await first
      else {
        /** Observe rejection before the deterministic deadline breaks the self-dependency. */
        const rejected = expect(first).rejects.toMatchObject({
          code: PluginHostErrorCode.mutationExecutionTimeout
        })
        scheduler.advance(timeout)
        await rejected
      }
      await host.dispose()
    }
  )

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
