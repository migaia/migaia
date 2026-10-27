import type { IAbortSignal } from '@migaia/utils/promise'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { Resource } from '@migaia/resource'
import { records, StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { createStorageHost, memoryBackendKind, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { createReactiveServiceFixture } from '../helpers/reactive-service.js'
import { createStorageReactiveService } from '../../src/host/reactive.js'
import { reactiveFeature } from '../../src/features/reactive.js'

/** One ordinary record shape is shared by public query and entity invalidation cases. */
type IReactiveFixtureRow = { id: string; value: string }

/** Install the published fluent Feature with its actual notification owner and teardown. */
async function createPublicReactiveFixture() {
  /** The public host owns every native notification and query created by the case. */
  const host = await createStorageHost({
    plugins: [
      memoryBackendPlugin(undefined, {
        notifications: memoryNotificationsFeature(),
        reactive: reactiveFeature(memoryBackendKind)
      })
    ]
  })
  onTestFinished(() => host.dispose())
  return { host, store: host.backend('memory') }
}

/** Public fluent queries exercise only states reachable through the installed Feature. */
describe('public reactive query policies', () => {
  it('preserves equal values and accepts new values when equality or its reporter fails', async () => {
    /** The real notification source also drives refreshes after committed record writes. */
    const { store } = await createPublicReactiveFixture()
    await store.putRecord({ id: 'row', value: 'initial' }, 'row')
    /** Equality failures remain diagnostic and must never replace an accepted query value. */
    const equalityFailure = new Error('equality policy failed')
    /** Both supported report-only failure forms must remain contained. */
    const reporterFailure = new Error('equality reporter failed')
    /** Recorded callback inputs prove the original equality failure remains attributable. */
    const reports: unknown[] = []
    /** The caller deliberately changes its equality policy between ordinary refreshes. */
    let rejectEquality = false
    /** The same report sink can fail asynchronously or synchronously. */
    let throwReporter = false
    /** The caller retains ownership of the same runtime after query cleanup. */
    const runtime = createRuntime()
    /** The public terminal reads real records and retains the declared equality semantics. */
    const query = store
      .use(records)
      .query<IReactiveFixtureRow>()
      .live({
        runtime,
        equals: (previous, next) => {
          if (rejectEquality) throw equalityFailure
          return previous[0]?.value === next[0]?.value
        },
        report: (error) => {
          reports.push(error)
          if (throwReporter) throw reporterFailure
          return Promise.reject(reporterFailure)
        }
      })
    await query.ready
    /** An unchanged result retains the exact previously accepted array. */
    const initial = query.state.value.value
    await query.refresh()
    expect(query.state.value.value).toBe(initial)
    await store.putRecord({ id: 'row', value: 'different' }, 'row')
    await vi.waitFor(() =>
      expect(query.state.value.value).toEqual([{ id: 'row', value: 'different' }])
    )
    expect(query.state.value.value).not.toBe(initial)
    rejectEquality = true
    await store.putRecord({ id: 'row', value: 'reported-async' }, 'row')
    await vi.waitFor(() =>
      expect(query.state.value.value).toEqual([{ id: 'row', value: 'reported-async' }])
    )
    throwReporter = true
    await store.putRecord({ id: 'row', value: 'reported-sync' }, 'row')
    await vi.waitFor(() =>
      expect(query.state.value.value).toEqual([{ id: 'row', value: 'reported-sync' }])
    )
    expect(reports).toEqual([equalityFailure, equalityFailure])
    expect(query.state.runtime).toBe(runtime)
    expect(query.state.debugName).toBe('storage-plugin-browser/live-query-state')
    expect(query.state.peek()).toBe(query.state.value)
    await query.dispose()
    expect(query.state.observed).toBe(false)
    expect(query.state.peek()).toEqual({
      status: 'disposed',
      value: [{ id: 'row', value: 'reported-sync' }],
      error: expect.objectContaining({ code: 'LIVE_QUERY_DISPOSED' })
    })
  })

  it('isolates entity scopes and rejected changes while conservatively refreshing on predicate failure', async () => {
    /** Public entity writes produce the native controller's actual canonical record scopes. */
    const { store } = await createPublicReactiveFixture()
    /** Only this entity belongs to the live query's declared invalidation scope. */
    const selected = defineEntity<IReactiveFixtureRow>({ name: 'selected', key: 'id' }).connect(
      store
    )
    /** A second ordinary entity supplies a real unrelated committed invalidation. */
    const foreign = defineEntity<IReactiveFixtureRow>({ name: 'foreign', key: 'id' }).connect(store)
    await selected.put({ id: 'selected', value: 'initial' })
    await foreign.put({ id: 'foreign', value: 'foreign' })
    /** Count public projections rather than observing any private source implementation. */
    const project = vi.fn((row: { state: IReactiveFixtureRow }) => row.state.value)
    /** The caller can reject known changes without disabling subsequent source delivery. */
    let accepts = false
    /** A predicate failure must report and refresh rather than leave stale accepted data. */
    let rejectPredicate = false
    /** The original error remains the only diagnostic emitted by the failing predicate. */
    const predicateFailure = new Error('change predicate failed')
    /** These public callback observations distinguish scope rejection from predicate rejection. */
    const changes: unknown[] = []
    /** Query diagnostics cannot replace the authoritative refresh outcome. */
    const reports: unknown[] = []
    /** The raw query selects the actual entity envelope while the Feature retains its source. */
    const query = store
      .use(records)
      .query<{ state: IReactiveFixtureRow }>()
      .where('state.id', 'eq', 'selected')
      .select(project)
      .live({
        runtime: createRuntime(),
        scope: 'selected',
        matches: (change) => {
          changes.push(change)
          if (rejectPredicate) throw predicateFailure
          return accepts
        },
        report: (error) => {
          reports.push(error)
        }
      })
    await query.ready
    expect(query.state.value.value).toEqual(['initial'])
    await foreign.put({ id: 'foreign', value: 'unrelated' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(changes).toHaveLength(0)
    expect(project).toHaveBeenCalledTimes(1)
    await selected.put({ id: 'selected', value: 'filtered' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(changes).toHaveLength(1)
    expect(project).toHaveBeenCalledTimes(1)
    expect(query.state.value.value).toEqual(['initial'])
    accepts = true
    await selected.put({ id: 'selected', value: 'accepted' })
    await vi.waitFor(() => expect(query.state.value.value).toEqual(['accepted']))
    expect(project).toHaveBeenCalledTimes(2)
    rejectPredicate = true
    await selected.put({ id: 'selected', value: 'authoritative' })
    await vi.waitFor(() => expect(query.state.value.value).toEqual(['authoritative']))
    expect(reports).toEqual([predicateFailure])
    expect(project).toHaveBeenCalledTimes(3)
    await query.dispose()
    await selected.put({ id: 'selected', value: 'after-disposal' })
    expect(project).toHaveBeenCalledTimes(3)
  })

  it.each([true, false])(
    'projects pending and failed refreshes with keepPreviousData=%s',
    async (keepPreviousData) => {
      /** The public record terminal supplies each ordinary Resource generation. */
      const { store } = await createPublicReactiveFixture()
      await store.putRecord({ id: 'row', value: 'initial' }, 'row')
      /** The application selector can await a new result without replacing the query source. */
      let selected: string | Promise<string> = 'initial'
      /** A failed public query preserves its coded native error across the live boundary. */
      const failure = new StorageContractError(StorageContractErrorCode.invalidArgument)
      /** Release the selected application's pending operation after its state is observed. */
      let rejectRefresh!: (error: unknown) => void
      /** The original selector confirms that refresh consumed the pending application result. */
      const project = vi.fn(() => selected)
      /** The Feature preserves the caller's existing previous-data preference. */
      const query = store
        .use(records)
        .query<IReactiveFixtureRow>()
        .select(project)
        .live({ runtime: createRuntime(), keepPreviousData })
      await query.ready
      selected = new Promise<string>((_resolve, reject) => {
        rejectRefresh = reject
      })
      /** Refresh owns this pending selection until its original rejection settles. */
      const refresh = query.refresh()
      expect(query.state.value).toEqual(
        keepPreviousData ? { status: 'refreshing', value: ['initial'] } : { status: 'loading' }
      )
      await vi.waitFor(() => expect(project).toHaveBeenCalledTimes(2))
      rejectRefresh(failure)
      await expect(refresh).rejects.toBe(failure)
      expect(query.state.value).toEqual({
        status: 'error',
        ...(keepPreviousData ? { value: ['initial'] } : {}),
        error: failure
      })
      await query.dispose()
    }
  )
})

/** Proves Host query state is Resource-owned and backend changes trigger authoritative refresh. */
describe('Resource-backed queries', () => {
  it('uses caller runtime, refreshes after one backend invalidation, and disposes idempotently', async () => {
    const { host, service, store } = await createReactiveServiceFixture({
      id: 'fixture-memory'
    })
    const runtime = createRuntime()
    let reads = 0
    const query = service.createQuery({
      backendId: 'fixture-memory',
      runtime,
      query: async ({ store: capturedStore, signal }) => {
        expect(capturedStore).toBe(store)
        expect(signal.aborted).toBe(false)
        reads += 1
        return store.get('value-1')
      }
    })

    await query.ready
    expect(query.state.value.value).toBeNull()
    expect(reads).toBe(1)

    await host.backend('memory').set('value-1', 'updated')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(query.state.value.value).toBe('updated')
    expect(reads).toBe(2)

    const firstDispose = query.dispose()
    expect(query.dispose()).toBe(firstDispose)
    await firstDispose
    await host.dispose()
  })

  it('uses the Host scheduler for a per-query deadline and does not start after pre-abort', async () => {
    const scheduler = createManualScheduler()
    const { host, service } = await createReactiveServiceFixture({
      scheduler,
      id: 'fixture-deadline'
    })
    const runtime = createRuntime()
    const pending = new Promise<string>(() => undefined)
    const query = service.createQuery({
      backendId: 'fixture-deadline',
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
    const { host: secondHost, service: secondService } = await createReactiveServiceFixture({
      id: 'fixture-pre-abort'
    })
    expect(() =>
      secondService.createQuery({
        backendId: 'fixture-pre-abort',
        runtime,
        signal: controller.signal,
        query: () => 'never-started'
      })
    ).toThrow()
    await secondHost.dispose()
  })

  it('registers external abort before Resource allocation and rolls back on hostile registration', async () => {
    const { host, service } = await createReactiveServiceFixture({
      id: 'abort-admission'
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
      service.createQuery({
        backendId: 'abort-admission',
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
      service.createQuery({
        backendId: 'abort-admission',
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
    const { host, service } = await createReactiveServiceFixture({
      id: 'computed-rollback'
    })
    const runtime = createRuntime()
    const primary = new Error('computed state construction failed')
    const computedFactory = vi.spyOn(runtime, 'computed').mockImplementation(() => {
      throw primary
    })
    const resourceDispose = vi.spyOn(Resource.prototype, 'dispose')
    let thrown: unknown
    try {
      service.createQuery({
        backendId: 'computed-rollback',
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
    const { host, service } = await createReactiveServiceFixture({
      id: 'construction-aggregate'
    })
    try {
      let thrown: unknown
      try {
        service.createQuery({
          backendId: 'construction-aggregate',
          runtime,
          signal,
          query: () => 'never-started'
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(AggregateError)
      expect(thrown).toMatchObject({
        source: '@migaia/storage-plugin-browser',
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
    const { store, controller } = await createReactiveServiceFixture({ id: 'direct-service-owner' })
    const signal: IAbortSignal = {
      aborted: false,
      addEventListener: () => undefined,
      removeEventListener: () => {
        throw signalFailure
      }
    }
    service.registerAdapter({
      backendId: 'direct-construction-aggregate',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
      report: () => undefined
    })
    try {
      let thrown: unknown
      try {
        service.createQuery({
          backendId: 'direct-construction-aggregate',
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
    const { host, service } = await createReactiveServiceFixture({
      id: 'fixture-current-generation'
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
    const query = service.createQuery({
      backendId: 'fixture-current-generation',
      runtime,
      query: () => (reads++ === 0 ? first : second)
    })
    await host.backend('memory').set('invalidate', 'true')
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
    const { host, service } = await createReactiveServiceFixture({
      id: 'refresh-coalesce'
    })
    const runtime = createRuntime()
    let reads = 0
    let resolveRefresh!: (value: string) => void
    const refresh = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    const query = service.createQuery({
      backendId: 'refresh-coalesce',
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
    const { host, service } = await createReactiveServiceFixture({
      id: 'terminal-guard'
    })
    const runtime = createRuntime()
    let reads = 0
    const query = service.createQuery({
      backendId: 'terminal-guard',
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
        source: '@migaia/storage-plugin-browser',
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
    const { host, service } = await createReactiveServiceFixture({
      id: 'terminal-abort-ready'
    })
    const runtime = createRuntime()
    let resolveReady!: (value: string) => void
    const readyValue = new Promise<string>((resolve) => {
      resolveReady = resolve
    })
    const query = service.createQuery({
      backendId: 'terminal-abort-ready',
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
    const { host: secondHost, service: secondService } = await createReactiveServiceFixture({
      id: 'terminal-abort-refresh'
    })
    let resolveRefresh!: (value: string) => void
    const refreshValue = new Promise<string>((resolve) => {
      resolveRefresh = resolve
    })
    let refreshReads = 0
    const secondQuery = secondService.createQuery({
      backendId: 'terminal-abort-refresh',
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
    const { host, service } = await createReactiveServiceFixture({
      id: 'cleanup-direct'
    })
    const query = service.createQuery({
      backendId: 'cleanup-direct',
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
        source: '@migaia/storage-plugin-browser',
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
    const { store, controller } = await createReactiveServiceFixture({ id: 'direct-service-owner' })
    const adapter = service.registerAdapter({
      backendId: 'cleanup-lifecycle',
      store,
      controller,
      consistency: { mode: 'push', visibility: 'instance' },
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
        source: '@migaia/storage-plugin-browser',
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
    const { host, service } = await createReactiveServiceFixture({
      report: (error) => {
        reports.push(error)
      },
      id: 'cleanup-host'
    })
    const query = service.createQuery({
      backendId: 'cleanup-host',
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
    const { host, service } = await createReactiveServiceFixture({
      report: (error) => {
        reports.push(error)
      },
      id: 'cleanup-unhandled'
    })
    const query = service.createQuery({
      backendId: 'cleanup-unhandled',
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
