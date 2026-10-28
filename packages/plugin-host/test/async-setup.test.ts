import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode,
  type IPluginHostCore,
  type IPluginSetupContext
} from '../src/index.ts'
import { deferred, createHost } from './async-setup-fixtures.ts'

describe('async setup definition admission', () => {
  it('captures setup as a known function field and rejects invalid definitions', async () => {
    expect(() => definePlugin({ name: 'invalid', setup: 1, install: () => ({}) } as never)).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
    )

    const host = new PluginHost<Record<string, never>>({
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    expect(() => host.use({ name: 'raw', setup: 'x', install: () => ({}) } as never)).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
    )

    /** Counts calls to the source hook after the definition has frozen its wrapper. */
    let calls = 0
    const original = (_context: unknown) => {
      calls += 1
      return { ready: true }
    }
    const plugin = definePlugin({ name: 'valid', setup: original, install: () => ({}) })
    expect(typeof plugin.setup).toBe('function')
    expect(plugin.setup).not.toBe(original)
    expect(plugin.setup?.({} as never)).toEqual({ ready: true })
    expect(calls).toBe(1)
    await host.use(definePlugin({ name: 'raw', install: () => ({}) }))
    await host.dispose()
  })
})

describe('async setup installation', () => {
  it('rejects eager setup before synchronous hooks and permits lazy registration', async () => {
    /** Exposes the constructor and later synchronous installation paths. */
    class SyncHost extends PluginHost<Record<string, never>> {
      constructor(plugins: readonly unknown[] = []) {
        super({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
        if (plugins.length > 0) this.useSync(plugins as never)
      }

      add(plugins: readonly unknown[]): void {
        this.useSync(plugins as never)
      }
    }
    const before = vi.fn(() => ({}))
    const setup = vi.fn(() => 1)
    const expose = vi.fn(() => ({}))
    const install = vi.fn(() => ({}))
    const plain = definePlugin({ name: 'a', install: before })
    const prepared = definePlugin({ name: 'p', setup, featureExpose: expose, install })
    expect(() => new SyncHost([plain, prepared])).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.setupRequiresAsyncInstall })
    )
    expect(before).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()
    expect(expose).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()

    const host = new SyncHost()
    expect(() => host.add([plain, prepared])).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.setupRequiresAsyncInstall })
    )
    expect(host.revision).toBe(0)
    const lazy = definePlugin({ name: 'l', activation: 'lazy', setup, install })
    expect(() => host.add([lazy])).not.toThrow()
    expect(setup).not.toHaveBeenCalled()
    await host.activate('l')
    expect(setup).toHaveBeenCalledTimes(1)
    expect(install).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('queues behind a lease drain, then times out a mutation waiting behind setup', async () => {
    /** Exposes a long-running async pipeline that retains a plugin-owned lease. */
    class LeaseHost extends PluginHost<Record<string, never>, number> {
      run(): Promise<void> {
        return Promise.resolve(this.runPipeline(1, () => undefined))
      }
    }
    const scheduler = createManualScheduler()
    const host = new LeaseHost({
      scheduler,
      pipeline: { mode: MiddlewarePipelineMode.async },
      queueAdmissionTimeoutMs: 20,
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
    const pipelineGate = deferred<void>()
    const pipelineStarted = deferred<void>()
    await host.use(
      definePlugin({
        name: 'q0',
        install: (core: IPluginHostCore<number>) => {
          core.usePipeline(async (_value, next) => {
            pipelineStarted.resolve()
            await pipelineGate.promise
            next(1)
          })
          return {}
        }
      })
    )
    const running = host.run()
    await pipelineStarted.promise
    const removing = host.unUse('q0')
    const setupGate = deferred<void>()
    const setupStarted = deferred<void>()
    const slow = host.use(
      definePlugin({
        name: 'p',
        setup: async () => {
          setupStarted.resolve()
          await setupGate.promise
          return 1
        },
        install: () => ({})
      })
    )
    const queuedInstall = vi.fn(() => ({}))
    const queued = host.use(definePlugin({ name: 'z', install: queuedInstall }))
    scheduler.advance(5)
    pipelineGate.resolve()
    await running
    await removing
    await setupStarted.promise
    scheduler.advance(20)
    await expect(queued).rejects.toMatchObject({ code: PluginHostErrorCode.mutationQueueTimeout })
    expect(queuedInstall).not.toHaveBeenCalled()
    setupGate.resolve()
    await slow
    await host.dispose()
  })

  it('completes provider setup before constructing either dependent feature', async () => {
    const { host } = createHost()
    const gate = deferred<{ value: number }>()
    const events: string[] = []
    /** Set by setup-aware exposure before the provider Feature factory runs. */
    let produced = 0
    const feature = defineFeature(() => {
      events.push('p.feature')
      return { value: produced }
    })
    const provider = definePlugin({
      name: 'p',
      features: { feature },
      setup: async () => {
        events.push('p.setup:start')
        const output = await gate.promise
        events.push('p.setup:end')
        return output
      },
      featureExpose: (_core, output) => {
        events.push('p.expose')
        produced = output.value
        return { read: () => output.value }
      },
      install: (core) => {
        events.push('p.install')
        expect(core.features.feature.value).toBe(7)
        return {}
      }
    })
    const dependent = definePlugin({
      name: 'c',
      features: {
        use: defineFeature(
          (_core, dependencies) => {
            events.push('c.feature')
            return { value: dependencies.feature.value }
          },
          { feature: provider.getFeature('feature') }
        )
      },
      featureExpose: () => {
        events.push('c.expose')
        return {}
      },
      install: (core) => {
        events.push('c.install')
        expect(core.features.use.value).toBe(7)
        return {}
      }
    })
    const installing = host.use(provider, dependent)
    expect(events).toEqual(['p.setup:start'])
    gate.resolve({ value: 7 })
    await installing
    expect(events).toEqual([
      'p.setup:start',
      'p.setup:end',
      'p.expose',
      'p.feature',
      'p.install',
      'c.expose',
      'c.feature',
      'c.install'
    ])
    await host.dispose()
  })

  it('delays features and install, forwards the same output, and guards host mutation', async () => {
    const { host, scheduler } = createHost()
    const gate = deferred<{ n: number }>()
    const setupOutput = { n: 1 }
    const events: string[] = []
    /** Setup context retained to prove the attempt remains usable until commit. */
    let context!: IPluginSetupContext
    /** Resource released when its registration is removed. */
    let releases = 0
    const feature = defineFeature(() => {
      events.push('feature')
      return { value: 1 }
    })
    const plugin = definePlugin({
      name: 'p',
      features: { feature },
      setup: (value) => {
        context = value
        events.push('setup:start')
        value.onDispose(() => {
          releases += 1
        })
        expect(() => host.use({ name: 'reentrant', install: () => ({}) })).toThrow(
          expect.objectContaining({ code: PluginHostErrorCode.lifecycleMutation })
        )
        expect(() => host.config.update('p' as never, () => ({}))).toThrow(
          expect.objectContaining({ code: PluginHostErrorCode.lifecycleMutation })
        )
        return gate.promise
      },
      featureExpose: function (_core, output) {
        events.push('expose')
        expect(arguments.length).toBe(2)
        expect(output).toBe(setupOutput)
        return { read: () => output.n }
      },
      install: function (core, output) {
        events.push('install')
        expect(arguments.length).toBe(2)
        expect(core.features.feature.value).toBe(1)
        expect(output.n).toBe(1)
        expect(output).toBe(setupOutput)
        expect(core.operation.deadlineAt).toBe(context.operation.deadlineAt)
        return { n: output.n }
      }
    })
    const installing = host.use(plugin)
    expect(events).toEqual(['setup:start'])
    expect(context.operation.now()).toBe(scheduler.now())
    expect('features' in context).toBe(false)
    expect('featureExpose' in context).toBe(false)
    expect('usePipeline' in context).toBe(false)
    let externalFailure: unknown
    try {
      host.use({ name: 'external', install: () => ({}) })
    } catch (error) {
      externalFailure = error
    }
    expect(externalFailure).toMatchObject({ code: PluginHostErrorCode.lifecycleMutation })
    let configFailure: unknown
    try {
      host.config.update('p' as never, () => ({}))
    } catch (error) {
      configFailure = error
    }
    expect(configFailure).toMatchObject({ code: PluginHostErrorCode.lifecycleMutation })
    expect((configFailure as PluginHostError).detail?.host).toEqual(
      (externalFailure as PluginHostError).detail?.host
    )
    gate.resolve(setupOutput)
    const [handle] = await installing
    expect(events).toEqual(['setup:start', 'expose', 'feature', 'install'])
    expect(handle.extensions.n).toBe(1)
    expect(context.operation.signal.aborted).toBe(false)
    expect(() =>
      context.onDispose(() => {
        releases += 10
      })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.resourceOutsideInstall }))
    expect(releases).toBe(10)
    await host.unUse('p')
    expect(releases).toBe(11)
    await host.dispose()
  })
})
