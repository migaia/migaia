import {
  IDBDatabase,
  IDBFactory,
  IDBKeyRange,
  IDBObjectStore,
  IDBTransaction
} from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import {
  assertTransactionOwner,
  ConcurrencyPolicy,
  defineConcurrencyPolicy,
  kv,
  records,
  lockKey,
  registerTransactionFinalizer,
  type ITransactionScope
} from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { deferred } from '@migaia/utils/promise'

/** Native and shared boundaries may add context while preserving the exact late rejection. */
const containsOriginalFailure = (
  error: unknown,
  original: unknown,
  seen = new Set<unknown>()
): boolean => {
  if (error === original) return true
  if (error === null || typeof error !== 'object' || seen.has(error)) return false
  seen.add(error)
  const failure = error as { cause?: unknown; errors?: unknown[] }
  return (
    containsOriginalFailure(failure.cause, original, seen) ||
    (Array.isArray(failure.errors) &&
      failure.errors.some((value) => containsOriginalFailure(value, original, seen)))
  )
}

describe('IndexedDB complete native transaction views', () => {
  it('routes root point writes through one pipeline and the original fail/wait policy', async () => {
    /** Pause the original transaction pipeline after logical admission, before native opening. */
    const acquired = deferred<void>()
    const release = deferred<void>()
    const factory = new IDBFactory()
    let holding = true
    let rootPipelines = 0
    let committed: string | null = null
    /** The after-next read must observe the actual native terminal, not an issued request. */
    let readCommitted!: () => Promise<string | null>
    const intervention = definePlugin('root-pipeline', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          if (input.operation === 'indexeddb.transaction' && holding) {
            holding = false
            acquired.resolve()
            await release.promise
          }
          if (input.operation === 'indexed-db.set') {
            rootPipelines += 1
            await next(input)
            committed = await readCommitted()
          } else await next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ id: 'holder', factory, keyRange: IDBKeyRange }),
        indexedDbBackendPlugin({ id: 'writer', factory, keyRange: IDBKeyRange }),
        intervention
      ]
    })
    const holder = host.backend('holder')
    const writer = host.backend('writer')
    readCommitted = () => holder.get('point')
    const transaction = holder.transaction((scope) => scope.set('point', 'holder'), {
      lock: [lockKey.text('point')]
    })
    await acquired.promise
    await expect(
      writer.set('point', 'denied', { concurrency: ConcurrencyPolicy.fail() })
    ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
    let decisions = 0
    let optionReads = 0
    const policy = defineConcurrencyPolicy({
      name: 'root-point-wait',
      locking: 'pessimistic',
      decide: () => {
        decisions += 1
        release.resolve()
        return { action: 'wait' }
      }
    })
    await writer.set('point', 'root', {
      get concurrency() {
        optionReads += 1
        return policy
      }
    })
    await transaction
    expect(decisions).toBe(1)
    expect(optionReads).toBe(1)
    expect(rootPipelines).toBe(2)
    expect(committed).toBe('root')
  })

  it('protects typed root prefixes against held record keys and reuses the captured prefix', async () => {
    /** This gate is the existing high-level pipeline, not a fabricated native transaction. */
    const acquired = deferred<void>()
    const release = deferred<void>()
    const contended = deferred<void>()
    const factory = new IDBFactory()
    let holding = true
    let pipelines = 0
    const intervention = definePlugin('prefix-pipeline', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          if (input.operation === 'indexeddb.transaction' && holding) {
            holding = false
            acquired.resolve()
            await release.promise
          }
          if (input.operation === 'indexed-db.records.removeByPrefix') pipelines += 1
          await next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ id: 'holder', factory, keyRange: IDBKeyRange }),
        indexedDbBackendPlugin({ id: 'writer', factory, keyRange: IDBKeyRange }),
        intervention
      ]
    })
    const holder = host.backend('holder')
    const writer = host.backend('writer')
    await holder.putRecord('remove', ['doc', 'a'])
    await holder.putRecord('keep', ['other', 'a'])
    const transaction = holder.transaction(() => undefined, {
      lock: [lockKey.record(['doc', 'a'])]
    })
    await acquired.promise
    let decisions = 0
    const policy = defineConcurrencyPolicy({
      name: 'root-prefix-wait',
      locking: 'pessimistic',
      decide: () => {
        decisions += 1
        contended.resolve()
        return { action: 'wait' }
      }
    })
    const prefix = ['doc']
    const pending = writer.use(records).removeByPrefix(prefix, { concurrency: policy })
    await contended.promise
    prefix[0] = 'other'
    release.resolve()
    expect(await pending).toBe(1)
    await transaction
    expect(decisions).toBe(1)
    expect(pipelines).toBe(1)
    expect(await writer.getRecord(['doc', 'a'])).toBeUndefined()
    expect(await writer.getRecord(['other', 'a'])).toBe('keep')
  })

  it('unwinds the complete pipeline before replaying a rolled-back native root attempt', async () => {
    /**
     * The competing genuine transaction holds only logical admission until the root has rolled
     * back.
     */
    const release = deferred<void>()
    const factory = new IDBFactory()
    const observed: unknown[] = []
    let stages = 0
    let readCurrent!: () => Promise<unknown>
    const intervention = definePlugin('native-replay-pipeline', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          if (input.operation === 'indexeddb.transaction') await release.promise
          if (input.operation !== 'indexed-db.putRecord') {
            await next(input)
            return
          }
          stages += 1
          try {
            await next(input)
            observed.push(await readCurrent())
          } catch (error) {
            observed.push(error, await readCurrent())
            throw error
          }
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ id: 'holder', factory, keyRange: IDBKeyRange }),
        indexedDbBackendPlugin({ id: 'writer', factory, keyRange: IDBKeyRange }),
        intervention
      ]
    })
    const holder = host.backend('holder')
    const writer = host.backend('writer')
    readCurrent = () => holder.getRecord('replay')
    await writer.putRecord('before', 'replay')
    stages = 0
    observed.length = 0
    /** Instrument the real request issue, without replacing native transaction or scope behavior. */
    const put = IDBObjectStore.prototype.put
    let inject = true
    let holding: Promise<void> | undefined
    const request = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      const result = Reflect.apply(put, this, [value, key])
      if (inject && this.name === 'records' && key === 'replay') {
        inject = false
        holding = holder.transaction(() => undefined, { lock: [lockKey.record('replay')] })
        void holding.catch(() => undefined)
      }
      return result
    })
    let commitDecisions = 0
    const policy = defineConcurrencyPolicy({
      name: 'root-native-replay',
      locking: 'optimistic',
      decide: (conflict) => {
        if (conflict.phase === 'commit') {
          commitDecisions += 1
          release.resolve()
          return { action: 'retry' }
        }
        return { action: 'wait' }
      }
    })
    try {
      await writer.putRecord('after', 'replay', { concurrency: policy })
      await holding
      expect(commitDecisions).toBe(1)
      expect(stages).toBe(2)
      expect(observed).toEqual([
        expect.objectContaining({ code: 'WRITE_CONFLICT' }),
        'before',
        'after'
      ])
      expect(await writer.getRecord('replay')).toBe('after')
    } finally {
      release.resolve()
      request.mockRestore()
    }
  })

  it('preserves a native close failure on explicit disposal while symbolic cleanup reports once', async () => {
    /**
     * This original host prepares and owns the exact connection before the close failure is
     * injected.
     */
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin({ factory: new IDBFactory(), keyRange: IDBKeyRange })]
    })
    /** Direct and symbolic cleanup share the real controller's one native finalization attempt. */
    const store = host.backend('indexed-db')
    /** The native method still closes its acquired connection before exposing the injected failure. */
    const nativeClose = IDBDatabase.prototype.close
    /** Original failure identity must remain reachable in the coded aggregate. */
    const cause = new Error('native close failure')
    /** Report-only symbolic cleanup must observe the original rejection without rerunning close. */
    const reports: unknown[][] = []
    /** Capture the existing reporter, without replacing any production cleanup owner. */
    const reporter = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      reports.push(args)
    })
    /** Native close fails once after releasing the test database so no test-owned resource remains. */
    const close = vi
      .spyOn(IDBDatabase.prototype, 'close')
      .mockImplementationOnce(function (this: IDBDatabase) {
        Reflect.apply(nativeClose, this, [])
        throw cause
      })
    try {
      const disposal = store.dispose()
      expect(store.dispose()).toBe(disposal)
      const failure = await disposal.catch((error: unknown) => error)
      expect(failure).toMatchObject({
        source: '@migaia/storage-web',
        code: 'BACKEND_DISPOSE_FAILED',
        cause
      })
      expect((failure as AggregateError).errors).toEqual([cause])
      const symbolic = store[asyncDisposeKey]()
      expect(store[asyncDisposeKey]()).toBe(symbolic)
      await expect(symbolic).resolves.toBeUndefined()
      expect(close).toHaveBeenCalledTimes(1)
      expect(reports.some((entry) => entry.includes(failure))).toBe(true)
      await expect(host.dispose()).rejects.toBeDefined()
    } finally {
      close.mockRestore()
      reporter.mockRestore()
    }
  })

  it('closes one contended member without closing the shared lock owner', async () => {
    /** Both members borrow the same physical lock domain and retain separate controller lifetimes. */
    const factory = new IDBFactory()
    /** Closing the second member must leave the first native transaction and shared port usable. */
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ id: 'first', factory, keyRange: IDBKeyRange }),
        indexedDbBackendPlugin({ id: 'second', factory, keyRange: IDBKeyRange })
      ]
    })
    /** The first real callback signals actual native admission before the second contends. */
    const admitted = deferred<void>()
    /** The holder remains active until the waiting member's disposal has finished. */
    const release = deferred<void>()
    /** Policy observation proves the second attempt encountered a real held key. */
    const contended = deferred<void>()
    /** A closed member must never enter its callback, even after the holder releases. */
    let calls = 0
    /** The original public transaction retains its native cleanup and lock-release responsibility. */
    const holding = host.backend('first').transaction(
      async (scope) => {
        admitted.resolve()
        await release.promise
        await scope.set('retained', 'yes')
      },
      { lock: [lockKey.text('shared')] }
    )
    void holding.catch(() => undefined)
    try {
      await admitted.promise
      /** The policy belongs to the original loop rather than a test-owned queue. */
      const waiting = host.backend('second').transaction(
        () => {
          calls += 1
        },
        {
          lock: [lockKey.text('shared')],
          concurrency: defineConcurrencyPolicy({
            name: 'observe-member-wait',
            locking: 'pessimistic',
            decide: () => {
              contended.resolve()
              return { action: 'wait' }
            }
          })
        }
      )
      void waiting.catch(() => undefined)
      await contended.promise
      await host.backend('second').dispose()
      await expect(waiting).rejects.toMatchObject({
        code: 'ABORTED',
        cause: { code: 'STORE_DISPOSED' }
      })
      expect(calls).toBe(0)
      release.resolve()
      await holding
      expect(calls).toBe(0)
      expect(await host.backend('first').get('retained')).toBe('yes')
      expect(await host.backend('first').inspectLocks()).toEqual([])
    } finally {
      release.resolve()
      await host.dispose()
    }
  })

  it('shares one logical lock domain across layouts of the same physical database', async () => {
    /** Layout-specific text stores still overlap the same authoritative records store. */
    const factory = new IDBFactory()
    /** Both registrations share only the real physical database's lock owner. */
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({
          id: 'first',
          factory,
          keyRange: IDBKeyRange,
          dbName: 'native-lock-domain',
          kvStoreName: 'first-kv',
          owner: { label: 'agent-a' }
        }),
        indexedDbBackendPlugin({
          id: 'second',
          factory,
          keyRange: IDBKeyRange,
          dbName: 'native-lock-domain',
          kvStoreName: 'second-kv',
          owner: { label: 'agent-b' }
        })
      ]
    })
    /** These microtask handoffs exercise the same native activity task without a timer boundary. */
    const admitted = deferred<void>()
    /** The test releases the first original callback after observing the real logical conflict. */
    const release = deferred<void>()
    /**
     * This is the original public transaction Promise, including native termination and lock
     * release.
     */
    const holding = host.backend('first').transaction(
      async (scope) => {
        admitted.resolve()
        await release.promise
        await scope.putRecord({ retained: true }, 'shared')
      },
      { lock: [lockKey.record('shared')], concurrency: ConcurrencyPolicy.wait() }
    )
    void holding.catch(() => undefined)
    /** A rejected acquisition must not enter the second user callback or open its native attempt. */
    let calls = 0
    try {
      await admitted.promise
      await expect(
        host.backend('second').transaction(
          () => {
            calls += 1
          },
          {
            lock: [lockKey.record('shared')],
            concurrency: ConcurrencyPolicy.fail()
          }
        )
      ).rejects.toMatchObject({
        source: '@migaia/storage-contract',
        code: 'LOCK_REJECTED',
        holder: { label: 'agent-a', scope: 'local', status: 'held' }
      })
      expect(calls).toBe(0)
      expect((await host.backend('second').inspectLocks())[0]?.holder).toMatchObject({
        label: 'agent-a',
        scope: 'local',
        status: 'held'
      })
      release.resolve()
      await holding
      expect(await host.backend('second').inspectLocks()).toEqual([])
      expect(await host.backend('second').getRecord('shared')).toEqual({ retained: true })
    } finally {
      release.resolve()
      await host.dispose()
    }
  })

  it('writes and reads all three channels through the same complete view', async () => {
    /** The native factory provides actual requests without claiming a real browser activity test. */
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin({ factory: new IDBFactory(), keyRange: IDBKeyRange })]
    })
    /** This is the original store admitted by the neutral host. */
    const store = host.backend('indexed-db')
    try {
      /** Mutable input must be copied when this operation starts rather than at native commit. */
      const bytes = new Uint8Array([1, 2])
      /** Records share the same mutation lifetime as text and bytes. */
      const record = { nested: { value: 1 } }
      await store.transaction(async (scope) => {
        expect(assertTransactionOwner(store, scope).activityMode).toBe('native')
        await scope.set('text', 'saved')
        expect(await scope.has('text')).toBe(true)
        expect(await scope.get('text')).toBe('saved')
        const writeBytes = scope.setBytes('bytes', bytes)
        bytes[0] = 9
        await writeBytes
        expect(await scope.getBytes('bytes')).toEqual(new Uint8Array([1, 2]))
        const writeRecord = scope.putRecord(record, ['records', 1])
        record.nested.value = 9
        await writeRecord
        expect(await scope.getRecord(['records', 1])).toEqual({ nested: { value: 1 } })
        await scope.remove('absent')
        await scope.removeBytes('absent')
        await scope.deleteRecord(['absent', 1])
      })
      expect(await store.get('text')).toBe('saved')
      expect(await store.getBytes('bytes')).toEqual(new Uint8Array([1, 2]))
      expect(await store.getRecord(['records', 1])).toEqual({ nested: { value: 1 } })
    } finally {
      await host.dispose()
    }
  })

  it('binds complete text batches and record queries to the same native scope', async () => {
    /** The public plugin provides both authentic capabilities on its original store. */
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin({ factory: new IDBFactory(), keyRange: IDBKeyRange })]
    })
    /** Every scoped operation below runs inside this store's one native transaction. */
    const store = host.backend('indexed-db')
    try {
      expect(store.has(records)).toBe(true)
      await store.transaction(async (scope) => {
        /** Repeated capability lookup retains the original view's cached projection. */
        const text = scope.use(kv)
        expect(scope.use(kv)).toBe(text)
        await text.setMany([
          { key: ['values', 1], value: 'tuple' },
          { key: 1, value: 'number' },
          { key: '1', value: 'string' },
          { key: new Date(1), value: 'date' },
          { key: new Uint8Array([1, 2]).buffer, value: 'bytes' }
        ])
        expect(
          await text.getMany([
            new Uint8Array([1, 2]).buffer,
            ['values', 1],
            1,
            '1',
            new Date(1),
            ['values', 1],
            'missing'
          ])
        ).toEqual(['bytes', 'tuple', 'number', 'string', 'date', 'tuple', undefined])
        expect(await text.get('1')).toBe('string')
        expect(await text.removeMany([1, new Date(1), new Date(1)])).toBe(2)
        expect(await text.removeByPrefix(['values'])).toBe(1)
        expect(await text.getMany([['values', 1], 1, new Date(1)])).toEqual([
          undefined,
          undefined,
          undefined
        ])
        expect(await text.getMany([])).toEqual([])
        expect(await text.setMany([])).toBeUndefined()
        expect(await text.removeMany([])).toBe(0)
        await scope.putRecord({ value: 1 }, ['rows', 1])
        await scope.putRecord({ value: 2 }, ['rows', 2])
        expect(
          await scope.use(records).query<{ value: number }>().where({ value: 2 }).all()
        ).toEqual([{ value: 2 }])
        expect(await scope.use(records).removeByPrefix(['rows'])).toBe(2)
      })
      expect(await store.get('1')).toBe('string')
      expect(await store.use(records).query().all()).toEqual([])
    } finally {
      await host.dispose()
    }
  })

  it.each(['text-first', 'record-first'] as const)(
    'rejects canonical structured-key collisions with %s writes',
    async (order) => {
      /** Both channels retain the same canonical tuple identity in one physical transaction. */
      const host = await createStorageHost({
        plugins: [indexedDbBackendPlugin({ factory: new IDBFactory(), keyRange: IDBKeyRange })]
      })
      /** The failed second channel write must roll back the accepted first write. */
      const store = host.backend('indexed-db')
      try {
        await expect(
          store.transaction(async (scope) => {
            if (order === 'text-first') {
              await scope.use(kv).setMany([{ key: ['shared', 1], value: 'text' }])
              await scope.putRecord({ value: 1 }, ['shared', 1])
            } else {
              await scope.putRecord({ value: 1 }, ['shared', 1])
              await scope.use(kv).setMany([{ key: ['shared', 1], value: 'text' }])
            }
          })
        ).rejects.toMatchObject({ source: '@migaia/storage-web', code: 'DUPLICATE_KEY' })
        expect(await store.getRecord(['shared', 1])).toBeUndefined()
        await store.transaction(async (scope) => {
          expect(await scope.use(kv).getMany([['shared', 1]])).toEqual([undefined])
        })
      } finally {
        await host.dispose()
      }
    }
  )

  it.each([
    ['callback', 'cooperative'],
    ['callback', 'ignores cancellation'],
    ['finalizer', 'cooperative'],
    ['finalizer', 'ignores cancellation']
  ] as const)('retains native attempt ownership for a %s that %s', async (phase, behavior) => {
    /** All work uses real installed stores and the original shared logical/native owners. */
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ id: 'first', factory: new IDBFactory(), keyRange: IDBKeyRange })
      ]
    })
    const store = host.backend('first')
    const signal = new AbortController()
    const entered = deferred<void>()
    const release = deferred<void>()
    const contended = deferred<void>()
    const nativeAborted = deferred<void>()
    const reason = new Error('cancel accepted native work')
    const late = new Error('accepted work rejects after cancellation')
    let firstSettled = false
    let waiterStarted = false
    /** Observe the actual abort event rather than estimating when native rollback finishes. */
    const nativeAbort = IDBTransaction.prototype.abort
    const abort = vi
      .spyOn(IDBTransaction.prototype, 'abort')
      .mockImplementation(function (this: IDBTransaction) {
        this.addEventListener('abort', () => nativeAborted.resolve(), { once: true })
        return Reflect.apply(nativeAbort, this, [])
      })
    /** The existing race reporter must still receive a late non-cancellation rejection once. */
    const reporter = vi.spyOn(console, 'error').mockImplementation(() => {})
    /** This accepted user Promise belongs to the native attempt even after rollback. */
    const pause = async (): Promise<void> => {
      entered.resolve()
      if (behavior === 'cooperative')
        signal.signal.addEventListener('abort', () => release.resolve(), { once: true })
      await release.promise
      if (behavior === 'ignores cancellation') throw late
    }
    const first = store
      .transaction(
        async (scope) => {
          await scope.set('owned', 'rollback')
          if (phase === 'callback') await pause()
          else registerTransactionFinalizer(scope, pause)
        },
        { signal: signal.signal, lock: [lockKey.text('owned')] }
      )
      .catch((error: unknown) => {
        firstSettled = true
        return error
      })
    await entered.promise
    const waiting = store.transaction(
      (scope) => {
        waiterStarted = true
        return scope.set('owned', 'after cleanup')
      },
      {
        lock: [lockKey.text('owned')],
        concurrency: defineConcurrencyPolicy({
          name: 'accepted-work-drain',
          locking: 'pessimistic',
          decide: () => {
            contended.resolve()
            return { action: 'wait' }
          }
        })
      }
    )
    try {
      await contended.promise
      signal.abort(reason)
      await nativeAborted.promise
      if (behavior === 'ignores cancellation') {
        expect(firstSettled).toBe(false)
        expect(waiterStarted).toBe(false)
        release.resolve()
      }
      expect(await first).toMatchObject({ code: 'ABORTED', cause: reason })
      await waiting
      expect(waiterStarted).toBe(true)
      expect(await store.get('owned')).toBe('after cleanup')
      expect(
        reporter.mock.calls.filter((args) =>
          args.some((error) => containsOriginalFailure(error, late))
        )
      ).toHaveLength(behavior === 'ignores cancellation' ? 1 : 0)
    } finally {
      release.resolve()
      await Promise.allSettled([first, waiting])
      abort.mockRestore()
      reporter.mockRestore()
    }
  })

  it('locks the original operation failure even when the callback catches it', async () => {
    /** The same factory and database are retained for independent post-rollback reads. */
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin({ factory: new IDBFactory(), keyRange: IDBKeyRange })]
    })
    /** All public reads below use the original store after the physical rollback. */
    const store = host.backend('indexed-db')
    /** The request and outer transaction must reject with the same normalized first failure. */
    let firstFailure: unknown
    try {
      const failure = await store
        .transaction(async (scope) => {
          await scope.set('text', 'rolled back')
          await scope.putRecord({ value: 1 }, 1)
          try {
            await scope.setBytes('invalid', 'not bytes' as never)
          } catch (error) {
            firstFailure = error
          }
        })
        .catch((error: unknown) => error)
      expect(failure).toBe(firstFailure)
      expect(failure).toMatchObject({ source: '@migaia/storage-web', code: 'INVALID_CONFIG' })
      expect(await store.get('text')).toBeNull()
      expect(await store.getRecord(1)).toBeUndefined()
      expect(await store.getBytes('invalid')).toBeNull()
    } finally {
      await host.dispose()
    }
  })

  it('drains unawaited operations and gives each finalizer a different complete view', async () => {
    /** No native transaction starts outside this one public transaction entry. */
    const host = await createStorageHost({
      plugins: [indexedDbBackendPlugin({ factory: new IDBFactory(), keyRange: IDBKeyRange })]
    })
    /** Captured old views are retained only to verify that they lose data access. */
    const views: ITransactionScope[] = []
    /** Call order proves ordinary finalizers run once after accepted operations finish. */
    const calls: number[] = []
    /** The original store remains usable after its transaction views close. */
    const store = host.backend('indexed-db')
    /**
     * Final commit observation must retain the same authentic transaction after ordinary checks
     * close.
     */
    const observedIds: Array<string | undefined> = []
    /** The user view supplies identity only while it is genuinely active. */
    let transactionId: string | undefined
    host.hooks.on('beforeCommit', (payload) => {
      calls.push(3)
      observedIds.push(payload.transactionId)
    })
    try {
      await store.transaction((scope) => {
        transactionId = assertTransactionOwner(store, scope).id
        views.push(scope)
        void scope.putRecord({ value: 1 }, 1)
        registerTransactionFinalizer(scope, async (first) => {
          views.push(first)
          calls.push(1)
          expect(await first.getRecord(1)).toEqual({ value: 1 })
          await first.set('checked', 'yes')
        })
        registerTransactionFinalizer(scope, async (second) => {
          views.push(second)
          calls.push(2)
          expect(await second.get('checked')).toBe('yes')
        })
      })
      expect(calls).toEqual([1, 2, 3])
      expect(observedIds).toEqual([transactionId])
      expect(new Set(views).size).toBe(3)
      expect(await store.get('checked')).toBe('yes')
      for (const view of views)
        await expect(view.getRecord(1)).rejects.toMatchObject({
          source: '@migaia/storage-web',
          code: 'TRANSACTION_FAILED'
        })
    } finally {
      await host.dispose()
    }
  })
})
