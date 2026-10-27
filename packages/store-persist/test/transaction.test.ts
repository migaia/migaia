import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { binaryCodec } from '@migaia/storage-host/entity'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { createStore } from '@migaia/store-light'
import { ObservableMap } from '@migaia/store-indexed'
import { createAtomStore, familyDef } from '@migaia/store-keyed'
import { walkErrorCauses } from '@migaia/utils/error'
import {
  createTransactionOwner,
  runTransactionOperation,
  readTransactionOperationContext,
  useTransactionCapability,
  ConcurrencyPolicy
} from '@migaia/storage-host/sdk'
import {
  defineConcurrencyPolicy,
  StorageContractError,
  StorageContractErrorCode,
  TransactionActivityMode,
  type IRecordStore,
  type ICodec,
  type IStorageIterator,
  type IStorageKey,
  type ITransactionScope,
  type ITransactionOptions
} from '@migaia/storage-contract'
import {
  defaultJsonCodec,
  persistTransaction,
  persistUnit,
  readEnvelope,
  type IPersistUnit
} from '../src/index.js'
import { persist } from '../src/light-index.js'
import { persistCollection } from '../src/indexed-index.js'
import { persistKeyed } from '../src/keyed-index.js'
import { createMemoryTestStore } from './helpers/memory.js'
import {
  runPersistCrossTaskCodecScenario,
  runPersistNativeConsumerScenario
} from './helpers/native-transaction.js'

/** Local recording failures use one declared family; production backends retain their own errors. */
type IRecordingFailure = Error & { readonly source: string; readonly code: string }
/** These stable fixture diagnostics never claim native storage behavior. */
const recordingFailure = {
  source: 'recording-port',
  code: 'TRANSACTION_FAILED',
  message: 'recording port operation failed'
}
/** Symbol-backed backend extensions must survive the same capture as ordinary option fields. */
const recordingOption = Symbol('recording-option')
/** The local native entry retains concrete backend extensions in its original signature. */
type IRecordingOptions = ITransactionOptions & {
  readonly nativeTag?: object
  readonly [recordingOption]?: object
}

/** Preserve coded failures exactly, while retaining a raw fixture error as the cause. */
function normalizeFailure(cause: unknown): IRecordingFailure {
  if (cause instanceof Error && 'source' in cause && 'code' in cause)
    return cause as IRecordingFailure
  /** The canonical transaction owner captures this original normalizer. */
  const failure = new Error(recordingFailure.message, { cause })
  Object.defineProperties(failure, {
    source: { value: recordingFailure.source },
    code: { value: recordingFailure.code }
  })
  return failure as IRecordingFailure
}

/** A recording port tests coordination and conversion only; it does not model native atomicity. */
function recordingPort() {
  /** Actual request payloads reveal whether conversion happened before a mutable snapshot changed. */
  const writes: { key: string; text: string }[] = []
  /** Byte requests retain delivered values independently of later source mutations. */
  const byteWrites: number[][] = []
  /** Every transaction allocation is observable before any local request runs. */
  const entered = vi.fn()
  /** An empty iterator satisfies the unused record projection without constructing a query engine. */
  const emptyRecords = (): IStorageIterator<[IStorageKey, unknown]> => ({
    next: async () => ({ done: true, value: undefined }),
    return: async () => ({ done: true, value: undefined }),
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
    [Symbol.asyncIterator]() {
      return this
    }
  })
  /** Unused channels remain inert; only text requests are exercised by these local port cases. */
  const storage: Omit<IRecordStore, 'transaction'> & {
    transaction<TResult>(
      run: (scope: ITransactionScope) => TResult,
      options?: IRecordingOptions
    ): Promise<Awaited<TResult>>
  } = {
    backend: 'recording-port',
    capabilities: {
      syncRead: false,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      opaqueEntries: false,
      maxValueBytes: undefined
    },
    get: async () => null,
    set: async (key, text) => {
      writes.push({ key, text })
    },
    remove: async () => undefined,
    has: async () => false,
    keys: async () => [],
    clearValues: async () => undefined,
    clearAll: async () => undefined,
    getBytes: async () => null,
    setBytes: async (_key, bytes) => {
      byteWrites.push([...bytes])
    },
    removeBytes: async () => undefined,
    clearBytes: async () => undefined,
    getRecord: async () => undefined,
    putRecord: async (_value, key) => key ?? 1,
    deleteRecord: async () => undefined,
    clearRecords: async () => undefined,
    iterateRecords: emptyRecords,
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined,
    async transaction<TResult>(
      run: (scope: ITransactionScope) => TResult,
      options?: IRecordingOptions
    ): Promise<Awaited<TResult>> {
      entered(options)
      /** The canonical owner, rather than this port, owns views, pending work and the first failure. */
      const root = createScope()
      /** This scope lasts until all admitted combinations and their requests settle. */
      const controller = owner.register(root, { createScope, onFailure: () => undefined })
      try {
        /** Callback values preserve their normal Promise/thenable unfolding. */
        const result = await run(root)
        controller.stopAdmission()
        await controller.runFinalizers()
        return result
      } finally {
        controller.close()
      }
    }
  }
  /** The port uses the real owner with one declared error family instead of copying its state. */
  const owner = createTransactionOwner(storage, normalizeFailure, {
    activityMode: TransactionActivityMode.managed
  })

  /** Fresh method views prove flush uses its admitted scope rather than the captured root storage. */
  function createScope(): ITransactionScope {
    /** Each text request is registered under the same original owner. */
    const scope: ITransactionScope = {
      use: (capability) => useTransactionCapability(scope, capability),
      getMany: () => unsupportedBatch(scope),
      setMany: () => unsupportedBatch(scope),
      removeMany: () => unsupportedBatch(scope),
      removeByPrefix: () => unsupportedBatch(scope),
      get: storage.get,
      set: (key, text) => runTransactionOperation(scope, () => storage.set(key, text)),
      remove: storage.remove,
      has: storage.has,
      getBytes: storage.getBytes,
      setBytes: (key, bytes) => runTransactionOperation(scope, () => storage.setBytes(key, bytes)),
      removeBytes: storage.removeBytes,
      getRecord: storage.getRecord,
      putRecord: (value, key) => storage.putRecord(value, key),
      deleteRecord: storage.deleteRecord,
      iterateRecords: emptyRecords
    }
    return scope
  }
  /** This conversion fixture owns no batch backend and must not pretend to provide one. */
  function unsupportedBatch(scope: ITransactionScope): Promise<never> {
    return runTransactionOperation(scope, () => {
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: storage.backend
      })
    })
  }
  return { storage, writes, byteWrites, entered }
}

/**
 * One supported unit returns its original mutable object so accidental delayed conversion is
 * visible.
 */
function mutableUnit() {
  /** Snapshot and partialize deliberately retain this same object across every flush call. */
  const state = { count: 0 }
  /** The attachment owns the only installed notification callback. */
  let changed = (): void => undefined
  /** Persistence uses the ordinary public synchronous unit boundary. */
  const unit: IPersistUnit<typeof state> = {
    snapshot: () => state,
    restore: (value) => {
      Object.assign(state, value)
    },
    subscribe: (onChange) => {
      changed = onChange
      return () => {
        changed = () => undefined
      }
    }
  }
  return {
    unit,
    state,
    change: (count: number) => {
      state.count = count
      changed()
    }
  }
}

describe('persistence transaction local ports', () => {
  it('rejects busy slots through fail and custom policy without entering a second native callback', async () => {
    /** One active transaction holds the actual per-handle limiter until its callback completes. */
    const port = recordingPort()
    /** No automatic notification changes this handle during the admission check. */
    const value = mutableUnit()
    /** The canonical owner supplies the default; only the tested calls override it. */
    const handle = persistUnit(value.unit, {
      key: 'busy',
      storage: port.storage,
      runtime: createRuntime()
    })
    await handle.ready
    /** Callback entry and completion are explicit without another queue implementation. */
    const started = Promise.withResolvers<void>()
    /** The first transaction remains real work until conflicting calls settle. */
    const release = Promise.withResolvers<void>()
    /** This original callback owns the slot, so subsequent calls see a genuine conflict. */
    const holding = persistTransaction(port.storage, [handle], async () => {
      started.resolve()
      await release.promise
    })
    await started.promise
    /** Conflict ordinals must accumulate in the one canonical policy loop. */
    const conflicts: number[] = []
    /** The custom callback retries twice, then refuses the third real conflict. */
    const custom = defineConcurrencyPolicy({
      name: 'recording-retry-twice',
      locking: 'pessimistic',
      decide: ({ attempt }) => {
        conflicts.push(attempt)
        return attempt <= 2 ? { action: 'retry', delayMs: 0 } : { action: 'reject' }
      }
    })
    try {
      await expect(
        persistTransaction(port.storage, [handle], () => undefined, {
          concurrency: ConcurrencyPolicy.fail()
        })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      await expect(
        persistTransaction(port.storage, [handle], () => undefined, { concurrency: custom })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      expect(conflicts).toEqual([1, 2, 3])
      expect(port.entered).toHaveBeenCalledTimes(1)
    } finally {
      release.resolve()
      await holding
      await handle.disposeAsync()
    }
  })

  it('retains concrete own and symbol options on the actual context without restarting timeout', async () => {
    /** The local entry records the actual context delivered by the public coordinator. */
    const port = recordingPort()
    /** Snapshot content is irrelevant to this original options-boundary assertion. */
    const value = mutableUnit()
    /** The same authentic handle enlists without a structural wrapper. */
    const handle = persistUnit(value.unit, {
      key: 'options',
      storage: port.storage,
      runtime: createRuntime()
    })
    await handle.ready
    /** Values retain identity rather than being serialized by option capture. */
    const nativeTag = {}
    /** Symbol extensions are part of the concrete backend's original public options. */
    const symbolicTag = {}
    /** Borrowed accessors run only at the original public boundary. */
    let reads = 0
    try {
      await persistTransaction(port.storage, [handle], () => undefined, {
        get nativeTag() {
          reads++
          return nativeTag
        },
        [recordingOption]: symbolicTag,
        timeoutMs: 1_000
      })
      /** The attempt context carries timing ownership rather than another original timeout. */
      const delivered = port.entered.mock.calls[0]![0]!
      expect(delivered.nativeTag).toBe(nativeTag)
      expect(delivered[recordingOption]).toBe(symbolicTag)
      expect(delivered.timeoutMs).toBeUndefined()
      expect(delivered.admission).toBe('try')
      expect(typeof delivered.wait).toBe('function')
      expect(reads).toBe(1)
    } finally {
      await handle.disposeAsync()
    }
  })

  it('encodes each of two unawaited flush calls before the same snapshot object changes again', async () => {
    /** This test exercises the public coordinator and engine without claiming backend atomicity. */
    const port = recordingPort()
    /** Controlled debounce keeps post-commit mirroring out of the request-order assertion. */
    const scheduler = createManualScheduler()
    /** The same mutable state object is returned on every snapshot. */
    const value = mutableUnit()
    /** Status ownership follows the usual supported Runtime entry. */
    const handle = persistUnit(value.unit, {
      key: 'archive',
      storage: port.storage,
      runtime: createRuntime(),
      scheduler,
      debounceMs: 100
    })
    await handle.ready
    try {
      await persistTransaction(port.storage, [handle], async (tx) => {
        value.change(1)
        /** No await permits both encoding calls to occur within this synchronous callback turn. */
        const first = handle.flush(tx)
        value.change(2)
        /** The second call must keep count=2 even though the same object changes to count=3 next. */
        const second = handle.flush(tx)
        value.change(3)
        await Promise.all([first, second])
      })
      expect(port.writes.map(({ text }) => JSON.parse(text).state.count)).toEqual([1, 2])
      expect(value.state.count).toBe(3)
      expect(scheduler.pendingCount).toBe(1)
    } finally {
      await handle.disposeAsync()
    }
  })

  it('releases every slot after a resume scheduler throws and preserves the transaction primary', async () => {
    /**
     * Captured host reporting proves scheduling failures remain observable without replacing
     * primary.
     */
    const diagnostics: (() => void)[] = []
    vi.stubGlobal('queueMicrotask', (callback: () => void) => {
      diagnostics.push(callback)
    })
    /** The shared port counts actual entry across the failing transaction and its explicit retry. */
    const port = recordingPort()
    /** This exact coded failure must survive the finish path unchanged. */
    const primary = normalizeFailure(undefined)
    /** The ordinary scheduler boundary is permitted to fail when restoring dirty mirroring. */
    const schedulingFailure = new TypeError('resume scheduler fixture')
    /** Both original handles must release even when the first reverse-order finish fails. */
    const values = [mutableUnit(), mutableUnit()]
    /** A throwing scheduling callback is reached only when participation has ended. */
    const handles = values.map(({ unit }, index) =>
      persistUnit(unit, {
        key: String(index),
        storage: port.storage,
        runtime: createRuntime(),
        debounceMs: 100,
        scheduler: {
          now: () => 0,
          schedule: () => {
            throw schedulingFailure
          }
        }
      })
    )
    await Promise.all(handles.map((handle) => handle.ready))
    try {
      await expect(
        persistTransaction(port.storage, handles, () => {
          values[0]!.change(1)
          values[1]!.change(1)
          throw primary
        })
      ).rejects.toBe(primary)
      expect(handles.map((handle) => handle.writeError.value)).toEqual([
        schedulingFailure,
        schedulingFailure
      ])
      expect(diagnostics).toHaveLength(2)
      for (const report of diagnostics) expect(report).toThrow(schedulingFailure)
      /** A later call takes both released slots and commits a fresh snapshot through each view. */
      await persistTransaction(port.storage, [...handles].reverse(), async (tx) => {
        await Promise.all(handles.map((handle) => handle.flush(tx)))
      })
      expect(port.entered).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
      await Promise.all(handles.map((handle) => handle.disposeAsync()))
    }
  })

  it('owns byte snapshots before unawaited flush calls mutate the original buffer', async () => {
    /** The recording port checks delivery ownership without claiming native commit behavior. */
    const port = recordingPort()
    /** Both snapshot calls and the codec return this same original mutable buffer. */
    const bytes = new Uint8Array([1])
    /** The actual host byte codec is asynchronous and returns its original byte view. */
    const codec: ICodec = {
      name: 'byte-snapshot',
      output: 'binary',
      encode: (value) => binaryCodec.encode((value as { state: Uint8Array }).state),
      decode: (value) => binaryCodec.decode(value as Uint8Array)
    }
    /** The engine receives a normal unit whose byte state does not change identity. */
    const handle = persistUnit(
      { snapshot: () => bytes, restore: () => undefined, subscribe: () => () => undefined },
      {
        key: 'bytes',
        storage: port.storage,
        runtime: createRuntime(),
        codec
      }
    )
    await handle.ready
    try {
      await persistTransaction(port.storage, [handle], async (tx) => {
        /** Snapshot ownership must be established before the async codec yields to the caller. */
        const first = handle.flush(tx)
        bytes[0] = 2
        /** The second queued write owns two even though the original buffer next changes to three. */
        const second = handle.flush(tx)
        bytes[0] = 3
        await Promise.all([first, second])
      })
      expect(port.byteWrites).toEqual([[1], [2]])
      expect(bytes[0]).toBe(3)
    } finally {
      await handle.disposeAsync()
    }
  })
})

describe('persistence transactions through actual memory ownership', () => {
  it('commits entity and snapshot together, rolls both back, and restores ordinary mirroring', async () => {
    /**
     * The production host registration supplies the native scope and its original transaction
     * owner.
     */
    const host = await createStorageHost({
      plugins: [memoryBackendPlugin({}, { notifications: memoryNotificationsFeature() })]
    })
    onTestFinished(() => host.dispose())
    /** This workflow observes original backend commits while ordinary fixtures remain basic. */
    const storage = host.backend('memory')
    /** This exact business workflow is also consumed by the original native browser fixture. */
    const result = await runPersistNativeConsumerScenario(storage)
    expect(result.committed).toEqual({
      result: 'committed',
      envelope: { version: 0, state: { count: 1 } },
      entity: { id: 'committed', email: 'one' },
      business: 'committed'
    })
    expect(result.rolledBack).toEqual({
      primaryReachable: true,
      envelope: { version: 0, state: { count: 1 } },
      entity: undefined,
      business: null,
      memory: 2,
      writeErrorSame: true
    })
    expect(result.mirrored).toEqual({ version: 0, state: { count: 2 } })
    expect(result.unique).toEqual({
      code: 'INDEX_UNIQUE_CONFLICT',
      envelope: { version: 0, state: { count: 2 } },
      entity: undefined,
      memory: 3
    })
    expect(result.cancelled).toEqual({
      reasonReachable: true,
      envelope: { version: 0, state: { count: 3 } },
      entity: undefined,
      memory: 4
    })
    expect(result.restored).toEqual({
      primaryReachable: true,
      envelope: { version: 0, state: { count: 4 } },
      entity: undefined,
      memory: 4
    })
  })

  it('awaits a real asynchronous codec when the native memory backend supports it', async () => {
    /** Memory, unlike browser IndexedDB, permits conversion after the timer task boundary. */
    const storage = await createMemoryTestStore()
    expect(await runPersistCrossTaskCodecScenario(storage)).toEqual({
      failed: false,
      code: undefined,
      causeName: undefined,
      operationAndOuterSame: false,
      envelope: { version: 0, state: { count: 1 } },
      business: 'during',
      memory: 1
    })
  })

  it('enlists the three original adapter handles without copying their private authority', async () => {
    /** Each facade attaches to the same actual host-published record store. */
    const storage = await createMemoryTestStore()
    /** One existing reactive runtime owns notifications from all three application containers. */
    const runtime = createRuntime()
    /** The ordinary public store adapter retains its own synchronous application state. */
    const store = createStore({ count: 0 }, { runtime })
    /** The collection adapter retains its real Map snapshot representation. */
    const collection = new ObservableMap<string, number>(undefined, runtime)
    /** The keyed adapter receives the actual writable atom rather than a structural projection. */
    const atoms = createAtomStore(runtime)
    /** This public definition is shared by mutation and the persistence adapter. */
    const definition = familyDef(() => ({ count: 0 }))('counter')
    /** The stable list contains the exact original handles returned by the three facades. */
    const handles = [
      persist(store, { key: 'adapter-store', storage }),
      persistCollection(collection, { key: 'adapter-collection', storage }),
      persistKeyed(atoms, definition, 'counter', { namespace: 'adapter-keyed', storage })
    ] as const
    await Promise.all(handles.map((handle) => handle.ready))
    try {
      await persistTransaction(storage, handles, async (tx) => {
        store.count = 7
        collection.set('count', 7)
        atoms.set(definition, { count: 7 })
        runtime.flush()
        for (const handle of handles) await handle.flush(tx)
      })
      expect(await readEnvelope(storage, 'adapter-store', defaultJsonCodec, {})).toEqual({
        version: 0,
        state: { count: 7 }
      })
      expect(await readEnvelope(storage, 'adapter-collection', defaultJsonCodec, {})).toEqual({
        version: 0,
        state: new Map([['count', 7]])
      })
      expect(await readEnvelope(storage, 'adapter-keyed:counter', defaultJsonCodec, {})).toEqual({
        version: 0,
        state: { count: 7 }
      })
    } finally {
      await Promise.all(handles.map((handle) => handle.disposeAsync()))
      await store.$dispose()
    }
  })

  it('rejects invalid participation before a native transaction and blocks direct writes while enlisted', async () => {
    /**
     * Distinct real registrations make storage mismatches observable without fake transaction
     * owners.
     */
    const storage = await createMemoryTestStore()
    /** This second actual store cannot lend its attachment to the first store's native transaction. */
    const foreign = await createMemoryTestStore()
    /** Original callback entry is measured only after all supported admission checks. */
    const entered = vi.fn()
    /** The captured original method keeps its real host, native scope and owner. */
    const transaction = storage.transaction
    storage.transaction = (run, options) => {
      entered()
      return transaction(run, options)
    }
    /** Both attachment identities remain genuine until their explicit disposal. */
    const value = mutableUnit()
    /** This enlisted handle owns the first original store. */
    const handle = persistUnit(value.unit, { key: 'admission', storage, runtime: createRuntime() })
    /** A genuine but unlisted attachment is different from an enlisted derived scope. */
    const unlisted = persistUnit(mutableUnit().unit, {
      key: 'unlisted',
      storage,
      runtime: createRuntime()
    })
    /** A foreign handle is legitimate by itself, but belongs to another native owner. */
    const other = persistUnit(mutableUnit().unit, {
      key: 'foreign',
      storage: foreign,
      runtime: createRuntime()
    })
    await Promise.all([handle.ready, unlisted.ready, other.ready])
    /** The business callback must not be invoked for any failed preflight. */
    const run = vi.fn()
    try {
      for (const handles of [[], [{ ...handle }], [handle, other]])
        await expect(persistTransaction(storage, handles, run)).rejects.toMatchObject({
          code: 'INVALID_OPTION'
        })
      await expect(persistTransaction(foreign, [handle], run)).rejects.toMatchObject({
        code: 'INVALID_OPTION'
      })
      expect(entered).not.toHaveBeenCalled()
      expect(run).not.toHaveBeenCalled()
      await persistTransaction(storage, [handle, handle], async (tx) => {
        for (const direct of [
          () => handle.flush(),
          () => handle.clear(),
          () => handle.retryHydrate()
        ])
          await expect(direct()).rejects.toMatchObject({ code: 'INVALID_OPTION' })
        await expect(unlisted.flush(tx)).rejects.toMatchObject({ code: 'INVALID_OPTION' })
        await expect(handle.flush({ ...tx })).rejects.toMatchObject({ code: 'INVALID_OPTION' })
        await handle.flush(tx)
      })
      expect(entered).toHaveBeenCalledTimes(1)
      expect(await storage.get('unlisted')).toBeNull()
      expect(await foreign.get('foreign')).toBeNull()
    } finally {
      await Promise.all([handle, unlisted, other].map((current) => current.disposeAsync()))
    }
  })

  it.each([false, true])(
    'drains an admitted old write before native entry; failure=%s',
    async (reject) => {
      /** Real root writes may complete asynchronously before the coordinator opens its native scope. */
      const storage = await createMemoryTestStore()
      /** The original writer still performs every successful backend mutation. */
      const set = storage.set
      /** This gate represents one already-admitted old adapter call, without a second write queue. */
      const release = Promise.withResolvers<void>()
      /** Original adapter entry makes the old write overlap deterministic. */
      const started = Promise.withResolvers<void>()
      /** Failed old work must keep this exact rejection identity at the coordinator boundary. */
      const primary = new Error('old persistence write failed')
      /** Only the first root write is delayed; explicit retry uses the untouched backend owner. */
      let delayed = true
      storage.set = async (key, text, options) => {
        if (delayed) {
          delayed = false
          started.resolve()
          await release.promise
          if (reject) throw primary
        }
        return set(key, text, options)
      }
      /** The actual native callback must stay closed while admitted older work is unresolved. */
      const entered = vi.fn()
      /** Original transaction allocation remains observable without replacing its scope. */
      const transaction = storage.transaction
      storage.transaction = (run, options) => {
        entered()
        return transaction(run, options)
      }
      /** Direct subscription notifications belong to this actual persistence unit. */
      const value = mutableUnit()
      /** No debounce is used before participation, so one old write is genuinely in flight. */
      const handle = persistUnit(value.unit, {
        key: 'old-write',
        storage,
        runtime: createRuntime()
      })
      await handle.ready
      value.change(1)
      await started.promise
      /** New notification during pause must not create a bypass write behind the native snapshot. */
      const pending = persistTransaction(storage, [handle], async (tx) => {
        value.change(3)
        await handle.flush(tx)
      })
      /** Observe this expected rejection immediately while the old request remains admitted. */
      const outcome = pending.then(
        () => undefined,
        (cause: unknown) => cause
      )
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(entered).not.toHaveBeenCalled()
        value.change(2)
        release.resolve()
        if (reject) {
          expect(await outcome).toBe(primary)
          expect(entered).not.toHaveBeenCalled()
          await persistTransaction(storage, [handle], (tx) => handle.flush(tx))
        } else expect(await outcome).toBeUndefined()
        expect(entered).toHaveBeenCalledTimes(1)
        expect(await readEnvelope(storage, 'old-write', defaultJsonCodec, {})).toEqual({
          version: 0,
          state: { count: reject ? 2 : 3 }
        })
      } finally {
        release.resolve()
        await outcome
        await handle.disposeAsync()
      }
    }
  )

  it('releases slots after hydration failure and permits an explicit successful retry', async () => {
    /** The original backend remains reusable after the failed initial adapter read. */
    const storage = await createMemoryTestStore()
    /** Only hydration is delayed and failed; subsequent I/O still uses the same registered store. */
    const get = storage.get
    /** This gate keeps initial hydration unresolved while the coordinator enlists the handle. */
    const release = Promise.withResolvers<void>()
    /** The expected hydration error must cross coordination unchanged. */
    const primary = new Error('participating hydration failed')
    storage.get = async () => {
      await release.promise
      throw primary
    }
    /** Only a real native transaction should increment this finite admission count. */
    const entered = vi.fn()
    /** Preserve the original method's owner and exact backend options. */
    const transaction = storage.transaction
    storage.transaction = (run, options) => {
      entered()
      return transaction(run, options)
    }
    /** The initial unit and handle retain authentic private enlistment identity. */
    const value = mutableUnit()
    /** Initial hydration is deliberately still pending when explicit coordination starts. */
    const handle = persistUnit(value.unit, { key: 'hydrate', storage, runtime: createRuntime() })
    /** The expected initial failure is observed independently from the coordination result. */
    const ready = handle.ready.catch((cause: unknown) => cause)
    /** This business callback must stay uncalled when hydration cannot finish. */
    const run = vi.fn()
    /** Rejection is observed before releasing the delayed initial read. */
    const pending = persistTransaction(storage, [handle], run).catch((cause: unknown) => cause)
    release.resolve()
    expect(await ready).toBe(primary)
    expect(await pending).toBe(primary)
    expect(entered).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    storage.get = get
    try {
      await handle.retryHydrate()
      await persistTransaction(storage, [handle], (tx) => handle.flush(tx))
      expect(entered).toHaveBeenCalledTimes(1)
    } finally {
      await handle.disposeAsync()
    }
  })

  it('orders reversed handle arrays and removes an aborted actual FIFO waiter', async () => {
    /**
     * Every native attempt uses the original production store and its real transaction
     * registration.
     */
    const storage = await createMemoryTestStore()
    /** Two actual original handles are enough to expose conflicting public array order. */
    const handles = ['first', 'second'].map((key) =>
      persistUnit(mutableUnit().unit, { key, storage, runtime: createRuntime() })
    )
    await Promise.all(handles.map((handle) => handle.ready))
    /** The first callback holds its actual participation slots until its own work ends. */
    const started = Promise.withResolvers<void>()
    /** Original accepted work, rather than a fabricated lock holder, controls contention. */
    const release = Promise.withResolvers<void>()
    /** The ordering evidence records only actual native callback entry. */
    const order: string[] = []
    /** One real owner holds both participant slots before the second reversed request arrives. */
    const holding = persistTransaction(storage, handles, async () => {
      order.push('holding')
      started.resolve()
      await release.promise
    })
    await started.promise
    /** Cancellation must remove this actual queued limiter task without ever calling its callback. */
    const controller = new AbortController()
    /** The exact arbitrary reason must stay reachable through the existing abort error boundary. */
    const reason = new Error('cancel queued persistence transaction')
    /** This user callback is not accepted until both original slots are acquired. */
    const cancelled = vi.fn()
    /** Observe rejection immediately; no owner or policy is substituted by the fixture. */
    const queued = persistTransaction(storage, [...handles].reverse(), cancelled, {
      signal: controller.signal
    }).catch((cause: unknown) => cause)
    controller.abort(reason)
    /** Another request uses the opposite input order and must later finish without a deadlock. */
    const next = persistTransaction(storage, [...handles].reverse(), async (tx) => {
      order.push('next')
      await Promise.all(handles.map((handle) => handle.flush(tx)))
    })
    try {
      expect(walkErrorCauses(await queued)).toContain(reason)
      expect(cancelled).not.toHaveBeenCalled()
      release.resolve()
      await Promise.all([holding, next])
      expect(order).toEqual(['holding', 'next'])
    } finally {
      release.resolve()
      await Promise.allSettled([holding, next])
      await Promise.all(handles.map((handle) => handle.disposeAsync()))
    }
  })

  it('aborts immediately on handle disposal and drains the accepted callback before releasing slots', async () => {
    /** The original native memory draft must remain uncommitted until the callback settles. */
    const storage = await createMemoryTestStore()
    /** Manual debounce makes a forbidden final root write observable after disposal. */
    const scheduler = createManualScheduler()
    /** The application state survives native rollback and synchronous attachment disposal. */
    const value = mutableUnit()
    /** Only this authentic attachment participates in the active transaction. */
    const handle = persistUnit(value.unit, {
      key: 'dispose',
      storage,
      runtime: createRuntime(),
      scheduler,
      debounceMs: 100
    })
    await handle.ready
    await handle.flush()
    /** The fixture releases genuine already-accepted callback work after cancellation starts. */
    const release = Promise.withResolvers<void>()
    /** Both actual draft requests are complete before handle disposal races the callback. */
    const started = Promise.withResolvers<void>()
    /** The original coordinator owns this native completion; observe its failure immediately. */
    const pending = persistTransaction(storage, [handle], async (tx) => {
      value.change(1)
      await handle.flush(tx)
      await tx.set('dispose-business', 'during')
      started.resolve()
      await release.promise
    }).catch((cause: unknown) => cause)
    await started.promise
    handle.dispose()
    /** Calling async disposal afterward must retain the same real transaction drain. */
    const disposal = handle.disposeAsync()
    /** Completion cannot be merely the fact that cancellation was requested. */
    let disposed = false
    void disposal.then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release.resolve()
    expect(await pending).toMatchObject({ code: 'ABORTED_BY_DISPOSE' })
    await disposal
    scheduler.advance(100)
    expect(await readEnvelope(storage, 'dispose', defaultJsonCodec, {})).toEqual({
      version: 0,
      state: { count: 0 }
    })
    expect(await storage.get('dispose-business')).toBeNull()
    expect(value.state.count).toBe(1)
    expect(scheduler.pendingCount).toBe(0)
  })

  it('rolls back native writes when the original transaction budget expires', async () => {
    /** No second timeout or backend budget is introduced by the persistence consumer. */
    const storage = await createMemoryTestStore()
    /** The original debounce remains paused until native rollback is complete. */
    const scheduler = createManualScheduler()
    /** Application memory survives the same original attempt's timeout. */
    const value = mutableUnit()
    /** This authentic handle uses the real transaction store for both ordinary and scoped writes. */
    const handle = persistUnit(value.unit, {
      key: 'timeout',
      storage,
      runtime: createRuntime(),
      scheduler,
      debounceMs: 100
    })
    await handle.ready
    await handle.flush()
    /** The deadline reason is captured from the original attempt signal for identity comparison. */
    let timeoutReason: unknown
    try {
      /** The cooperative callback waits for the actual captured attempt signal, not a local race. */
      const failure = await persistTransaction(
        storage,
        [handle],
        async (tx) => {
          value.change(1)
          await handle.flush(tx)
          await tx.set('timeout-business', 'during')
          /** This read-only original owner seam returns the same attempt's borrowed signal. */
          const signal = readTransactionOperationContext(tx)!.signal!
          await new Promise<void>((resolve) => {
            /** The existing budget supplies both cancellation and its original coded reason. */
            const aborted = () => {
              timeoutReason = signal.reason
              resolve()
            }
            if (signal.aborted) aborted()
            else signal.addEventListener?.('abort', aborted, { once: true })
          })
        },
        { timeoutMs: 20 }
      ).catch((cause: unknown) => cause)
      expect(failure).toMatchObject({ code: 'ABORTED' })
      expect(walkErrorCauses(failure)).toContain(timeoutReason)
      expect(await readEnvelope(storage, 'timeout', defaultJsonCodec, {})).toEqual({
        version: 0,
        state: { count: 0 }
      })
      expect(await storage.get('timeout-business')).toBeNull()
      expect(value.state.count).toBe(1)
      scheduler.advance(100)
      await vi.waitFor(async () =>
        expect(await readEnvelope(storage, 'timeout', defaultJsonCodec, {})).toEqual({
          version: 0,
          state: { count: 1 }
        })
      )
    } finally {
      await handle.disposeAsync()
    }
  })

  it('commits each handle last call-time snapshot through real text and byte channels', async () => {
    /** Both native channels belong to the exact same transaction and original host. */
    const storage = await createMemoryTestStore()
    /** These buffers deliberately retain their identity as the caller mutates them. */
    const bytes = new Uint8Array([1])
    /** The text unit likewise retains its original mutable snapshot object. */
    const text = mutableUnit()
    /** Pause post-commit ordinary mirroring until the committed call-time snapshots are inspected. */
    const scheduler = createManualScheduler()
    /**
     * The genuine byte codec returns original input, so persistence must establish snapshot
     * ownership.
     */
    const codec: ICodec = {
      name: 'native-byte-snapshot',
      output: 'binary',
      encode: (envelope) => binaryCodec.encode((envelope as { state: Uint8Array }).state),
      decode: (value) => binaryCodec.decode(value as Uint8Array)
    }
    /** A real text handle enlists beside a real byte handle, without another storage adapter. */
    const handles = [
      persistUnit(text.unit, {
        key: 'snapshot-text',
        storage,
        runtime: createRuntime(),
        scheduler,
        debounceMs: 100
      }),
      persistUnit(
        { snapshot: () => bytes, restore: () => undefined, subscribe: () => () => undefined },
        {
          key: 'snapshot-bytes',
          storage,
          runtime: createRuntime(),
          codec
        }
      )
    ] as const
    await Promise.all(handles.map((handle) => handle.ready))
    try {
      await persistTransaction(storage, handles, async (tx) => {
        text.change(1)
        /** First call snapshots are admitted before either original mutable value changes. */
        const first = handles.map((handle) => handle.flush(tx))
        text.change(2)
        bytes[0] = 2
        /** Each handle retains its own ordered native request chain. */
        const second = handles.map((handle) => handle.flush(tx))
        text.change(3)
        bytes[0] = 3
        await Promise.all([...first, ...second])
      })
      expect(await readEnvelope(storage, 'snapshot-text', defaultJsonCodec, {})).toEqual({
        version: 0,
        state: { count: 2 }
      })
      expect(await storage.getBytes('snapshot-bytes')).toEqual(new Uint8Array([2]))
      expect(text.state.count).toBe(3)
      expect(bytes[0]).toBe(3)
    } finally {
      await Promise.all(handles.map((handle) => handle.disposeAsync()))
    }
  })

  it.each(['snapshot', 'partialize', 'codec', 'pipeline'] as const)(
    'retains %s failure and rolls back caught or unawaited flush work',
    async (stage) => {
      for (const caught of [false, true]) {
        /** The exact preparation failure must survive the one canonical transaction owner. */
        const primary = new Error(`persist ${stage} failure fixture`)
        /** Only the actual transactional flush fails; ordinary restored mirroring remains usable. */
        let failing = false
        /** Interception belongs to the real host installation window and its original pipeline. */
        const intervention = definePlugin('persist-failure', (core) => ({
          install: () => {
            core.useAsyncPipeline((input, next) => {
              if (
                failing &&
                stage === 'pipeline' &&
                input.scope !== undefined &&
                input.operation === 'set' &&
                (input.input as { readonly key?: string }).key === 'failed-flush'
              )
                throw primary
              return next(input)
            })
            return {}
          }
        }))
        await using host = await createStorageHost({
          plugins: [memoryBackendPlugin(), intervention]
        })
        /** This original store's isolated draft remains the only native commit authority. */
        const storage = host.backend('memory')
        /** Caller state changes before snapshot conversion and remains changed after native failure. */
        const value = mutableUnit()
        /** Automatic mirror restoration reuses the handle's existing debounce window. */
        const scheduler = createManualScheduler()
        /** Every non-failing conversion delegates to the original production codec. */
        const codec: ICodec = {
          name: 'transaction-failure-fixture',
          output: 'text',
          encode: (envelope) => {
            if (failing && stage === 'codec') throw primary
            return defaultJsonCodec.encode(envelope)
          },
          decode: (text) => defaultJsonCodec.decode(text)
        }
        /** Snapshot and partialize failures enter the same original synchronous flush admission. */
        const handle = persistUnit(
          {
            ...value.unit,
            snapshot: () => {
              if (failing && stage === 'snapshot') throw primary
              return value.unit.snapshot()
            }
          },
          {
            key: 'failed-flush',
            storage,
            runtime: createRuntime(),
            codec,
            scheduler,
            debounceMs: 100,
            partialize: (state) => {
              if (failing && stage === 'partialize') throw primary
              return state
            }
          }
        )
        await handle.ready
        await handle.flush()
        /**
         * The flush Promise itself must reject with the same normalized first failure as outer
         * work.
         */
        let operation: Promise<void> | undefined
        try {
          failing = true
          /**
           * The earlier native channel write proves failure rolls back more than the failed
           * request.
           */
          const failure = await persistTransaction(storage, [handle], async (tx) => {
            value.change(1)
            await tx.set('before-failed-flush', 'during')
            operation = handle.flush(tx)
            if (caught) await operation.catch(() => undefined)
          }).catch((cause: unknown) => cause)
          expect(walkErrorCauses(failure)).toContain(primary)
          expect(await operation!.catch((cause: unknown) => cause)).toBe(failure)
          expect(await readEnvelope(storage, 'failed-flush', defaultJsonCodec, {})).toEqual({
            version: 0,
            state: { count: 0 }
          })
          expect(await storage.get('before-failed-flush')).toBeNull()
          expect(value.state.count).toBe(1)
          failing = false
          scheduler.advance(100)
          await vi.waitFor(async () =>
            expect(await readEnvelope(storage, 'failed-flush', defaultJsonCodec, {})).toEqual({
              version: 0,
              state: { count: 1 }
            })
          )
        } finally {
          failing = false
          await handle.disposeAsync()
        }
      }
    }
  )
})
