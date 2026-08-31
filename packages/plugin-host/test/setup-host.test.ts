import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/lifecycle'
import { definePlugin, setupHost } from '../src/index.js'
import { PluginHostErrorCode } from '../src/error-code.js'

const hostOptions = {
  execution: { mutationTimeoutMs: 1000, pipelineDrainTimeoutMs: 1000 }
} as const

describe('functional setupHost', () => {
  it('snapshots a defined plugin and publishes one disposable view', async () => {
    const events: string[] = []
    const source = {
      name: 'ready',
      requires: ['core'] as const,
      install(core: { readonly value: number }) {
        expect(core.value).toBe(7)
        expect(this).toBe(source)
        return { ready: true as const }
      },
      dispose() {
        events.push('plugin')
      }
    }
    const plugin = definePlugin(source)
    expect(plugin).not.toBe(source)
    expect(Object.isFrozen(plugin)).toBe(true)
    expect((plugin as typeof plugin & { readonly requires: readonly string[] }).requires).toEqual([
      'core'
    ])

    const app = await setupHost<{ readonly value: number }, readonly [typeof plugin]>({
      host: hostOptions,
      setupTimeoutMs: 1000,
      core: (context) => {
        context.onDispose(() => {
          events.push('core')
        })
        return { value: 7 }
      },
      plugins: [plugin]
    })

    expect(app.extensions.ready).toBe(true)
    expect(Object.isFrozen(app)).toBe(true)
    const result = await app.dispose()
    expect(result.logicalTerminal).toBe(true)
    expect(events).toEqual(['plugin', 'core'])
  })

  it('rejects structural plugins before invoking Core', async () => {
    let coreCalled = false
    const structural = { name: 'raw', install: () => ({}) }
    const setup = setupHost({
      host: hostOptions,
      setupTimeoutMs: 1000,
      core: () => {
        coreCalled = true
        return { value: 1 }
      },
      plugins: [structural] as never
    })

    await expect(setup).rejects.toMatchObject({ code: PluginHostErrorCode.invalidOption })
    expect(coreCalled).toBe(false)
  })

  it('snapshots every setup option once before validation', async () => {
    /** Per-property access counters prove preflight does not replay caller-owned getters. */
    const counts = { host: 0, timeout: 0, core: 0, plugins: 0, signal: 0 }
    /** Trusted definition returned by the first plugins getter observation. */
    const plugin = definePlugin({
      name: 'snapshot',
      install: () => ({ ready: true as const })
    })
    /** Core factory returned by the first core getter observation. */
    const core = () => ({ value: 1 })
    /** Hostile options object whose second getter observation would substitute invalid values. */
    const options = Object.defineProperties(
      {},
      {
        host: {
          enumerable: true,
          get: () => {
            counts.host += 1
            return counts.host === 1 ? hostOptions : { invalid: true }
          }
        },
        setupTimeoutMs: {
          enumerable: true,
          get: () => {
            counts.timeout += 1
            return counts.timeout === 1 ? 1000 : 'invalid'
          }
        },
        core: {
          enumerable: true,
          get: () => {
            counts.core += 1
            return counts.core === 1 ? core : () => null
          }
        },
        plugins: {
          enumerable: true,
          get: () => {
            counts.plugins += 1
            return counts.plugins === 1 ? [plugin] : [{ invalid: true }]
          }
        },
        signal: {
          enumerable: true,
          get: () => {
            counts.signal += 1
            return counts.signal === 1 ? undefined : { aborted: true }
          }
        }
      }
    ) as never

    const app = await setupHost(options)
    expect(app.extensions.ready).toBe(true)
    expect(counts).toEqual({ host: 1, timeout: 1, core: 1, plugins: 1, signal: 1 })
    await app.dispose()
  })

  it('snapshots the Host scheduler once and applies one absolute setup deadline', async () => {
    const scheduler = createManualScheduler()
    let schedulerReads = 0
    const hostileHost = Object.defineProperties(
      {},
      {
        execution: { value: hostOptions.execution, enumerable: true },
        scheduler: {
          enumerable: true,
          get: () => {
            schedulerReads += 1
            return scheduler
          }
        }
      }
    ) as never
    let resolveCore!: (value: { readonly value: number }) => void
    const core = new Promise<{ readonly value: number }>((resolve) => {
      resolveCore = resolve
    })
    const setup = setupHost({
      host: hostileHost,
      setupTimeoutMs: 10,
      core: () => core
    })
    await Promise.resolve()
    scheduler.advance(10)
    await expect(setup).rejects.toMatchObject({ code: PluginHostErrorCode.hostSetupTimeout })
    resolveCore({ value: 1 })
    await Promise.resolve()
    expect(schedulerReads).toBe(1)
  })

  it('PHV3-T19: closes the external listener on success, failure, timeout, and abort', async () => {
    /** Builds a hostile-signal-shaped fixture with observable registration and cleanup. */
    const createSignal = () => {
      let aborted = false
      let reason: unknown
      let listener: (() => void) | undefined
      let addCount = 0
      let removeCount = 0
      let abortedReads = 0
      const signal = {
        get aborted() {
          abortedReads += 1
          return aborted
        },
        get reason() {
          return reason
        },
        addEventListener: (_type: 'abort', next: () => void) => {
          addCount += 1
          listener = next
        },
        removeEventListener: (_type: 'abort', next: () => void) => {
          removeCount += 1
          if (listener === next) listener = undefined
        }
      }
      return {
        signal,
        abort: (nextReason: unknown) => {
          reason = nextReason
          aborted = true
          listener?.()
        },
        counts: () => ({ addCount, removeCount, abortedReads })
      }
    }
    const run = async (kind: 'success' | 'failure' | 'timeout' | 'abort') => {
      const scheduler = createManualScheduler()
      const counted = createSignal()
      const setup = setupHost({
        host: {
          ...hostOptions,
          scheduler
        },
        setupTimeoutMs: kind === 'timeout' || kind === 'abort' ? 10 : false,
        signal: counted.signal,
        core:
          kind === 'failure'
            ? () => {
                throw new TypeError('core failure')
              }
            : kind === 'success'
              ? () => ({ value: 1 })
              : () => new Promise(() => {})
      })
      if (kind === 'success') {
        const app = await setup
        await app.dispose()
      } else if (kind === 'failure') {
        await expect(setup).rejects.toMatchObject({ code: PluginHostErrorCode.hostCoreSetupFailed })
      } else if (kind === 'timeout') {
        await Promise.resolve()
        scheduler.advance(10)
        await expect(setup).rejects.toMatchObject({ code: PluginHostErrorCode.hostSetupTimeout })
      } else {
        counted.abort('caller stop')
        await expect(setup).rejects.toMatchObject({ code: PluginHostErrorCode.hostSetupAborted })
      }
      expect(counted.counts()).toEqual({ addCount: 1, removeCount: 1, abortedReads: 1 })
    }
    await run('failure')
    await run('success')
    await run('timeout')
    await run('abort')
  })

  it('PHV3-T19: uses one completion for hostile thenables and preserves first race reason', async () => {
    let installCount = 0
    let thenCallCount = 0
    const plugin = definePlugin<{ readonly value: number }>('thenable-once', () => {
      installCount += 1
      return {}
    })
    const hostileCore = Object.create(null) as Record<string, unknown>
    const thenProperty = ['t', 'h', 'e', 'n'].join('')
    Object.defineProperty(hostileCore, thenProperty, {
      value: (
        resolve: (value: { readonly value: number }) => void,
        reject: (error: unknown) => void
      ) => {
        thenCallCount += 1
        resolve({ value: 1 })
        resolve({ value: 2 })
        reject(new Error('late thenable rejection'))
      }
    })
    const app = await setupHost({
      host: hostOptions,
      setupTimeoutMs: false,
      core: () => hostileCore as unknown as { readonly value: number },
      plugins: [plugin]
    })
    expect(installCount).toBe(1)
    expect(thenCallCount).toBe(1)
    await app.dispose()

    const createSignal = () => {
      let aborted = false
      let listener: (() => void) | undefined
      const signal = {
        get aborted() {
          return aborted
        },
        reason: 'caller stop',
        addEventListener: (_type: 'abort', next: () => void) => {
          listener = next
        },
        removeEventListener: (_type: 'abort', next: () => void) => {
          if (listener === next) listener = undefined
        }
      }
      return {
        signal,
        abort: () => {
          aborted = true
          listener?.()
        }
      }
    }
    const abortFirst = createSignal()
    const abortScheduler = createManualScheduler()
    const abortSetup = setupHost({
      host: { ...hostOptions, scheduler: abortScheduler },
      setupTimeoutMs: 10,
      signal: abortFirst.signal,
      core: () => new Promise(() => {})
    })
    abortFirst.abort()
    await expect(abortSetup).rejects.toMatchObject({ code: PluginHostErrorCode.hostSetupAborted })

    const timeoutFirst = createSignal()
    const timeoutScheduler = createManualScheduler()
    const timeoutSetup = setupHost({
      host: { ...hostOptions, scheduler: timeoutScheduler },
      setupTimeoutMs: 10,
      signal: timeoutFirst.signal,
      core: () => new Promise(() => {})
    })
    await Promise.resolve()
    timeoutScheduler.advance(10)
    timeoutFirst.abort()
    await expect(timeoutSetup).rejects.toMatchObject({
      code: PluginHostErrorCode.hostSetupTimeout
    })
  })

  it('PHV3-T19: observes a late Core rejection after the absolute deadline', async () => {
    let rejectCore!: (error: unknown) => void
    const scheduler = createManualScheduler()
    const setup = setupHost({
      host: { ...hostOptions, scheduler },
      setupTimeoutMs: 10,
      core: () =>
        new Promise<never>((_, reject) => {
          rejectCore = reject
        })
    })
    await Promise.resolve()
    scheduler.advance(10)
    await expect(setup).rejects.toMatchObject({ code: PluginHostErrorCode.hostSetupTimeout })
    rejectCore(new Error('late core rejection'))
    await Promise.resolve()
    await Promise.resolve()
  })

  it('PHV3-T19: carries one deadline from Core into the initial plugin batch', async () => {
    let resolveCore!: (value: { readonly value: number }) => void
    const scheduler = createManualScheduler()
    const setup = setupHost({
      host: { ...hostOptions, scheduler },
      setupTimeoutMs: 10,
      core: () =>
        new Promise<{ readonly value: number }>((resolve) => {
          resolveCore = resolve
        }),
      plugins: [
        definePlugin<{ readonly value: number }, Record<string, never>>(
          'batch-pending',
          () => new Promise<Record<string, never>>(() => {})
        )
      ]
    })
    await Promise.resolve()
    scheduler.advance(6)
    resolveCore({ value: 1 })
    await Promise.resolve()
    await Promise.resolve()
    scheduler.advance(4)
    await expect(setup).rejects.toMatchObject({ code: PluginHostErrorCode.hostSetupTimeout })
  })

  it('PHV3-T19: suppresses later plugins after a timed-out pending install', async () => {
    let laterInstallCount = 0
    let resolvePending!: (value: Record<string, never> | PromiseLike<Record<string, never>>) => void
    const pending = definePlugin<{ readonly value: number }, Record<string, never>>(
      'pending-install',
      () =>
        new Promise<Record<string, never>>((resolve) => {
          resolvePending = resolve
        })
    )
    const later = definePlugin<{ readonly value: number }>('later-install', () => {
      laterInstallCount += 1
      return {}
    })
    const scheduler = createManualScheduler()
    const setup = setupHost<{ readonly value: number }, readonly [typeof pending, typeof later]>({
      host: {
        execution: { mutationTimeoutMs: 10, pipelineDrainTimeoutMs: false },
        scheduler
      },
      setupTimeoutMs: 10,
      core: () => ({}) as { readonly value: number },
      plugins: [pending, later]
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(resolvePending).toBeTypeOf('function')
    scheduler.advance(10)
    resolvePending({})
    await Promise.resolve()
    scheduler.advance(10)
    const rejection = await setup.then(
      () => undefined,
      (error: unknown) => error
    )
    expect(rejection).toBeDefined()
    const primaryCodes = [
      rejection && typeof rejection === 'object' && 'code' in rejection
        ? (rejection as { readonly code?: unknown }).code
        : undefined,
      ...(rejection && typeof rejection === 'object' && 'errors' in rejection
        ? ((rejection as { readonly errors?: readonly unknown[] }).errors ?? []).map((error) =>
            error && typeof error === 'object' && 'code' in error
              ? (error as { readonly code?: unknown }).code
              : undefined
          )
        : [])
    ]
    expect(primaryCodes).toContain(PluginHostErrorCode.hostSetupTimeout)
    expect(laterInstallCount).toBe(0)
  })
})
