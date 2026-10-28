import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  assertTransactionOwner,
  createTransactionOwner,
  deriveTransactionIterator,
  readTransactionOperationContext,
  nextTransactionIterator,
  registerTransactionFinalizer,
  runTransactionOperation
} from '../src/authoring/transaction.ts'
import {
  TransactionActivityMode,
  type IStorageBase,
  type IStorageIterator,
  type IRecordStore,
  type IRecordIndexHandle,
  type IOperationContext,
  type ITransactionInfo,
  type ITransactionScope
} from '@migaia/storage-contract'

/** Test backend keeps one native error family so normalization can preserve exact coded identity. */
type IFailure = Error & { readonly source: string; readonly code: string }
/** Concrete non-KV scope proves the owner retains backend extensions without copying caller fields. */
type IScope = { read(): Promise<number>; sql(text: string): Promise<string> }

/** Produces an idempotent backend error without changing an original stack or cause. */
function normalizeFailure(error: unknown, expiredScope?: true): IFailure {
  if (error instanceof Error && 'source' in error && 'code' in error) return error as IFailure
  /** Frozen backend errors require cleanup aggregates to preserve the primary on their cause chain. */
  const failure = new Error('fixture transaction failed', { cause: error })
  Object.defineProperties(failure, {
    source: { value: 'fixture-backend' },
    code: { value: 'TRANSACTION_FAILED' },
    ...(expiredScope ? { operation: { value: 'transaction.scope' } } : {})
  })
  return failure as IFailure
}

/** Each fixture owns one actual resource base and one original transaction method factory. */
function setup(options?: {
  beforeCommit?: (scope: IScope) => void | PromiseLike<void>
  context?: IOperationContext
}) {
  /** No KV methods are fabricated for this specialized backend. */
  const base: IStorageBase = {
    backend: 'fixture-backend',
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined
  }
  /** Calls are counted by original error identity rather than incidental expiry preparation. */
  const normalize = vi.fn(normalizeFailure)
  /** Backend abort notification must happen when the first operation fails. */
  const onFailure = vi.fn()
  /** Every method factory creates fresh complete native capabilities. */
  const createScope = vi.fn((): IScope => {
    /** Data methods authorize the actual view on every entry. */
    const scope: IScope = {
      read: () => runTransactionOperation(scope, () => 7),
      sql: (text) => runTransactionOperation(scope, () => text)
    }
    return scope
  })
  /** Explicit non-KV scope shares the same canonical owner as complete KV transaction scopes. */
  const owner = createTransactionOwner<unknown, IScope>(base, normalize, {
    activityMode: TransactionActivityMode.native
  })
  /** The initial view belongs only to the user callback interval. */
  const root = createScope()
  /** Only this backend holds lifecycle authority. */
  const controller = owner.register(root, {
    createScope,
    onFailure,
    beforeCommit: options?.beforeCommit,
    context: options?.context
  })
  return { base, normalize, onFailure, createScope, owner, root, controller }
}

describe('canonical transaction ownership', () => {
  it('normalizes one cached escaped-scope failure with its backend-owned operation hint', async () => {
    /** A completed operation and all later expired views share one original expiry failure. */
    const fixture = setup()
    await expect(fixture.root.read()).resolves.toBe(7)
    fixture.controller.close()
    /** The original factory must never run again after the view has expired. */
    const factories = fixture.createScope.mock.calls.length
    /** Different escaped data methods reject the same backend-normalized error identity. */
    const readFailure = await fixture.root.read().catch((error: unknown) => error)
    expect(readFailure).toMatchObject({
      source: 'fixture-backend',
      code: 'TRANSACTION_FAILED',
      operation: 'transaction.scope'
    })
    await expect(fixture.root.sql('escaped')).rejects.toBe(readFailure)
    await expect(runTransactionOperation(fixture.root, () => 1)).rejects.toBe(readFailure)
    expect(fixture.createScope).toHaveBeenCalledTimes(factories)
    expect(fixture.normalize.mock.calls.filter(([, expired]) => expired === true)).toHaveLength(1)
    expect((readFailure as Error).cause).toBeInstanceOf(Error)
    expect((readFailure as Error).stack).toBeTruthy()
    expect(((readFailure as Error).cause as Error).stack).toBeTruthy()
  })

  it('keeps non-expiry normalization on the original single-argument primary-failure path', async () => {
    /** Real callback failures keep their original metadata and causal identity. */
    const original = new Error('original native callback failure')
    /** Only the private expiry cache may pass the optional diagnostic hint. */
    const fixture = setup()
    await expect(
      runTransactionOperation(fixture.root, () => {
        throw original
      })
    ).rejects.toMatchObject({ cause: original })
    expect(fixture.normalize.mock.calls.find(([error]) => error === original)).toEqual([original])
    expect(fixture.onFailure.mock.calls[0]![0]).not.toHaveProperty('operation')
    fixture.controller.close()
  })

  it('shares one captured operation context across live operation and finalizer views', async () => {
    /** The backend supplies its existing attempt signal, without another cancellation owner. */
    const abort = new AbortController()
    /** This backend attempt context spans active operation and finalizer awaits. */
    const context: IOperationContext = {
      signal: abort.signal,
      timeoutMs: 70,
      pageSize: 3,
      orgId: '00000000-0000-0000-0000-000000000001'
    }
    /** A finalizer receives the same captured fields on its own authentic check view. */
    const finalizer = vi.fn((scope: IScope) => {
      expect(readTransactionOperationContext(scope)).toBe(snapshot)
    })
    /** Registration snapshots once before publishing any transaction view. */
    const fixture = setup({ context, beforeCommit: finalizer })
    /** Repeated reads return the same context record, retaining the original signal identity. */
    const snapshot = readTransactionOperationContext(fixture.root)
    expect(snapshot).toMatchObject({ signal: abort.signal, timeoutMs: 70, pageSize: 3 })
    expect(readTransactionOperationContext(fixture.root)).toBe(snapshot)
    /** Accepted operation work remains valid after the original user callback stops admission. */
    const gate = Promise.withResolvers<void>()
    /** Saved views must expire when their actual operation settles. */
    let operation: IScope | undefined
    /** Composed extensions receive the same original attempt context on their derived view. */
    const result = runTransactionOperation(fixture.root, async (scope) => {
      operation = scope
      expect(readTransactionOperationContext(scope)).toBe(snapshot)
      await gate.promise
      expect(readTransactionOperationContext(scope)?.signal).toBe(abort.signal)
      expect(readTransactionOperationContext(scope)?.signal?.aborted).toBe(true)
    })
    fixture.controller.stopAdmission()
    expect(() => readTransactionOperationContext(fixture.root)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    /** Cancellation changes the original signal rather than replacing the retained context. */
    abort.abort()
    gate.resolve()
    await result
    expect(() => readTransactionOperationContext(operation!)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await fixture.controller.runFinalizers()
    expect(finalizer).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })

  it('keeps omitted contexts absent and rejects forged or closed views', () => {
    /** Existing registrations without context retain their original admission behavior. */
    const fixture = setup()
    expect(readTransactionOperationContext(fixture.root)).toBeUndefined()
    expect(() => readTransactionOperationContext({})).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    fixture.controller.close()
    expect(() => readTransactionOperationContext(fixture.root)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('rejects forged, duplicate and expired identities without invoking data factories', async () => {
    /** A real owner is initialized exactly once for the original store identity. */
    const fixture = setup()
    expect(() => createTransactionOwner(fixture.base, normalizeFailure)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() =>
      fixture.owner.register(fixture.root, {
        createScope: fixture.createScope,
        onFailure: fixture.onFailure
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => assertTransactionOwner(fixture.base, {})).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => runTransactionOperation({}, () => 1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    /** Termination releases all old view authority, including previously saved method references. */
    const saved = fixture.root.read
    fixture.controller.close()
    fixture.controller.close()
    expect(() => assertTransactionOwner(fixture.base, fixture.root)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await expect(saved()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(fixture.createScope).toHaveBeenCalledTimes(1)
    expect(() =>
      fixture.owner.register(fixture.root, {
        createScope: fixture.createScope,
        onFailure: fixture.onFailure
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('admits work synchronously and drains accepted operation views after the user view closes', async () => {
    /** Deferred native work remains owned until its actual settlement. */
    const gate = Promise.withResolvers<number>()
    /** Root and derived views share one immutable transaction identity. */
    const fixture = setup()
    /** The callback receives a fresh view before this API returns its Promise. */
    let operation: IScope | undefined
    /** All views report the actual backend activity mode. */
    const info = assertTransactionOwner(fixture.base, fixture.root)
    /** In-flight work can use its own view after callback admission ends. */
    const result = runTransactionOperation(fixture.root, async (scope) => {
      operation = scope
      expect(assertTransactionOwner(fixture.base, scope)).toBe(info)
      await gate.promise
      return await scope.sql('same transaction')
    })
    expect(operation).toBeDefined()
    expect(operation).not.toBe(fixture.root)
    fixture.controller.stopAdmission()
    await expect(fixture.root.read()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    /** Final checks wait accepted work without keeping the old callback view active. */
    const final = fixture.controller.runFinalizers()
    gate.resolve(1)
    await expect(result).resolves.toBe('same transaction')
    await final
    expect(info.activityMode).toBe(TransactionActivityMode.native)
    expect(() => assertTransactionOwner(fixture.base, operation!)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    fixture.controller.close()
  })

  it('runs ordered checks and final beforeCommit once with distinct complete views', async () => {
    /** Saved view facts prove one transaction identity without retaining data permission. */
    const identities: ITransactionInfo[] = []
    /** Each check creates its own active resource, released before entering the next check. */
    const closed: string[] = []
    /** A final beforeCommit check follows all ordinary registered checks. */
    const order: string[] = []
    /** The final library check can still perform native work on its new view. */
    const fixture = setup({
      beforeCommit: async (scope) => {
        order.push('commit')
        expect(closed).toEqual(['a', 'b'])
        await scope.read()
      }
    })
    /** An expired check object must never become valid again for a later check. */
    let previous: IScope | undefined
    for (const name of ['a', 'b']) {
      registerTransactionFinalizer(fixture.root, async (scope) => {
        if (previous)
          expect(() => assertTransactionOwner(fixture.base, previous!)).toThrowError(
            expect.objectContaining({ code: 'INVALID_ARGUMENT' })
          )
        previous = scope
        order.push(name)
        identities.push(assertTransactionOwner(fixture.base, scope))
        fixture.owner.registerIterator(scope, {
          next: async () => ({ done: false, value: 1 }),
          close: () => {
            closed.push(name)
          }
        })
        expect(await scope.read()).toBe(7)
      })
    }
    const final = fixture.controller.runFinalizers()
    expect(fixture.controller.runFinalizers()).toBe(final)
    expect(() => registerTransactionFinalizer(fixture.root, () => undefined)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await final
    expect(order).toEqual(['a', 'b', 'commit'])
    expect(identities[0]).toBe(identities[1])
    expect(fixture.onFailure).not.toHaveBeenCalled()
    fixture.controller.close()
  })

  it('normalizes a failed check once and skips all later checks', async () => {
    /** The second check's source error remains reachable from the one cached finalizer result. */
    const original = new Error('second check failed')
    /** Check order is distinct from Promise settlement ordering. */
    const order: number[] = []
    /** The failure must call the existing backend rollback notification immediately. */
    const fixture = setup()
    registerTransactionFinalizer(fixture.root, () => {
      order.push(1)
    })
    registerTransactionFinalizer(fixture.root, () => {
      order.push(2)
      throw original
    })
    registerTransactionFinalizer(fixture.root, () => {
      order.push(3)
    })
    const final = fixture.controller.runFinalizers()
    await expect(final).rejects.toMatchObject({ cause: original, code: 'TRANSACTION_FAILED' })
    expect(fixture.controller.runFinalizers()).toBe(final)
    expect(order).toEqual([1, 2])
    expect(fixture.normalize.mock.calls.filter(([error]) => error === original)).toHaveLength(1)
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })
})

describe('transaction iterator resources', () => {
  it('borrows each current view without reviving its expired creation view or accepting forged resources', async () => {
    /** One resource position advances under distinct current operation views. */
    const fixture = setup()
    /** Captured operation views prove next does not reuse a prior view. */
    const views: IScope[] = []
    /** Backend close remains one real cleanup after partial consumption. */
    const close = vi.fn()
    /** The resource is created inside a short-lived operation. */
    const iterator = await runTransactionOperation(fixture.root, (scope) =>
      fixture.owner.registerIterator(scope, {
        next: async (current) => {
          views.push(current)
          return { done: false, value: views.length }
        },
        close
      })
    )
    await expect(iterator.next()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    await expect(
      runTransactionOperation(fixture.root, (scope) => nextTransactionIterator(scope, iterator))
    ).resolves.toMatchObject({ value: 1 })
    await expect(
      runTransactionOperation(fixture.root, (scope) => nextTransactionIterator(scope, iterator))
    ).resolves.toMatchObject({ value: 2 })
    expect(views[0]).not.toBe(views[1])
    expect(() => nextTransactionIterator(fixture.root, { next: iterator.next })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    /** Another store and another transaction cannot borrow this resource. */
    const other = setup()
    expect(() => nextTransactionIterator(other.root, iterator)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await fixture.controller.runFinalizers()
    expect(close).toHaveBeenCalledTimes(1)
    const main = iterator.dispose()
    expect(iterator.dispose()).toBe(main)
    const symbolic = iterator[Symbol.asyncDispose]()
    expect(iterator[Symbol.asyncDispose]()).toBe(symbolic)
    expect(symbolic).not.toBe(main)
    expect(iterator.return!()).toBe(iterator.return!())
    await Promise.all([main, symbolic, iterator.return!()])
    expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
    other.controller.close()
  })

  it('waits accepted concurrent advances before close and releases once across cleanup callers', async () => {
    /** Concurrent port advances keep independent views but share one actual cursor lifetime. */
    const fixture = setup()
    /** Each native next must settle before resource cleanup can release the cursor. */
    const first = Promise.withResolvers<IteratorResult<number>>()
    /** Independent second advancement proves cleanup cannot stop after the first result. */
    const second = Promise.withResolvers<IteratorResult<number>>()
    /** Ports execute immediately in the original transaction active context. */
    const next = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    /** The one actual cleanup is counted regardless of initiating public method. */
    const close = vi.fn()
    /** Resource methods themselves carry no authority to commit. */
    const iterator = fixture.owner.registerIterator<IScope, number>(fixture.root, { next, close })
    const a = iterator.next()
    const b = iterator.next()
    const main = iterator.dispose()
    const returning = iterator.return!()
    expect(iterator.dispose()).toBe(main)
    const closing = fixture.controller.closeIterators()
    expect(fixture.controller.closeIterators()).toBe(closing)
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    first.resolve({ done: false, value: 1 })
    await a
    expect(close).not.toHaveBeenCalled()
    second.resolve({ done: false, value: 2 })
    await Promise.all([b, main, returning, closing])
    expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })

  it('uses the supplied disposal key without creating a native fallback', async () => {
    /** A distinct fixed key represents the existing outer host identity. */
    const key: symbol = Symbol('host-disposal')
    /** This base has not been initialized by the tested owner yet. */
    const fixture = setup()
    /** A separate original base supports the host key as its real cleanup method. */
    const base = { ...fixture.base, [key]: fixture.base.dispose }
    const owner = createTransactionOwner<unknown, IScope>(base, normalizeFailure, {
      asyncDisposeKey: key as typeof Symbol.asyncDispose
    })
    const root = fixture.createScope()
    const controller = owner.register(root, {
      createScope: fixture.createScope,
      onFailure: fixture.onFailure
    })
    const close = vi.fn()
    const iterator = owner.registerIterator(root, {
      next: async () => ({ done: false, value: 1 }),
      close
    })
    expect(Reflect.get(iterator, Symbol.asyncDispose)).toBeUndefined()
    /** The host owns key selection; the contract only installs the supplied method identity. */
    const symbolic = Reflect.get(iterator, key) as () => Promise<void>
    expect(symbolic()).toBe(symbolic())
    await symbolic()
    expect(close).toHaveBeenCalledTimes(1)
    controller.close()
    fixture.controller.close()
  })

  it('naturally completed resources close once and do not replay historical cleanup', async () => {
    /** A done result releases the resource without waiting for explicit return. */
    const fixture = setup()
    /** Closing a completed cursor is still one required port action. */
    const close = vi.fn()
    /** A finite native cursor is owned by this exact transaction. */
    const iterator = fixture.owner.registerIterator<IScope, number>(fixture.root, {
      next: async () => ({ done: true, value: undefined }),
      close
    })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    await expect(iterator.next()).resolves.toMatchObject({ done: true })
    await fixture.controller.runFinalizers()
    expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  })

  it('continues cleanup and preserves the primary before multiple resource failures', async () => {
    /** A real operation failure remains the primary even if every remaining cursor close fails. */
    const primary = new Error('request failed')
    /** Both independent cleanup failures remain reachable. */
    const releases = [new Error('cursor a close failed'), new Error('cursor b close failed')]
    /** One shared owner aggregates its actual active resources only. */
    const fixture = setup()
    /** Every remaining port must be attempted despite earlier close rejection. */
    const closes = releases.map((error) =>
      vi.fn(() => {
        throw error
      })
    )
    for (const close of closes)
      fixture.owner.registerIterator(fixture.root, {
        next: async () => ({ done: false, value: 1 }),
        close
      })
    await runTransactionOperation(fixture.root, () => {
      throw primary
    }).catch(() => undefined)
    /** Backend normalization codes the aggregate while retaining its native type on cause. */
    let failure: unknown
    try {
      await fixture.controller.closeIterators()
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
    const aggregate = (failure as Error).cause as AggregateError
    expect(aggregate).toBeInstanceOf(AggregateError)
    expect(aggregate.errors[0]).toBe(fixture.onFailure.mock.calls[0]![0])
    expect(aggregate.errors[0].cause).toBe(primary)
    expect(aggregate.errors.slice(1).map((error) => error.cause)).toEqual([...releases].reverse())
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1)
    await fixture.controller.closeIterators()
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })

  it('observes an unawaited late next failure and drains its actual resource before rollback', async () => {
    /** A discarded iterator Promise remains owned until its native request really settles. */
    const gate = Promise.withResolvers<IteratorResult<number>>()
    /** Native request failure must become the same first transaction failure. */
    const original = new Error('late native next failed')
    const fixture = setup()
    const close = vi.fn()
    const iterator = fixture.owner.registerIterator<IScope, number>(fixture.root, {
      next: () => gate.promise,
      close
    })
    void iterator.next()
    fixture.controller.stopAdmission()
    const final = fixture.controller.runFinalizers()
    gate.reject(original)
    await expect(final).rejects.toMatchObject({ cause: original })
    expect(close).toHaveBeenCalledTimes(1)
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    fixture.controller.close()
  })

  it('keeps a rejecting main cleanup Promise and reports once through cached symbolic cleanup', async () => {
    /** Existing host exception scheduling is the diagnostic seam; no new production reporter exists. */
    const reported: unknown[] = []
    /** Collect queued host exceptions at their original identity for this one resource failure. */
    const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      try {
        callback()
      } catch (error) {
        reported.push(error)
      }
    })
    try {
      /** The main rejection and report-only symbolic Promise represent one actual cleanup. */
      const fixture = setup()
      /** Native resource close rejects once with this exact source error. */
      const original = new Error('cursor release failed')
      /** Port invocation is independent of the number of cleanup entry points. */
      const close = vi.fn(() => {
        throw original
      })
      const iterator = fixture.owner.registerIterator(fixture.root, {
        next: async () => ({ done: false, value: 1 }),
        close
      })
      const main = iterator.dispose()
      await expect(main).rejects.toMatchObject({ cause: original })
      const symbolic = iterator[Symbol.asyncDispose]()
      expect(iterator[Symbol.asyncDispose]()).toBe(symbolic)
      expect(iterator.dispose()).toBe(main)
      await expect(symbolic).resolves.toBeUndefined()
      expect(close).toHaveBeenCalledTimes(1)
      expect(reported).toEqual([fixture.onFailure.mock.calls[0]![0]])
      fixture.controller.close()
    } finally {
      enqueue.mockRestore()
    }
  })
})

describe('same-owner iterator projection', () => {
  it('passes the real current view and drains it before closing both actual cursors once', async () => {
    /** The backend supplies one existing attempt signal for all derived query work. */
    const abort = new AbortController()
    /** The same real transaction owns both source cursors and the public derived iterator. */
    const fixture = setup({ context: { signal: abort.signal } })
    /** Deferred materialization remains admitted after the original user view closes. */
    const gate = Promise.withResolvers<void>()
    /** Later-created additional resources close before the original source. */
    const order: string[] = []
    /** Native source cleanup remains the original backend port. */
    const sourceClose = vi.fn(() => {
      order.push('source')
    })
    /** A second cursor can be created lazily with the currently authorized operation view. */
    const legacyClose = vi.fn(() => {
      order.push('legacy')
    })
    /** No public wrapper fabricates transaction authority for either actual cursor. */
    const source = fixture.owner.registerIterator(fixture.root, {
      next: async () => ({ done: false, value: 1 }),
      close: sourceClose
    })
    /** The second source exists only after the derived reader actually needs it. */
    let legacy: IStorageIterator<number> | undefined
    /** A saved operation view must expire when this complete mapped advance settles. */
    let current: object | undefined
    /** A complete query reader borrows the original view and native advance function. */
    const derived = deriveTransactionIterator(
      source,
      async (next, _fail, scope) => {
        current = scope
        expect(assertTransactionOwner(fixture.base, scope)).toBe(
          assertTransactionOwner(fixture.base, fixture.root)
        )
        expect(readTransactionOperationContext(scope)?.signal).toBe(abort.signal)
        await gate.promise
        /** Original source advancement and lazy second-source creation share this live view. */
        const first = await next()
        legacy = fixture.owner.registerIterator(scope as IScope, {
          next: async () => ({ done: false, value: 9 }),
          close: legacyClose
        })
        /** Secondary source reads reuse the same existing owner rather than a captured user view. */
        const second = await nextTransactionIterator(scope, legacy)
        return { done: false, value: first.value + second.value }
      },
      () => legacy?.dispose()
    )!
    /** Accepted materialization must finish before either native resource closes. */
    const pending = derived.next()
    fixture.controller.stopAdmission()
    /** The derived lifetime is the original owner's cached cleanup, including all accepted work. */
    const cleanup = derived.dispose()
    expect(derived.dispose()).toBe(cleanup)
    expect(order).toEqual([])
    gate.resolve()
    await expect(pending).resolves.toEqual({ done: false, value: 10 })
    await cleanup
    await derived[Symbol.asyncDispose]()
    expect(order).toEqual(['legacy', 'source'])
    expect(sourceClose).toHaveBeenCalledTimes(1)
    expect(legacyClose).toHaveBeenCalledTimes(1)
    expect(() => readTransactionOperationContext(current!)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await fixture.controller.closeIterators()
    fixture.controller.close()
  })

  it('preserves the primary error while attempting both original and additional cleanup', async () => {
    /** All failures use the backend's original normalization and first-failure state. */
    const fixture = setup()
    /** Query failure must remain the first reachable error when both cleanups fail. */
    const primary = new Error('query materialization failed')
    /** Original native cursor cleanup must still run after additional-source cleanup fails. */
    const sourceFailure = new Error('source cleanup failed')
    /** Both cleanup causes must remain reachable from the public main cleanup rejection. */
    const extraFailure = new Error('additional cursor cleanup failed')
    /** The original source belongs to the same real transaction owner. */
    const source = fixture.owner.registerIterator(fixture.root, {
      next: async () => ({ done: false, value: 1 }),
      close: () => {
        throw sourceFailure
      }
    })
    /** A real additional-source cleanup is invoked even after the original cleanup rejects. */
    const extra = vi.fn(() => {
      throw extraFailure
    })
    /** Failure propagation remains the original resource's fail function. */
    const derived = deriveTransactionIterator(
      source,
      async (_next, fail) => {
        throw fail(primary)
      },
      extra
    )!
    await expect(derived.next()).rejects.toMatchObject({ cause: primary })
    /** This exact backend-normalized primary remains first in the cleanup aggregate. */
    const first = fixture.onFailure.mock.calls[0]![0]
    /** Main cleanup rejects; the cached resource still attempts every owned close exactly once. */
    let failure: unknown
    try {
      await derived.dispose()
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
    /** The existing cleanup aggregate preserves the original normalized primary and both causes. */
    const aggregate = (failure as Error).cause as AggregateError
    expect(aggregate).toBeInstanceOf(AggregateError)
    expect(aggregate.errors[0]).toBe(first)
    expect(aggregate.errors[1].cause).toBe(extraFailure)
    expect(aggregate.errors[2].cause).toBe(sourceFailure)
    expect(extra).toHaveBeenCalledTimes(1)
    await fixture.controller.closeIterators()
    fixture.controller.close()
  })

  it('locks the first additional cleanup failure before attempting original source cleanup', async () => {
    /** Resource errors use the same first-failure path even without a preceding query failure. */
    const fixture = setup()
    /** The later-created resource fails first under reverse cleanup order. */
    const extraFailure = new Error('additional cursor failed first')
    /** Original cleanup must still run and preserve its distinct native cause. */
    const sourceFailure = new Error('original cursor failed second')
    /** Both actual close ports belong to this same transaction's resource lifetime. */
    const source = fixture.owner.registerIterator(fixture.root, {
      next: async () => ({ done: false, value: 1 }),
      close: () => {
        throw sourceFailure
      }
    })
    /** A two-argument reader remains valid when the current view is not needed. */
    const derived = deriveTransactionIterator(
      source,
      (next) => next(),
      () => {
        throw extraFailure
      }
    )!
    /** Main cleanup retains both failures while locking the actual first failure immediately. */
    let failure: unknown
    try {
      await derived.dispose()
    } catch (error) {
      failure = error
    }
    /** The original state records the first close failure, rather than the later native failure. */
    const first = fixture.onFailure.mock.calls[0]![0]
    expect(first.cause).toBe(extraFailure)
    /** Existing aggregate construction keeps the first normalized error before subsequent causes. */
    const aggregate = (failure as Error).cause as AggregateError
    expect(aggregate.errors[0]).toBe(first)
    expect(aggregate.errors[1].cause).toBe(sourceFailure)
    expect(fixture.onFailure).toHaveBeenCalledTimes(1)
    await fixture.controller.closeIterators()
    fixture.controller.close()
  })
})

describe('transaction public type contracts', () => {
  it('retains precise callbacks, complete scope, resource iterators and native normalization', () => {
    /** This compile-only caller proves synchronous and PromiseLike results retain Awaited inference. */
    function verify(store: IRecordStore<{ count: number }>, raw: AsyncIterableIterator<number>) {
      expectTypeOf(store.transaction((scope) => scope.getRecord('k'))).toEqualTypeOf<
        Promise<{ count: number } | undefined>
      >()
      expectTypeOf(store.transaction(() => 3 as const)).toEqualTypeOf<Promise<3>>()
      expectTypeOf<ITransactionScope['get']>().returns.toEqualTypeOf<Promise<string | null>>()
      expectTypeOf<ITransactionScope['isRecordIndexReady']>().toEqualTypeOf<
        ((handle: IRecordIndexHandle) => Promise<boolean>) | undefined
      >()
      // @ts-expect-error Plain iterators cannot promise explicit owned cleanup.
      const owned: IStorageIterator<number> = raw
      void owned
      // @ts-expect-error Legacy record write names are removed, not aliased.
      store.transaction((scope) => scope.put({ count: 1 }))
      // @ts-expect-error A bare Error does not satisfy backend source/code ownership.
      createTransactionOwner(store, () => new Error('uncoded'))
    }
    void verify
  })
})
