import { createRuntime } from '@migaia/reactive'
import { createManualScheduler, type IAbortSignal } from '@migaia/lifecycle'
import { Resource } from '@migaia/resource'
import { describe, expect, it, vi } from 'vitest'
import { memoryReactive } from '../../src/plugins/reactive/memory.js'
import { createStorageHost } from '../../src/host/index.js'
import { createStorageReactiveService } from '../../src/host/reactive.js'
import { getBackendReactiveController } from '../../src/backends/reactive-controller.js'
import { memoryStorage } from '../../src/backends/memory.js'

/** R11 proves Host query state is Resource-owned and backend changes trigger authoritative refresh. */
describe('SWV4-B05 R11 Resource-backed queries', () => {
  it('uses caller runtime, refreshes after one backend invalidation, and disposes idempotently', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-memory' })] as const
    })
    const runtime = createRuntime()
    let reads = 0
    const query = host.liveQuery({
      backendId: 'r11-memory',
      runtime,
      query: async ({ store, signal }) => {
        expect(signal.aborted).toBe(false)
        reads += 1
        return store.get('r11-value')
      }
    })

    await query.ready
    expect(query.state.value.value).toBeNull()
    expect(reads).toBe(1)

    await host.backend('r11-memory').set('r11-value', 'updated')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(query.state.value.value).toBe('updated')
    expect(reads).toBe(2)

    const firstDispose = query.dispose()
    expect(query.dispose()).toBe(firstDispose)
    await firstDispose
    await host.dispose()
  })

  it('snapshots every admitted option once and preserves equal settled identity', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-options' })] as const
    })
    const runtime = createRuntime()
    const reads: Record<string, number> = {}
    const read = <T>(name: string, value: T): T => {
      reads[name] = (reads[name] ?? 0) + 1
      return value
    }
    let queryReads = 0
    const query = host.liveQuery({
      get backendId() {
        return read('backendId', 'r11-options' as const)
      },
      get runtime() {
        return read('runtime', runtime)
      },
      get query() {
        return read('query', () => ({ value: ++queryReads }))
      },
      get scope() {
        return read('scope', 'r11-options-scope')
      },
      get matches() {
        return read('matches', () => true)
      },
      get keepPreviousData() {
        return read('keepPreviousData', true)
      },
      get equals() {
        return read('equals', () => true)
      },
      get timeoutMs() {
        return read('timeoutMs', undefined)
      },
      get signal() {
        return read('signal', undefined)
      },
      get report() {
        return read('report', undefined)
      }
    })
    await query.ready
    const first = query.state.value.value
    await host.backend('r11-options').set('r11-options-key', 'changed')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(query.state.value.value).toBe(first)
    expect(queryReads).toBe(2)
    expect(reads).toEqual({
      backendId: 1,
      runtime: 1,
      query: 1,
      scope: 1,
      matches: 1,
      keepPreviousData: 1,
      equals: 1,
      timeoutMs: 1,
      signal: 1,
      report: 1
    })
    await query.dispose()
    await host.dispose()
  })

  it('uses the Host scheduler for a per-query deadline and does not start after pre-abort', async () => {
    const scheduler = createManualScheduler()
    const host = await createStorageHost({
      scheduler,
      plugins: [memoryReactive({ id: 'r11-deadline' })] as const
    })
    const runtime = createRuntime()
    const pending = new Promise<string>(() => undefined)
    const query = host.liveQuery({
      backendId: 'r11-deadline',
      runtime,
      timeoutMs: 10,
      query: () => pending
    })
    scheduler.advance(10)
    await expect(query.ready).rejects.toBeDefined()
    await query.dispose()
    await host.dispose()

    const controller = new AbortController()
    controller.abort('pre-aborted')
    const secondHost = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-pre-abort' })] as const
    })
    expect(() =>
      secondHost.liveQuery({
        backendId: 'r11-pre-abort',
        runtime,
        signal: controller.signal,
        query: () => 'never-started'
      })
    ).toThrow()
    await secondHost.dispose()
  })

  it('registers external abort before Resource allocation and rolls back on hostile registration', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-abort-admission' })] as const
    })
    const runtime = createRuntime()
    const computedFactory = vi.spyOn(runtime, 'computed')
    let queryReads = 0
    const registrationFailure = {
      aborted: false,
      addEventListener: () => {
        throw new Error('listener registration failed')
      },
      removeEventListener: () => undefined
    } as unknown as IAbortSignal

    expect(() =>
      host.liveQuery({
        backendId: 'r11-abort-admission',
        runtime,
        signal: registrationFailure,
        query: () => {
          queryReads += 1
          return 'must-not-start'
        }
      })
    ).toThrow()
    expect(queryReads).toBe(0)
    expect(computedFactory).not.toHaveBeenCalled()
    computedFactory.mockClear()
    const resourceDispose = vi.spyOn(Resource.prototype, 'dispose')

    let listener: (() => void) | undefined
    let aborted = false
    const abortDuringQuery: IAbortSignal = {
      get aborted() {
        return aborted
      },
      get reason() {
        return 'sync-query-abort'
      },
      addEventListener: (_type, callback) => {
        listener = callback
      },
      removeEventListener: () => undefined
    }
    expect(() =>
      host.liveQuery({
        backendId: 'r11-abort-admission',
        runtime,
        signal: abortDuringQuery,
        query: () => {
          queryReads += 1
          aborted = true
          listener?.()
          return 'aborted-before-settlement'
        }
      })
    ).toThrow()
    expect(queryReads).toBe(1)
    expect(computedFactory).toHaveBeenCalledTimes(1)
    expect(resourceDispose).toHaveBeenCalledTimes(1)
    computedFactory.mockRestore()
    resourceDispose.mockRestore()
    await host.dispose()
  })

  it('rolls back the Resource when computed state construction fails', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-computed-rollback' })] as const
    })
    const runtime = createRuntime()
    const primary = new Error('computed state construction failed')
    const computedFactory = vi.spyOn(runtime, 'computed').mockImplementation(() => {
      throw primary
    })
    const resourceDispose = vi.spyOn(Resource.prototype, 'dispose')
    let thrown: unknown
    try {
      host.liveQuery({
        backendId: 'r11-computed-rollback',
        runtime,
        query: () => 'never-started'
      })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(primary)
    expect(computedFactory).toHaveBeenCalledTimes(1)
    expect(resourceDispose).toHaveBeenCalledTimes(1)
    computedFactory.mockRestore()
    resourceDispose.mockRestore()
    await host.dispose()
  })

  it('aggregates construction cleanup failures after the primary in reverse acquisition order', async () => {
    const primary = new Error('computed construction failed')
    const resourceFailure = new Error('resource construction cleanup failed')
    const signalFailure = new Error('signal construction cleanup failed')
    const order: string[] = []
    const runtime = createRuntime()
    const computedFactory = vi.spyOn(runtime, 'computed').mockImplementation(() => {
      throw primary
    })
    const resourceDispose = vi.spyOn(Resource.prototype, 'dispose').mockImplementation(() => {
      order.push('resource')
      throw resourceFailure
    })
    const signal: IAbortSignal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => {
        order.push('signal')
        throw signalFailure
      }
    }
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-construction-aggregate' })] as const
    })
    try {
      let thrown: unknown
      try {
        host.liveQuery({
          backendId: 'r11-construction-aggregate',
          runtime,
          signal,
          query: () => 'never-started'
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(AggregateError)
      expect(thrown).toMatchObject({
        source: '@migaia/storage-web',
        code: 'LIVE_QUERY_DISPOSE_FAILED',
        message: 'live query failed to dispose'
      })
      expect((thrown as AggregateError).errors).toEqual([primary, resourceFailure, signalFailure])
      expect((thrown as Error).cause).toBe(primary)
      expect((thrown as Error).stack).toBeTruthy()
      expect(order).toEqual(['resource', 'signal'])
      expect(computedFactory).toHaveBeenCalledTimes(1)
      expect(resourceDispose).toHaveBeenCalledTimes(1)
    } finally {
      computedFactory.mockRestore()
      resourceDispose.mockRestore()
      await host.dispose()
    }
  })

  it('uses the same construction collector for direct service queries', async () => {
    const primary = new Error('direct computed construction failed')
    const resourceFailure = new Error('direct resource cleanup failed')
    const signalFailure = new Error('direct signal cleanup failed')
    const runtime = createRuntime()
    const computedFactory = vi.spyOn(runtime, 'computed').mockImplementation(() => {
      throw primary
    })
    const resourceDispose = vi.spyOn(Resource.prototype, 'dispose').mockImplementation(() => {
      throw resourceFailure
    })
    const service = createStorageReactiveService()
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)!
    const signal: IAbortSignal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => {
        throw signalFailure
      }
    }
    service.registerAdapter({
      backendId: 'r11-direct-construction-aggregate',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: undefined,
      report: () => undefined
    })
    try {
      let thrown: unknown
      try {
        service.createQuery({
          backendId: 'r11-direct-construction-aggregate',
          runtime,
          signal,
          query: () => 'never-started'
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(AggregateError)
      expect((thrown as AggregateError).errors).toEqual([primary, resourceFailure, signalFailure])
      expect((thrown as Error).cause).toBe(primary)
      expect(resourceDispose).toHaveBeenCalledTimes(1)
    } finally {
      computedFactory.mockRestore()
      resourceDispose.mockRestore()
      await service.dispose()
    }
  })

  it('follows the current Resource generation when invalidation supersedes the initial read', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-current-generation' })] as const
    })
    const runtime = createRuntime()
    let reads = 0
    let resolveFirst!: (value: string) => void
    let resolveSecond!: (value: string) => void
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve
    })
    const query = host.liveQuery({
      backendId: 'r11-current-generation',
      runtime,
      query: () => (reads++ === 0 ? first : second)
    })
    await host.backend('r11-current-generation').set('invalidate', 'true')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    resolveFirst('stale-generation')
    await Promise.resolve()
    resolveSecond('current-generation')
    await query.ready
    expect(query.state.value.value).toBe('current-generation')
    expect(reads).toBe(2)
    await query.dispose()
    await host.dispose()
  })

  it('returns one derived Promise for overlapping refreshes of the same Resource generation', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-refresh-coalesce' })] as const
    })
    const runtime = createRuntime()
    let reads = 0
    let resolveRefresh!: (value: string) => void
    const refresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    const query = host.liveQuery({
      backendId: 'r11-refresh-coalesce',
      runtime,
      query: () => (reads++ === 0 ? 'initial' : refresh)
    })
    await query.ready
    const firstRefresh = query.refresh()
    const secondRefresh = query.refresh()
    expect(secondRefresh).toBe(firstRefresh)
    expect(reads).toBe(2)
    resolveRefresh('refreshed')
    await firstRefresh
    expect(query.state.value.value).toBe('refreshed')
    await query.dispose()
    await host.dispose()
  })

  it('guards every Resource access after dispose with one handled LIVE_QUERY_DISPOSED rejection', async () => {
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-terminal-guard' })] as const
    })
    const runtime = createRuntime()
    let reads = 0
    const query = host.liveQuery({
      backendId: 'r11-terminal-guard',
      runtime,
      query: () => {
        reads += 1
        return 'stable'
      }
    })
    await query.ready
    const stateAccess = vi.spyOn(Resource.prototype, 'state', 'get')
    const fetchStatusAccess = vi.spyOn(Resource.prototype, 'fetchStatus', 'get')
    const promiseAccess = vi.spyOn(Resource.prototype, 'promise', 'get')
    const refetchAccess = vi.spyOn(Resource.prototype, 'refetch')
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      await query.dispose()
      const accessAfterDispose = {
        state: stateAccess.mock.calls.length,
        fetchStatus: fetchStatusAccess.mock.calls.length,
        promise: promiseAccess.mock.calls.length,
        refetch: refetchAccess.mock.calls.length
      }
      const firstRefresh = query.refresh()
      const secondRefresh = query.refresh()
      expect(secondRefresh).toBe(firstRefresh)
      const firstError = await firstRefresh.catch((error: unknown) => error)
      expect(firstError).toMatchObject({
        name: 'StorageError',
        source: '@migaia/storage-web',
        code: 'LIVE_QUERY_DISPOSED',
        message: 'live query is disposed; create a new live query'
      })
      expect((firstError as Error).stack).toBeTruthy()
      expect((firstError as Error).cause).toBeUndefined()
      expect(query.state.value.value).toBe('stable')
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toHaveLength(0)
      expect({
        state: stateAccess.mock.calls.length,
        fetchStatus: fetchStatusAccess.mock.calls.length,
        promise: promiseAccess.mock.calls.length,
        refetch: refetchAccess.mock.calls.length
      }).toEqual(accessAfterDispose)
      expect(reads).toBe(1)
    } finally {
      process.off('unhandledRejection', onUnhandled)
      stateAccess.mockRestore()
      fetchStatusAccess.mockRestore()
      promiseAccess.mockRestore()
      refetchAccess.mockRestore()
      await host.dispose()
    }
  })

  it('preserves the exact external ABORTED cause for pending ready and refresh', async () => {
    const reason = new Error('r11 external abort')
    let readyListener: (() => void) | undefined
    let readyAborted = false
    const readySignal: IAbortSignal = {
      get aborted() {
        return readyAborted
      },
      get reason() {
        return reason
      },
      addEventListener: (_type, callback) => {
        readyListener = callback
      },
      removeEventListener: () => undefined
    }
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-terminal-abort-ready' })] as const
    })
    const runtime = createRuntime()
    let resolveReady!: (value: string) => void
    const readyValue = new Promise<string>((resolve) => {
      resolveReady = resolve
    })
    const query = host.liveQuery({
      backendId: 'r11-terminal-abort-ready',
      runtime,
      signal: readySignal,
      query: () => readyValue
    })
    const ready = query.ready
    readyAborted = true
    readyListener?.()
    const readyError = await ready.catch((error: unknown) => error)
    expect(readyError).toMatchObject({
      name: 'StorageContractError',
      source: '@migaia/storage-contract',
      code: 'ABORTED'
    })
    expect((readyError as Error).cause).toBe(reason)
    expect((readyError as Error).stack).toBeTruthy()
    resolveReady('late-ready')
    await query.dispose()
    await host.dispose()

    const refreshReason = new Error('r11 refresh abort')
    let refreshListener: (() => void) | undefined
    let refreshAborted = false
    const refreshSignal: IAbortSignal = {
      get aborted() {
        return refreshAborted
      },
      get reason() {
        return refreshReason
      },
      addEventListener: (_type, callback) => {
        refreshListener = callback
      },
      removeEventListener: () => undefined
    }
    const secondHost = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-terminal-abort-refresh' })] as const
    })
    let resolveRefresh!: (value: string) => void
    const refreshValue = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    let refreshReads = 0
    const secondQuery = secondHost.liveQuery({
      backendId: 'r11-terminal-abort-refresh',
      runtime,
      signal: refreshSignal,
      query: () => (refreshReads++ === 0 ? 'initial' : refreshValue)
    })
    await secondQuery.ready
    const refresh = secondQuery.refresh()
    refreshAborted = true
    refreshListener?.()
    const refreshError = await refresh.catch((error: unknown) => error)
    expect(refreshError).toMatchObject({
      name: 'StorageContractError',
      source: '@migaia/storage-contract',
      code: 'ABORTED'
    })
    expect((refreshError as Error).cause).toBe(refreshReason)
    expect((refreshError as Error).stack).toBeTruthy()
    resolveRefresh('late-refresh')
    await secondQuery.dispose()
    await secondHost.dispose()
  })

  it('collects direct query cleanup failures in fixed order with one stable native aggregate', async () => {
    const resourceFailure = new Error('resource cleanup failed')
    const signalFailure = new Error('external signal cleanup failed')
    const order: string[] = []
    const disposeResource = vi.spyOn(Resource.prototype, 'dispose').mockImplementation(() => {
      order.push('resource')
      throw resourceFailure
    })
    const signal: IAbortSignal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => {
        order.push('signal')
        throw signalFailure
      }
    }
    const host = await createStorageHost({
      plugins: [memoryReactive({ id: 'r11-cleanup-direct' })] as const
    })
    const query = host.liveQuery({
      backendId: 'r11-cleanup-direct',
      runtime: createRuntime(),
      signal,
      query: () => 'value'
    })
    await query.ready
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      const firstDispose = query.dispose()
      expect(query.dispose()).toBe(firstDispose)
      const failure = await firstDispose.catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(AggregateError)
      expect(failure).toMatchObject({
        source: '@migaia/storage-web',
        code: 'LIVE_QUERY_DISPOSE_FAILED',
        message: 'live query failed to dispose'
      })
      expect((failure as Error).stack).toBeTruthy()
      expect((failure as AggregateError).errors).toEqual([resourceFailure, signalFailure])
      expect((failure as Error).cause).toBe(resourceFailure)
      expect(order).toEqual(['resource', 'signal'])
      expect(disposeResource).toHaveBeenCalledTimes(1)
      await Promise.resolve()
      await Promise.resolve()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      disposeResource.mockRestore()
      await host.dispose()
    }
  })

  it('collects lifecycle terminal, Resource, and listener failures through one injected cleanup route', async () => {
    const resourceFailure = new Error('lifecycle resource cleanup failed')
    const listenerFailure = new Error('lifecycle listener cleanup failed')
    const lifecycleFailure = new Error('lifecycle release failed')
    const service = createStorageReactiveService()
    const store = memoryStorage()
    const controller = getBackendReactiveController(store)!
    const adapter = service.registerAdapter({
      backendId: 'r11-cleanup-lifecycle',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      subscribe: undefined,
      report: () => undefined
    })
    const order: string[] = []
    const lease = adapter.acquireQuery((recordFailure) => {
      order.push('resource')
      recordFailure?.(resourceFailure)
      order.push('listener')
      recordFailure?.(listenerFailure)
      order.push('lifecycle')
      throw lifecycleFailure
    })
    try {
      const firstTerminate = lease.terminate()
      expect(lease.terminate()).toBe(firstTerminate)
      const failure = await firstTerminate.catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(AggregateError)
      expect((failure as AggregateError).errors).toEqual([
        resourceFailure,
        listenerFailure,
        lifecycleFailure
      ])
      expect((failure as Error).cause).toBe(resourceFailure)
      expect(failure).toMatchObject({
        source: '@migaia/storage-web',
        code: 'LIVE_QUERY_DISPOSE_FAILED',
        message: 'live query failed to dispose'
      })
      expect(order).toEqual(['resource', 'listener', 'lifecycle'])
    } finally {
      await adapter.dispose()
      await service.dispose()
    }
  })

  it('reuses the query cleanup handle during Host teardown and contains late aggregate rejection', async () => {
    const resourceFailure = new Error('host resource cleanup failed')
    const signalFailure = new Error('host signal cleanup failed')
    const reports: unknown[] = []
    const disposeResource = vi.spyOn(Resource.prototype, 'dispose').mockImplementation(() => {
      throw resourceFailure
    })
    const signal: IAbortSignal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => {
        throw signalFailure
      }
    }
    const host = await createStorageHost({
      report: (error) => {
        reports.push(error)
      },
      plugins: [memoryReactive({ id: 'r11-cleanup-host' })] as const
    })
    const query = host.liveQuery({
      backendId: 'r11-cleanup-host',
      runtime: createRuntime(),
      signal,
      query: () => 'value'
    })
    await query.ready
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      await host.dispose()
      const reported = reports.find(
        (error): error is AggregateError =>
          error instanceof AggregateError &&
          (error as AggregateError & { readonly code?: unknown }).code ===
            'LIVE_QUERY_DISPOSE_FAILED'
      )
      expect(reported).toBeDefined()
      expect(reported?.errors).toEqual([resourceFailure, signalFailure])
      const queryFailure = await query.dispose().catch((error: unknown) => error)
      expect(queryFailure).toBe(reported)
      expect((queryFailure as Error).cause).toBe(resourceFailure)
      expect((queryFailure as Error).stack).toBeTruthy()
      expect(disposeResource).toHaveBeenCalledTimes(1)
      await Promise.resolve()
      await Promise.resolve()
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
      disposeResource.mockRestore()
      await host.dispose()
    }
  })

  it('contains an ignored direct cleanup rejection at process scope', async () => {
    const cleanupFailure = new Error('ignored cleanup failure')
    const reports: unknown[] = []
    const disposeResource = vi.spyOn(Resource.prototype, 'dispose').mockImplementation(() => {
      throw cleanupFailure
    })
    const host = await createStorageHost({
      report: (error) => {
        reports.push(error)
      },
      plugins: [memoryReactive({ id: 'r11-cleanup-unhandled' })] as const
    })
    const query = host.liveQuery({
      backendId: 'r11-cleanup-unhandled',
      runtime: createRuntime(),
      query: () => 'value'
    })
    await query.ready
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)
    try {
      query.dispose()
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
      expect(reports).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
      disposeResource.mockRestore()
      await host.dispose()
    }
  })
})
