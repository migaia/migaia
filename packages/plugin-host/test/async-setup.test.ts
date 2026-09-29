import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostError,
  PluginHostErrorCode,
  type IPluginHostCore,
  type IPluginSetupContext
} from '../src/index.js'

/** Exposes a manual completion point for the setup transaction. */
const deferred = <T>() => {
  /** Completes the held setup result after assertions observe its pending state. */
  let resolve!: (value: T) => void
  /** Rejects the held setup result with an exact error identity. */
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

/** Creates a host whose operation deadline can be controlled by a manual scheduler. */
const createHost = (timeout: number | false = false, diagnostic?: (...args: any[]) => void) => {
  const scheduler = createManualScheduler()
  const host = new PluginHost<Record<string, never>>({
    scheduler,
    diagnostic,
    execution: { mutationTimeoutMs: timeout, pipelineDrainTimeoutMs: false }
  })
  return { host, scheduler }
}

describe('async setup definition admission', () => {
  it('A8 captures setup as a known function field and rejects invalid definitions', async () => {
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
  it('A1 queues behind a lease drain, then times out a mutation waiting behind setup', async () => {
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

  it('A1 completes provider setup before constructing either dependent feature', async () => {
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

  it('A1 delays features and install, forwards the same output, and guards host mutation', async () => {
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

  it('A2 rolls setup resources back in reverse order and retains the primary cause', async () => {
    const { host } = createHost()
    const events: string[] = []
    const primary = new Error('setup failed')
    const first = definePlugin({
      name: 'q',
      install: (core) => {
        core.onDispose(() => {
          events.push('q')
        })
        return {}
      }
    })
    const second = definePlugin({
      name: 'p',
      setup: (context) => {
        context.onDispose(() => {
          events.push('r1')
        })
        context.onDispose(() => {
          events.push('r2')
        })
        throw primary
      },
      install: () => {
        events.push('install')
        return {}
      }
    })
    await expect(host.use(first, second)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary,
      detail: { failedName: 'p' }
    })
    expect(events).toEqual(['r2', 'r1', 'q'])
    await host.dispose()
  })

  it('A2 reports rollback failures without replacing the setup rejection', async () => {
    const reports: Array<{ code: unknown; error: unknown }> = []
    const { host } = createHost(false, (_message, code, error) => reports.push({ code, error }))
    const gate = deferred<never>()
    const primary = new Error('primary setup rejection')
    const cleanup = new Error('cleanup failure')
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (context) => {
          context.onDispose(() => {
            throw cleanup
          })
          return gate.promise
        },
        install: () => ({})
      })
    )
    gate.reject(primary)
    let failure: unknown
    try {
      await installing
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary,
      detail: { rollbackErrors: [cleanup] }
    })
    expect(
      reports.some((entry) => entry.code === PluginHostErrorCode.pluginInstallRollbackFailed)
    ).toBe(true)
    await host.dispose()
  })

  it('A2 releases setup resources after install resources if install fails', async () => {
    const { host } = createHost()
    const order: string[] = []
    const primary = new Error('install failure')
    await expect(
      host.use(
        definePlugin({
          name: 'p',
          setup: (context) => {
            context.onDispose(() => {
              order.push('setup')
            })
            return { ready: true }
          },
          install: (core) => {
            core.onDispose(() => {
              order.push('install')
            })
            throw primary
          }
        })
      )
    ).rejects.toMatchObject({ code: PluginHostErrorCode.pluginInstallFailed, cause: primary })
    expect(order).toEqual(['install', 'setup'])
    await host.dispose()
  })

  it('A2 releases a committed setup resource when a later batch member fails', async () => {
    const { host } = createHost()
    const primary = new Error('dependent failed')
    const release = vi.fn()
    const provider = definePlugin({
      name: 'p',
      features: { ready: defineFeature(() => ({ value: 1 })) },
      setup: (context) => {
        context.onDispose(release)
        return 1
      },
      install: () => ({})
    })
    const dependent = definePlugin({
      name: 'c',
      features: {
        use: defineFeature(() => ({ ready: true }), { p: provider.getFeature('ready') })
      },
      install: () => {
        throw primary
      }
    })
    await expect(host.use(provider, dependent)).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary
    })
    expect(release).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('A4 aborts a timed-out attempt, drops late success, and reports late rejection', async () => {
    const reports: unknown[] = []
    const { host, scheduler } = createHost(50, (_message, _code, error) => reports.push(error))
    const gate = deferred<unknown>()
    /** Context captured so the late registration path can be exercised after rollback. */
    let context!: IPluginSetupContext
    /** Counts setup-owned resources disposed by rollback. */
    let releases = 0
    const install = vi.fn(() => ({}))
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (value) => {
          context = value
          value.onDispose(() => {
            releases += 1
          })
          return gate.promise
        },
        install
      })
    )
    expect(context.operation.deadlineAt).toBe(50)
    scheduler.advance(50)
    await expect(installing).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: { code: PluginHostErrorCode.mutationExecutionTimeout }
    })
    expect(context.operation.signal.aborted).toBe(true)
    expect(releases).toBe(1)
    const late = new Error('late setup rejection')
    gate.reject(late)
    await Promise.resolve()
    expect(reports).toContain(late)
    expect(install).not.toHaveBeenCalled()
    expect(() =>
      context.onDispose(() => {
        releases += 1
      })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.resourceOutsideInstall }))
    expect(releases).toBe(2)
    expect(() => context.onDispose({} as never)).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.invalidOption })
    )
    const lateCleanup = new Error('late cleanup failed')
    expect(() => context.onDispose(() => Promise.reject(lateCleanup))).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.resourceOutsideInstall })
    )
    await vi.waitFor(() => expect(reports).toContain(lateCleanup))
    await host.dispose()
  })

  it('A4 disposes a host without waiting for a setup that never settles', async () => {
    const { host } = createHost()
    /** Captured context exposes the attempt-level signal after host disposal. */
    let context!: IPluginSetupContext
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (value) => {
          context = value
          return new Promise<never>(() => {})
        },
        install: () => ({})
      })
    )
    const disposing = host.dispose()
    await expect(installing).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: { code: PluginHostErrorCode.hostDisposing }
    })
    await disposing
    expect(context.operation.signal.aborted).toBe(true)
  })

  it('A4 discards late success and reports a rejection after host disposal', async () => {
    const reports: unknown[] = []
    const { host, scheduler } = createHost(50, (_message, _code, error) => reports.push(error))
    const successGate = deferred<{ value: number }>()
    const install = vi.fn(() => ({}))
    const exposing = vi.fn(() => ({}))
    const expired = host.use(
      definePlugin({
        name: 'expired',
        setup: () => successGate.promise,
        featureExpose: exposing,
        install
      })
    )
    scheduler.advance(50)
    await expect(expired).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.mutationExecutionTimeout }
    })
    successGate.resolve({ value: 1 })
    await Promise.resolve()
    expect(exposing).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()

    const lateGate = deferred<never>()
    const disposingHost = createHost(false, (_message, _code, error) => reports.push(error)).host
    const pending = disposingHost.use(
      definePlugin({ name: 'p', setup: () => lateGate.promise, install: () => ({}) })
    )
    const disposed = disposingHost.dispose()
    await expect(pending).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.hostDisposing }
    })
    await disposed
    const late = new Error('disposed setup rejected late')
    lateGate.reject(late)
    await vi.waitFor(() => expect(reports).toContain(late))
    await host.dispose()
  })

  it('A4 suppresses cancellation echoes and preserves an in-time coded rejection', async () => {
    const reports: unknown[] = []
    const { host, scheduler } = createHost(50, (_message, _code, error) => reports.push(error))
    /** A setup that rejects with its own abort reason when the deadline expires. */
    let context!: IPluginSetupContext
    const installing = host.use(
      definePlugin({
        name: 'p',
        setup: (value) => {
          context = value
          return new Promise<never>((_resolve, reject) => {
            value.operation.signal.addEventListener('abort', () =>
              reject(value.operation.signal.reason)
            )
          })
        },
        install: () => ({})
      })
    )
    scheduler.advance(50)
    await expect(installing).rejects.toMatchObject({
      cause: { code: PluginHostErrorCode.mutationExecutionTimeout }
    })
    expect(context.operation.signal.aborted).toBe(true)
    expect(reports).toEqual([])

    const primary = Object.assign(new Error('own coded rejection'), {
      code: PluginHostErrorCode.mutationExecutionTimeout
    })
    const ownGate = deferred<never>()
    const own = host.use(
      definePlugin({ name: 'own', setup: () => ownGate.promise, install: () => ({}) })
    )
    ownGate.reject(primary)
    await expect(own).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: primary
    })
    expect(reports).toEqual([])
    await host.dispose()
  })

  it('A10 closes an expired lazy attempt before rollback and isolates its retry', async () => {
    const { host, scheduler } = createHost(50)
    const firstGate = deferred<void>()
    const cleanupGate = deferred<void>()
    const cleanupStarted = deferred<void>()
    const secondGate = deferred<void>()
    /** Contexts retained across two activation attempts to prove separate signal ownership. */
    const contexts: IPluginSetupContext[] = []
    /** Resources released by rollback, late registration, and successful removal. */
    const released: string[] = []
    const plugin = definePlugin({
      name: 'l',
      activation: 'lazy',
      setup: async (context) => {
        contexts.push(context)
        if (contexts.length === 1) {
          context.onDispose(async () => {
            cleanupStarted.resolve()
            await cleanupGate.promise
            released.push('first')
          })
          await firstGate.promise
          context.onDispose(() => {
            released.push('late-during-rollback')
          })
          return 1
        }
        context.onDispose(() => {
          released.push('second')
        })
        await secondGate.promise
        return 2
      },
      install: (_core, output) => ({ value: output })
    })
    await host.use(plugin)
    const first = host.activate('l')
    await vi.waitFor(() => expect(contexts).toHaveLength(1))
    scheduler.advance(50)
    await cleanupStarted.promise
    firstGate.resolve()
    await vi.waitFor(() => expect(released).toContain('late-during-rollback'))
    expect(released).toContain('late-during-rollback')
    expect(contexts[0].operation.signal.aborted).toBe(true)
    cleanupGate.resolve()
    await expect(first).rejects.toMatchObject({
      code: PluginHostErrorCode.mutationExecutionTimeout
    })
    const second = host.activate('l')
    await vi.waitFor(() => expect(contexts).toHaveLength(2))
    expect(contexts[0].operation.signal).not.toBe(contexts[1].operation.signal)
    expect(contexts[1].operation.signal.aborted).toBe(false)
    expect(() =>
      contexts[0].onDispose(() => {
        released.push('late-after-retry')
      })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.resourceOutsideInstall }))
    secondGate.resolve()
    await second
    await host.unUse('l')
    expect(released).toEqual(['late-during-rollback', 'first', 'late-after-retry', 'second'])
    await host.dispose()
  })
})
