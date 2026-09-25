import { describe, expect, it, vi } from 'vitest'
import { openComposition } from '../src/composition-entry.js'
import {
  defineFeature,
  definePlugin,
  PluginHost,
  PluginHostErrorCode,
  MiddlewarePipelineMode,
  type IPluginConstraint
} from '../src/index.js'

/** Unbounded execution budgets keep lifecycle timing out of dependency assertions. */
const execution = { mutationTimeoutMs: false as const, pipelineDrainTimeoutMs: false as const }

/** One recorded host diagnostic, including the structured error the host reported. */
type IDiagnosticRecord = Readonly<{ message: string; code: unknown; error: unknown }>

/** Creates a host whose diagnostic outlet records every structured report. */
const createObservedHost = (): {
  host: PluginHost<Record<string, never>>
  seen: IDiagnosticRecord[]
} => {
  const seen: IDiagnosticRecord[] = []
  const host = new PluginHost<Record<string, never>>({
    execution,
    diagnostic: (message, code, error) => {
      seen.push({ message, code, error })
    }
  })
  return { host, seen }
}

/** Creates provider A and a consumer that requires A's `value` Feature. */
const createRequiredPair = (options: { lazyProvider?: boolean; consumerName?: string } = {}) => {
  const value = defineFeature(() => ({ value: 1 }))
  const provider = definePlugin({
    name: 'A',
    activation: options.lazyProvider ? 'lazy' : 'eager',
    features: { value },
    install: () => ({ readA: () => 'A' })
  })
  const consumer = definePlugin({
    name: options.consumerName ?? 'B',
    features: {
      use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
        value: provider.getFeature('value')
      })
    },
    install: () => ({ readB: () => 'B' })
  })
  return { provider, consumer }
}

/** Exposes protected constructor-time installation to lazy-provider tests. */
class SyncHost extends PluginHost<Record<string, never>> {
  /** Runs the synchronous installation path against the current committed registrations. */
  installNow(plugins: readonly IPluginConstraint<any>[]): unknown {
    return this.useSync(plugins)
  }
}

describe('hot replacement transaction', () => {
  it('finishes replacement and reports every original error when a dependent restart fails', async () => {
    const { host } = createObservedHost()
    const value = defineFeature(() => ({ value: 1 }))
    const previousDispose = vi.fn()
    const previous = definePlugin({
      name: 'A',
      features: { value },
      install: () => ({ version: () => 1 }),
      dispose: previousDispose
    })
    const next = definePlugin({
      name: 'A',
      features: { value },
      install: () => ({ version: () => 2 })
    })
    const restartFailure = new Error('restart failed')
    let installs = 0
    const dependent = definePlugin({
      name: 'C',
      features: {
        use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
          value: previous.getFeature('value')
        })
      },
      install: () => {
        installs += 1
        if (installs > 1) throw restartFailure
        return {}
      }
    })
    const [providerHandle, dependentHandle] = await host.use(previous, dependent)
    const revision = host.revision

    const failure = await host.replace('A', next).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: PluginHostErrorCode.dependentRestartFailed })
    const cause = (failure as Error).cause as AggregateError
    expect(cause).toBeInstanceOf(AggregateError)
    expect((cause.errors[0] as Error).cause).toBe(restartFailure)
    expect(previousDispose).toHaveBeenCalledTimes(1)
    expect(providerHandle.extensions.version()).toBe(2)
    expect(() => dependentHandle.extensions).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.pluginNotInstalled })
    )
    expect(host.revision).toBeGreaterThan(revision)
  })

  it('reports replacement cleanup failures with their original error object', async () => {
    const { host, seen } = createObservedHost()
    const cleanupFailure = new Error('old dispose failed')
    await host.use(
      definePlugin({
        name: 'A',
        install: () => ({}),
        dispose: () => {
          throw cleanupFailure
        }
      })
    )
    await host.replace('A', definePlugin({ name: 'A', install: () => ({}) }))
    const reported = seen.find((record) => record.code === PluginHostErrorCode.cleanupIncomplete)
    expect(reported).toBeDefined()
    /** Walks cause and AggregateError branches until the original cleanup failure is found. */
    const reaches = (value: unknown, depth = 0): boolean => {
      if (value === cleanupFailure) return true
      if (!value || typeof value !== 'object' || depth > 8) return false
      const errors = value instanceof AggregateError ? value.errors : []
      return [(value as { cause?: unknown }).cause, ...errors].some((next) =>
        reaches(next, depth + 1)
      )
    }
    expect(reaches(reported!.error)).toBe(true)
  })

  it('drains pipeline leases held by the previous registration before disposing it', async () => {
    class PipelineHost extends PluginHost<Record<string, never>, number> {
      /** Executes the live async pipeline for lease observations. */
      run(value: number): unknown {
        return this.runPipeline(value, () => undefined)
      }
    }
    const host = new PipelineHost({ execution, pipeline: { mode: MiddlewarePipelineMode.async } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let started!: () => void
    const stageStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const previousDispose = vi.fn()
    await host.use(
      definePlugin({
        name: 'A',
        install: (core: any) => {
          core.useAsyncPipeline(async (value: number, next: (value: number) => unknown) => {
            started()
            await gate
            return next(value)
          })
          return {}
        },
        dispose: previousDispose
      }) as never
    )
    const running = host.run(1)
    await stageStarted
    const replacing = host.replace('A', definePlugin({ name: 'A', install: () => ({}) }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(previousDispose).not.toHaveBeenCalled()
    release()
    await running
    await replacing
    expect(previousDispose).toHaveBeenCalledTimes(1)
  })

  it('A23 keeps the previous lease key while a replace candidate stages before publication', async () => {
    class PipelineHost extends PluginHost<Record<string, never>, number> {
      run(): Promise<void> {
        return this.runPipeline(1, () => undefined) as Promise<void>
      }
    }
    const host = new PipelineHost({ execution, pipeline: { mode: MiddlewarePipelineMode.async } })
    /** Holds a run in the old stage after candidate registration but before publication. */
    let releaseRun!: () => void
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    let enteredRun!: () => void
    const runStarted = new Promise<void>((resolve) => {
      enteredRun = resolve
    })
    /** Holds candidate publication until the old run owns its lease. */
    let releaseInstall!: () => void
    const installGate = new Promise<void>((resolve) => {
      releaseInstall = resolve
    })
    let enteredInstall!: () => void
    const installStarted = new Promise<void>((resolve) => {
      enteredInstall = resolve
    })
    const oldDispose = vi.fn()
    await host.use(
      definePlugin({
        name: 'A',
        install: (core: any) => {
          core.useAsyncPipeline(async (value: number, next: (value: number) => unknown) => {
            enteredRun()
            await runGate
            return next(value)
          })
          return {}
        },
        dispose: oldDispose
      }) as never
    )
    const replacing = host.replace(
      'A',
      definePlugin({
        name: 'A',
        install: async (core: any) => {
          core.useAsyncPipeline(async (value: number, next: (value: number) => unknown) =>
            next(value)
          )
          enteredInstall()
          await installGate
          return {}
        }
      })
    )
    await installStarted
    const running = host.run()
    await runStarted
    releaseInstall()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(oldDispose).not.toHaveBeenCalled()
    releaseRun()
    await running
    await replacing
    expect(oldDispose).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('A23 preserves the old lease after a staged replace candidate fails', async () => {
    class PipelineHost extends PluginHost<Record<string, never>, number> {
      run(): Promise<void> {
        return this.runPipeline(1, () => undefined) as Promise<void>
      }
    }
    const host = new PipelineHost({ execution, pipeline: { mode: MiddlewarePipelineMode.async } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const oldDispose = vi.fn()
    await host.use(
      definePlugin({
        name: 'A',
        install: (core: any) => {
          core.useAsyncPipeline(async (value: number, next: (value: number) => unknown) => {
            entered()
            await gate
            return next(value)
          })
          return {}
        },
        dispose: oldDispose
      }) as never
    )
    const installFailure = new Error('candidate failed')
    await expect(
      host.replace(
        'A',
        definePlugin({
          name: 'A',
          install: (core: any) => {
            core.useAsyncPipeline(async (value: number, next: (value: number) => unknown) =>
              next(value)
            )
            throw installFailure
          }
        })
      )
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.pluginInstallFailed,
      cause: installFailure
    })
    const running = host.run()
    await started
    const removing = host.unUse('A')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(oldDispose).not.toHaveBeenCalled()
    release()
    await running
    await removing
    expect(oldDispose).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('keeps a restarted dependent runtime config instead of its definition default', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const value = defineFeature(() => ({ value: 1 }))
    const previous = definePlugin({ name: 'A', features: { value }, install: () => ({}) })
    const seenLevels: unknown[] = []
    await host.use(
      previous,
      definePlugin({
        name: 'B',
        config: { level: 'default' },
        features: {
          use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
            value: previous.getFeature('value')
          })
        },
        install: (core: any) => {
          seenLevels.push(core.config.get().level)
          return {}
        }
      }) as never
    )
    await host.config.update('B' as never, () => ({ level: 'runtime' }) as never)
    await host.replace('A', definePlugin({ name: 'A', features: { value }, install: () => ({}) }))
    expect(seenLevels).toEqual(['default', 'runtime'])
    expect((host.config.get('B' as never) as { level: string }).level).toBe('runtime')
  })

  it('reports the exact rebind hook failure object and restarts that dependent', async () => {
    const { host, seen } = createObservedHost()
    const value = defineFeature(() => ({ value: 1 }))
    const previous = definePlugin({ name: 'A', features: { value }, install: () => ({}) })
    const hookFailure = new Error('hook failed')
    const hook = vi.fn(() => {
      throw hookFailure
    })
    const dependentDispose = vi.fn()
    await host.use(
      previous,
      definePlugin({
        name: 'B',
        features: {
          use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
            value: previous.getFeature('value')
          })
        },
        install: () => ({}),
        onDependencyReplaced: hook,
        dispose: dependentDispose
      })
    )
    await host.replace('A', definePlugin({ name: 'A', features: { value }, install: () => ({}) }))
    expect(hook).toHaveBeenCalledTimes(1)
    expect(seen.some((record) => record.error === hookFailure)).toBe(true)
    expect(dependentDispose).toHaveBeenCalledTimes(1)
  })
})

describe('Feature rejection reporting through the host outlet', () => {
  it('delivers the rejection object with the reporter failure reachable and preserves its own cause', async () => {
    const originalCause = new Error('original cause')
    const rejection = new Error('feature rejected', { cause: originalCause })
    const reporterFailure = new Error('reporter failed')
    const seen: unknown[] = []
    let calls = 0
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: (_message, _code, error) => {
        calls += 1
        if (calls === 1) throw reporterFailure
        seen.push(error)
      }
    })
    await expect(
      host.use(
        definePlugin({
          name: 'rejecting',
          features: { invalid: defineFeature((() => Promise.reject(rejection)) as never) },
          install: () => ({})
        })
      )
    ).rejects.toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rejection.cause).toBe(originalCause)
    expect(seen).toHaveLength(1)
    const reported = seen[0] as Error
    const branches = [
      reported,
      reported.cause,
      ...((reported.cause as AggregateError)?.errors ?? [])
    ]
    expect(branches).toContain(rejection)
    expect(branches).toContain(reporterFailure)
  })
})

describe('diagnostic outlet failures', () => {
  it('routes a throwing diagnostic outlet to onDiagnosticFailure with the exact failure', async () => {
    const outletFailure = new Error('outlet failed')
    const failures: unknown[] = []
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: () => {
        throw outletFailure
      },
      onDiagnosticFailure: (error) => {
        failures.push(error)
      }
    })
    await host.use(
      definePlugin({
        name: 'A',
        install: () => ({}),
        dispose: () => {
          throw new Error('old dispose failed')
        }
      })
    )
    await host.replace('A', definePlugin({ name: 'A', install: () => ({}) }))
    expect(failures).toContain(outletFailure)
  })

  it('routes the second reporter failure of a Feature rejection to onDiagnosticFailure', async () => {
    const outletFailure = new Error('outlet always fails')
    const failures: unknown[] = []
    const host = new PluginHost<Record<string, never>>({
      execution,
      diagnostic: () => {
        throw outletFailure
      },
      onDiagnosticFailure: (error) => {
        failures.push(error)
      }
    })
    await expect(
      host.use(
        definePlugin({
          name: 'rejecting',
          features: {
            invalid: defineFeature((() => Promise.reject(new Error('rejected'))) as never)
          },
          install: () => ({})
        })
      )
    ).rejects.toBeDefined()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(failures).toEqual([outletFailure])
  })

  it('rejects a non-function onDiagnosticFailure as INVALID_OPTION', () => {
    expect(
      () => new PluginHost<Record<string, never>>({ execution, onDiagnosticFailure: 1 as never })
    ).toThrow(expect.objectContaining({ code: PluginHostErrorCode.invalidOption }))
  })
})

describe('enablement prerequisites', () => {
  it('rejects enabling a dependent while its required provider stays disabled', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider, consumer } = createRequiredPair()
    await host.use(provider, consumer)
    await host.plugin.disable('A', { policy: 'cascade' })
    await expect(host.plugin.enable('B')).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteDisabled
    })
    expect(host.plugin.disabled()).toEqual(expect.arrayContaining(['A', 'B']))
  })
})

describe('dependency validation codes', () => {
  it('throws the dependency code itself rather than an install wrapper', async () => {
    const missing = createRequiredPair()
    await expect(
      new PluginHost<Record<string, never>>({ execution }).use(missing.consumer)
    ).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteMissing
    })

    const disabled = createRequiredPair()
    const disabledHost = new PluginHost<Record<string, never>>({ execution })
    await disabledHost.use(disabled.provider)
    await disabledHost.plugin.disable('A')
    await expect(disabledHost.use(disabled.consumer)).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteDisabled
    })

    const removed = createRequiredPair()
    const removedHost = new PluginHost<Record<string, never>>({ execution })
    await removedHost.use(removed.provider)
    await removedHost.unUse('A')
    await expect(removedHost.use(removed.consumer)).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteRemoved
    })
    await removedHost.use(removed.provider)
    await expect(removedHost.use(removed.consumer)).resolves.toHaveLength(1)
  })

  it('names the missing Feature in the prerequisite message', async () => {
    const { consumer } = createRequiredPair()
    await expect(
      new PluginHost<Record<string, never>>({ execution }).use(consumer)
    ).rejects.toThrow(/value/)
  })
})

describe('post-install graph stays acyclic', () => {
  it('rejects a member that closes a cycle through a committed optional edge', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const bValue = defineFeature(() => ({ b: true }))
    const bSeed = definePlugin({ name: 'B', features: { value: bValue }, install: () => ({}) })
    const a = definePlugin({
      name: 'A',
      features: {
        value: defineFeature(() => ({ a: true }), {
          b: bSeed.getFeature('value', { optional: true })
        })
      },
      install: () => ({})
    })
    await host.use(a)
    const b = definePlugin({
      name: 'B',
      features: { value: defineFeature(() => ({ b: true }), { a: a.getFeature('value') }) },
      install: () => ({})
    })
    await expect(host.use(b)).rejects.toMatchObject({ code: PluginHostErrorCode.dependencyCycle })
    await expect(host.dispose()).resolves.toBeDefined()
  })

  it('rejects a replacement that closes a cycle and keeps the previous provider serving', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider, consumer } = createRequiredPair()
    const [providerHandle] = await host.use(provider, consumer)
    const cyclic = definePlugin({
      name: 'A',
      features: {
        value: defineFeature(() => ({ value: 2 }), { use: consumer.getFeature('use') })
      },
      install: () => ({ readA: () => 'A2' })
    })
    await expect(host.replace('A', cyclic)).rejects.toMatchObject({
      code: PluginHostErrorCode.dependencyCycle
    })
    expect(providerHandle.extensions.readA()).toBe('A')
  })
})

describe('dependency plans', () => {
  it('lists every transitive required dependent as blockers', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider, consumer } = createRequiredPair()
    const leaf = definePlugin({
      name: 'C',
      features: {
        leaf: defineFeature(() => ({ leaf: true }), { use: consumer.getFeature('use') })
      },
      install: () => ({})
    })
    await host.use(provider, consumer, leaf)
    await expect(host.unUse('A')).rejects.toMatchObject({
      code: PluginHostErrorCode.dependencyBlocked,
      detail: { blockedBy: ['C', 'B'] }
    })
    await expect(host.plugin.disable('A')).rejects.toMatchObject({
      detail: { blockedBy: ['C', 'B'] }
    })
  })

  it('labels optional edges and absent optional providers', async () => {
    const value = defineFeature(() => ({ value: 1 }))
    const provider = definePlugin({ name: 'A', features: { value }, install: () => ({}) })
    const consumer = definePlugin({
      name: 'B',
      features: {
        use: defineFeature(
          (_core, dependencies) => ({ present: dependencies.value !== undefined }),
          {
            value: provider.getFeature('value', { optional: true })
          }
        )
      },
      install: () => ({})
    })
    const present = new PluginHost<Record<string, never>>({ execution })
    await present.use(provider, consumer)
    expect((await present.unUse('A', { dryRun: true })).edges).toEqual([
      { provider: 'A', consumer: 'B', optional: true }
    ])
    const absent = new PluginHost<Record<string, never>>({ execution })
    await absent.use(consumer)
    expect((await absent.unUse('B', { dryRun: true })).edges).toEqual([
      { provider: 'A', consumer: 'B', optional: true, status: 'optional-absent' }
    ])
  })
})

describe('managed removal respects dependency edges', () => {
  it('rejects a managed removal that leaves a required dependent behind', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const composition = openComposition(host)
    const { provider, consumer } = createRequiredPair()
    const prepared = await composition.prepareAdmissions([
      {
        admission: composition.createPluginAdmission(provider as never),
        slot: composition.createDataOrderSlot('A')
      },
      {
        admission: composition.createPluginAdmission(consumer as never),
        slot: composition.createDataOrderSlot('B')
      }
    ])
    const [providerReceipt, consumerReceipt] = composition.commitPreparedAdmissions(prepared)
    expect(() => composition.prepareUnUseBatch([providerReceipt!])).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.dependencyBlocked })
    )
    const removal = await composition.commitPreparedUnUseBatch(
      composition.prepareUnUseBatch([providerReceipt!, consumerReceipt!]),
      { beforeCleanup: Promise.resolve() }
    )
    expect(removal.leaves.map((leaf) => leaf.name)).toEqual(['B', 'A'])
  })
})

describe('lazy activation boundaries', () => {
  it('does not activate a lazy provider when dependency validation fails', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const install = vi.fn(() => ({}))
    const value = defineFeature(() => ({ value: 1 }))
    const lazy = definePlugin({ name: 'L', activation: 'lazy', features: { value }, install })
    const absent = definePlugin({ name: 'X', features: { value }, install: () => ({}) })
    await host.use(lazy)
    const consumer = definePlugin({
      name: 'M',
      features: {
        use: defineFeature(() => ({ ok: true }), {
          lazy: lazy.getFeature('value'),
          absent: absent.getFeature('value')
        })
      },
      install: () => ({})
    })
    await expect(host.use(consumer)).rejects.toMatchObject({
      code: PluginHostErrorCode.prerequisiteMissing
    })
    expect(install).not.toHaveBeenCalled()
  })

  it('keeps lazy consumers lazy and activates lazy providers before explicit activation', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const order: string[] = []
    const value = defineFeature(() => ({ value: 1 }))
    const provider = definePlugin({
      name: 'L2',
      activation: 'lazy',
      features: { value },
      install: () => {
        order.push('L2')
        return {}
      }
    })
    const consumer = definePlugin({
      name: 'L1',
      activation: 'lazy',
      features: {
        use: defineFeature((_core, dependencies) => ({ value: dependencies.value.value }), {
          value: provider.getFeature('value')
        })
      },
      install: () => {
        order.push('L1')
        return {}
      }
    })
    await host.use(provider)
    await host.use(consumer)
    expect(order).toEqual([])
    await host.activate('L1')
    expect(order).toEqual(['L2', 'L1'])
  })

  it('keeps lazy batch members inactive when only lazy members require them', async () => {
    const host = new PluginHost<Record<string, never>>({ execution })
    const { provider } = createRequiredPair({ lazyProvider: true })
    const lazyConsumer = definePlugin({
      name: 'B',
      activation: 'lazy',
      features: {
        use: defineFeature(() => ({ ok: true }), { value: provider.getFeature('value') })
      },
      install: () => ({})
    })
    const [providerHandle] = await host.use(provider, lazyConsumer)
    expect(() => providerHandle.extensions).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.pluginNotActivated })
    )
  })

  it('reports an inactive committed lazy provider on the synchronous path', async () => {
    const host = new SyncHost({ execution })
    const { provider, consumer } = createRequiredPair({ lazyProvider: true })
    await host.use(provider)
    expect(() => host.installNow([consumer])).toThrow(
      expect.objectContaining({ code: PluginHostErrorCode.pluginNotActivated })
    )
  })
})
