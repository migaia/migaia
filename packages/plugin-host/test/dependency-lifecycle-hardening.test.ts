import { describe, expect, it, vi } from 'vitest'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
import { defineFeature, definePlugin, PluginHost, PluginHostErrorCode } from '../src/index.js'
import { execution, createObservedHost } from './dependency-lifecycle-fixtures.js'

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

  it('drains every retired snapshot containing the same owner', async () => {
    /** Executes two versions while their common plugin remains in flight. */
    class PipelineHost extends PluginHost<Record<string, never>, number> {
      run(value: number): Promise<void> {
        return this.runPipeline(value, () => undefined) as Promise<void>
      }
    }
    /** Exact host uses the normal public stage mutation and unregister paths. */
    const host = new PipelineHost({ execution, pipeline: { mode: MiddlewarePipelineMode.async } })
    /** Each run can leave its version independently. */
    const releases = new Map<number, () => void>()
    /** Disposal must wait for both versions, even after the cached version changes. */
    const disposed = vi.fn()
    await host.use(
      definePlugin({
        name: 'A',
        install: (core: any) => {
          core.useAsyncPipeline(async (value: number, next: (value: number) => unknown) => {
            await new Promise<void>((resolve) => {
              releases.set(value, resolve)
            })
            return next(value)
          })
          return {}
        },
        dispose: disposed
      }) as never
    )
    /** First version becomes retired while this run is held. */
    const first = host.run(1)
    await vi.waitFor(() => expect(releases.has(1)).toBe(true))
    await host.use(
      definePlugin({
        name: 'B',
        install: (core: any) => {
          core.useAsyncPipeline(async (value: number, next: (value: number) => unknown) =>
            next(value)
          )
          return {}
        }
      }) as never
    )
    /** New version contains the same plugin and a newly published plugin stage. */
    const second = host.run(2)
    await vi.waitFor(() => expect(releases.has(2)).toBe(true))
    /** Unregister retires the second version and waits for both owner pins. */
    const removing = host.unUse('A')
    await new Promise((resolve) => setTimeout(resolve, 0))
    releases.get(1)!()
    await first
    expect(disposed).not.toHaveBeenCalled()
    releases.get(2)!()
    await second
    await removing
    expect(disposed).toHaveBeenCalledTimes(1)
    await host.dispose()
  })

  it('keeps the previous lease key while a replace candidate stages before publication', async () => {
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

  it('preserves the old lease after a staged replace candidate fails', async () => {
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
