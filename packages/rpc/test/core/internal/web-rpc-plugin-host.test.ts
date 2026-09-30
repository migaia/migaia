import { createManualScheduler, systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { RpcAbortError, RpcTimeoutError } from '../../../src/core/errors.js'
import type { IRpcTransport } from '../../../src/core/transport.js'
import type { IRpcAbortSignal } from '../../../src/core/typing.js'
import {
  createConstructionControl,
  runConstructionInstall
} from '../../../src/core/internal/construction-install.js'
import { raceWithAsyncControl } from '../../../src/core/internal/async-control.js'
import { createEndpointTimePort } from '../../../src/core/internal/time-port.js'
import type { IRpcPluginConstraint } from '../../../src/core/internal/plugin-contract.js'
import {
  RpcPortName,
  type IRpcProtocolPort
} from '../../../src/core/internal/plugin-shared-keys.js'
import {
  createWebRpcPluginHost,
  type IRpcPluginHost
} from '../../../src/core/internal/web-rpc-plugin-host.js'

const transport = {} as IRpcTransport
const signal = new AbortController().signal as IRpcAbortSignal

/**
 * Exercises the host's synchronous primitive without restoring a WebRPC wrapper.
 *
 * The handle takes plugins as rest arguments, as the class's public entry always did; the shell
 * used to reach the `protected` array form through inheritance, which a handle has no way to
 * offer.
 */
const installHostSyncForTest = (
  host: IRpcPluginHost,
  plugins: readonly IRpcPluginConstraint[]
): unknown => host.useSync(...(plugins as never))

describe('B12a WebRPC PluginHost shell', () => {
  it('uses typed shared symbols and one host rollback transaction', async () => {
    let disposed = 0
    let observed: IRpcProtocolPort | undefined
    const host = createWebRpcPluginHost(
      'shell',
      transport,
      createConstructionControl({ time: createEndpointTimePort(systemScheduler), signal }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    )
    const protocolPort: IRpcProtocolPort = {
      encode: (value) => value,
      decode: (value) => value
    }
    const provider: IRpcPluginConstraint = {
      name: 'provider',
      install: (core) => {
        core.publishPortFeatures({
          [RpcPortName.protocol]: { get: () => protocolPort }
        })
        core.onDispose(() => {
          disposed += 1
        })
        return {}
      }
    }
    const consumer: IRpcPluginConstraint = {
      name: 'consumer',
      install: (core) => {
        observed = core.getPort(RpcPortName.protocol) as IRpcProtocolPort | undefined
        return {}
      }
    }
    const failing: IRpcPluginConstraint = {
      name: 'failing',
      install: () => {
        throw new Error('install failure')
      }
    }

    await expect(host.installBatch([provider, consumer, failing])).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED'
    })
    expect(observed).toBe(protocolPort)
    expect(disposed).toBe(1)
    await host.dispose()
  })

  it('closes late ownership at the construction deadline and observes late rejection', async () => {
    /** Completion signals replace elapsed-time guesses about the late install and report. */
    let markReported!: () => void
    const reported = new Promise<void>((resolve) => {
      markReported = resolve
    })
    const report = vi.fn(() => {
      markReported()
      throw new Error('reporter failed')
    })
    const scheduler = createManualScheduler()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let finishInstall!: () => void
    const blocked = new Promise<void>((resolve) => {
      finishInstall = resolve
    })
    let scope: unknown
    let released = 0
    const install = runConstructionInstall(
      {
        id: 'shell',
        transport,
        control: createConstructionControl({
          time: createEndpointTimePort(scheduler),
          signal,
          timeoutMs: 5
        }),
        hooks: () => undefined,
        report,
        registerScope: (registered) => {
          scope = registered
        }
      },
      async (installScope) => {
        markStarted()
        await blocked
        installScope.own({}, () => {
          released += 1
        })
        throw new Error('late install rejection')
      }
    )

    await started
    scheduler.advance(5)
    await expect(install).rejects.toBeInstanceOf(RpcTimeoutError)
    finishInstall()
    await reported
    expect(scope).toBeDefined()
    expect(released).toBe(1)
    expect(report).toHaveBeenCalled()
  })

  it('keeps successful construction resources in the registered scope', async () => {
    let scope: { dispose(): Promise<readonly unknown[]> } | undefined
    let released = 0
    const result = await runConstructionInstall(
      {
        id: 'shell',
        transport,
        control: createConstructionControl({
          time: createEndpointTimePort(systemScheduler),
          signal
        }),
        hooks: () => undefined,
        registerScope: (registered) => {
          scope = registered
        }
      },
      async (installScope) => {
        installScope.own({}, () => {
          released += 1
        })
        return 'installed'
      }
    )
    expect(result).toBe('installed')
    expect(released).toBe(0)
    await scope?.dispose()
    expect(released).toBe(1)
  })

  it('rejects an already-aborted construction signal before plugin work', async () => {
    const controller = new AbortController()
    controller.abort()
    let started = false
    await expect(
      runConstructionInstall(
        {
          id: 'shell',
          transport,
          control: createConstructionControl({
            time: createEndpointTimePort(systemScheduler),
            signal: controller.signal as IRpcAbortSignal
          }),
          hooks: () => undefined,
          registerScope: () => undefined
        },
        () => {
          started = true
          return undefined
        }
      )
    ).rejects.toBeInstanceOf(RpcAbortError)
    expect(started).toBe(false)
  })

  it('rejects invalid construction timeout before subscribing to the source signal', () => {
    const source = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as IRpcAbortSignal

    expect(() =>
      createConstructionControl({
        time: createEndpointTimePort(systemScheduler),
        signal: source,
        timeoutMs: -1
      })
    ).toThrow('timeoutMs must be false or a non-negative finite number')
    expect(source.addEventListener).not.toHaveBeenCalled()
    expect(source.removeEventListener).not.toHaveBeenCalled()
  })

  it('does not subscribe when the injected construction clock throws', () => {
    const clockFailure = new Error('clock failed')
    const endpointTime = createEndpointTimePort(systemScheduler)
    const time = Object.freeze({
      ...endpointTime,
      now: () => {
        throw clockFailure
      }
    })
    const source = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as IRpcAbortSignal

    expect(() => createConstructionControl({ signal: source, timeoutMs: 10, time })).toThrow(
      clockFailure
    )
    expect(source.addEventListener).not.toHaveBeenCalled()
    expect(source.removeEventListener).not.toHaveBeenCalled()
  })

  it('closes construction ownership when injected timer setup fails', async () => {
    const timerFailure = new Error('timer setup failed')
    const endpointTime = createEndpointTimePort(systemScheduler)
    const time = Object.freeze({
      ...endpointTime,
      setTimeout: () => {
        throw timerFailure
      }
    })
    const source = {
      aborted: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as IRpcAbortSignal
    const control = createConstructionControl({ signal: source, timeoutMs: 10, time })
    let registeredScope: { dispose(): Promise<readonly unknown[]> } | undefined
    let started = false

    await expect(
      runConstructionInstall(
        {
          id: 'shell',
          transport,
          control,
          hooks: () => undefined,
          registerScope: (scope) => {
            registeredScope = scope
          }
        },
        () => {
          started = true
          return undefined
        }
      )
    ).rejects.toBe(timerFailure)
    expect(started).toBe(false)
    expect(source.addEventListener).toHaveBeenCalledTimes(1)
    expect(source.removeEventListener).toHaveBeenCalledTimes(1)
    expect(registeredScope).toBeDefined()
    expect(await registeredScope?.dispose()).toEqual([])
  })

  it('contains timer-clear failures and still settles the primary race', async () => {
    const clearFailure = new Error('clear failed')
    const report = vi.fn()
    await expect(
      raceWithAsyncControl({
        operation: async () => 'completed',
        timeoutMs: 10,
        time: {
          setTimeout: () => ({
            clear: () => {
              throw clearFailure
            }
          })
        },
        createTimeoutError: () => new RpcTimeoutError(),
        createAbortError: () => new RpcAbortError(),
        onDiagnostic: report
      })
    ).resolves.toBe('completed')
    expect(report).toHaveBeenCalledWith(clearFailure)
  })

  it('uses one absolute budget across sequential installs and never-settling work', async () => {
    let now = 100
    const endpointTime = createEndpointTimePort(systemScheduler)
    const time = { ...endpointTime, now: () => now }
    const control = createConstructionControl({ signal, timeoutMs: 10, time })
    const first = await runConstructionInstall(
      {
        id: 'shell',
        transport,
        control,
        hooks: () => undefined,
        registerScope: () => undefined
      },
      () => 'first'
    )
    expect(first).toBe('first')
    now = 111
    let started = false
    await expect(
      runConstructionInstall(
        {
          id: 'shell',
          transport,
          control,
          hooks: () => undefined,
          registerScope: () => undefined
        },
        () => {
          started = true
          return 'late'
        }
      )
    ).rejects.toBeInstanceOf(RpcTimeoutError)
    expect(started).toBe(false)

    await expect(
      runConstructionInstall(
        {
          id: 'shell',
          transport,
          control: createConstructionControl({
            time: createEndpointTimePort(systemScheduler),
            signal,
            timeoutMs: 5
          }),
          hooks: () => undefined,
          registerScope: () => undefined
        },
        () => new Promise<never>(() => undefined)
      )
    ).rejects.toBeInstanceOf(RpcTimeoutError)
  })

  it('preserves registration failures and contains diagnostic reporter throws', async () => {
    const registrationFailure = new Error('registration failed')
    const report = vi.fn(() => {
      throw new Error('reporter failed')
    })
    let started = false
    await expect(
      runConstructionInstall(
        {
          id: 'shell',
          transport,
          control: createConstructionControl({
            time: createEndpointTimePort(systemScheduler),
            signal
          }),
          hooks: () => undefined,
          report,
          registerScope: () => {
            throw registrationFailure
          }
        },
        () => {
          started = true
          return undefined
        }
      )
    ).rejects.toBe(registrationFailure)
    expect(started).toBe(false)
  })

  it('closes externally disposed construction scopes before late resolve and ownership', async () => {
    let released = 0
    const control = createConstructionControl({
      time: createEndpointTimePort(systemScheduler),
      signal,
      timeoutMs: 50
    })
    const operation = runConstructionInstall(
      {
        id: 'shell',
        transport,
        control,
        hooks: () => undefined,
        registerScope: () => undefined
      },
      async (scope) => {
        await new Promise((resolve) => setTimeout(resolve, 15))
        scope.own({}, () => {
          released += 1
        })
        return 'late'
      }
    )
    control.close()
    await expect(operation).rejects.toBeInstanceOf(RpcAbortError)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(released).toBe(1)
  })

  it('keeps fixed kernel-to-activation order and prevents activation after rollback', async () => {
    const createHost = (): IRpcPluginHost =>
      createWebRpcPluginHost(
        'shell',
        transport,
        createConstructionControl({ time: createEndpointTimePort(systemScheduler), signal }),
        () => undefined,
        { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
      )
    const successEvents: string[] = []
    let subscriptions = 0
    const role = (events: string[], name: string, install: () => void): IRpcPluginConstraint => ({
      name,
      install: (core) => {
        events.push(name)
        install()
        core.onDispose(() => {
          events.push(`dispose:${name}`)
        })
        return {}
      }
    })
    const successHost = createHost()
    await successHost.installBatch([
      role(successEvents, 'kernel', () => undefined),
      role(successEvents, 'middleware', () => undefined),
      role(successEvents, 'feature', () => undefined),
      role(successEvents, 'activation', () => {
        subscriptions += 1
      })
    ])
    expect(successEvents.slice(0, 4)).toEqual(['kernel', 'middleware', 'feature', 'activation'])
    expect(subscriptions).toBe(1)
    await successHost.dispose()
    expect(successEvents.slice(4)).toEqual([
      'dispose:activation',
      'dispose:feature',
      'dispose:middleware',
      'dispose:kernel'
    ])

    const failedEvents: string[] = []
    const failedHost = createHost()
    await expect(
      failedHost.installBatch([
        role(failedEvents, 'kernel', () => undefined),
        role(failedEvents, 'middleware', () => undefined),
        {
          name: 'feature-failure',
          install: () => {
            failedEvents.push('feature-failure')
            throw new Error('feature failed')
          }
        },
        role(failedEvents, 'activation', () => failedEvents.push('activation'))
      ])
    ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect(failedEvents).toEqual([
      'kernel',
      'middleware',
      'feature-failure',
      'dispose:middleware',
      'dispose:kernel'
    ])
    await failedHost.dispose()
  })

  it('supports direct synchronous PluginHost installation only in the isolated host test', async () => {
    const events: string[] = []
    const host = createWebRpcPluginHost(
      'shell',
      transport,
      createConstructionControl({ time: createEndpointTimePort(systemScheduler), signal }),
      () => undefined,
      { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
    )
    installHostSyncForTest(host, [
      {
        name: 'kernel',
        install: () => {
          events.push('kernel')
          return {}
        }
      },
      {
        name: 'activation',
        install: () => {
          events.push('activation')
          return {}
        }
      }
    ])
    expect(events).toEqual(['kernel', 'activation'])
    await host.dispose()
  })

  it('preserves async and direct-host synchronous rollback identities', async () => {
    const primary = new Error('primary')
    const firstRollback = new Error('first rollback')
    const secondRollback = new Error('second rollback')
    const diagnostic = vi.fn(() => {
      throw new Error('diagnostic')
    })
    const createFailingHost = (): IRpcPluginHost =>
      createWebRpcPluginHost(
        'shell',
        transport,
        createConstructionControl({ time: createEndpointTimePort(systemScheduler), signal }),
        () => undefined,
        { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }, diagnostic }
      )
    const rollbackPlugin = (name: string, error: Error): IRpcPluginConstraint => ({
      name,
      install: (core) => {
        core.onDispose(() => {
          throw error
        })
        return {}
      }
    })

    const asyncHost = createFailingHost()
    let asyncFailure: {
      readonly cause?: unknown
      readonly detail?: { readonly rollbackErrors: readonly unknown[] }
    }
    try {
      await asyncHost.installBatch([
        rollbackPlugin('first', firstRollback),
        rollbackPlugin('second', secondRollback),
        {
          name: 'failed',
          install: () => {
            throw primary
          }
        }
      ])
      throw new Error('expected async install failure')
    } catch (error) {
      asyncFailure = error as typeof asyncFailure
    }
    expect(asyncFailure!.cause).toBe(primary)
    expect(asyncFailure!.detail?.rollbackErrors).toEqual([secondRollback, firstRollback])

    const syncHost = createFailingHost()
    let syncFailure: {
      readonly cause?: unknown
      readonly detail?: {
        readonly rollbackErrors: readonly unknown[]
        readonly completion?: Promise<{ readonly rollbackErrors: readonly unknown[] }>
      }
    }
    try {
      installHostSyncForTest(syncHost, [
        rollbackPlugin('first', firstRollback),
        rollbackPlugin('second', secondRollback),
        {
          name: 'failed',
          install: () => {
            throw primary
          }
        }
      ])
      throw new Error('expected sync install failure')
    } catch (error) {
      syncFailure = error as typeof syncFailure
    }
    expect(syncFailure!.cause).toBe(primary)
    expect(syncFailure!.detail?.rollbackErrors).toEqual([])
    const completed = await syncFailure!.detail?.completion
    expect(completed?.rollbackErrors).toEqual([secondRollback, firstRollback])
  })
})
