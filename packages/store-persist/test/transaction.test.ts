import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { binaryCodec } from '@migaia/storage-host/entity'
import {
  createTransactionOwner,
  ConcurrencyPolicy,
  defineConcurrencyPolicy,
  runTransactionOperation,
  useTransactionCapability,
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
import { persistTransaction, persistUnit, type IPersistUnit } from '../src/index.js'

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
