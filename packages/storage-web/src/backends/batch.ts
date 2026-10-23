import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  snapshotStorageKeyPrefix,
  type IStorageBatchKey,
  type IStorageStore
} from '@migaia/storage-contract'
import { observeStorageBatch, withAbort } from '@migaia/storage-host/authoring/backend'
import { storageBackendOperation } from '../constants.js'
import { StorageErrorText } from '../error-text.js'
import type { IBackendKind } from '../types/capabilities.js'
import { isStorageErrorFamily } from './errors.js'
import type { IBrowserBatchApi, IBackendRuntime } from './construction.js'

/** Browser operation labels retain the standard capability's method names on every native path. */
export const BrowserBatchMethod = {
  getMany: 'getMany',
  setMany: 'setMany',
  removeMany: 'removeMany',
  removeByPrefix: 'removeByPrefix'
} as const

/** Values are captured beside the canonical owner's detached keys before any batch can write. */
export type IBrowserBatchEntry = IStorageBatchKey & {
  readonly value: string
  readonly ttlMs?: number
}

/** Bind the real registration's observations and clock without creating an execution owner. */
export function observeBrowserBatch<R>(
  runtime: IBackendRuntime,
  store: IStorageStore<never>,
  operation: string,
  count: number | undefined,
  invoke: () => R | Promise<R>,
  scope?: object
): Promise<R> {
  /** Scope projection consults the same canonical view owner as each admitted native operation. */
  const stages = runtime.stageBindings.operationStages(store)
  return observeStorageBatch(
    scope === undefined ? stages : stages.forTransaction(scope),
    runtime.featureExpose.getScheduler(),
    operation,
    count,
    invoke
  )
}

/** Capture entry getters once, delegating all typed identity and duplicate rules to the key owner. */
export function snapshotBrowserBatchEntries(
  entries: Parameters<IBrowserBatchApi['setMany']>[0],
  backend: IBackendKind
): readonly IBrowserBatchEntry[] {
  try {
    if (!Array.isArray(entries)) throw new TypeError(StorageErrorText.storageBatchEntriesInvalid)
    /** The canonical owner keeps only this call's equality facts, without another backend Set. */
    const captureKey = createStorageBatchKeyCapture(backend)
    /** Detached fields retain no original entry getter across asynchronous admission. */
    const values: IBrowserBatchEntry[] = []
    /** An accessor-backed input length is borrowed once. */
    const length = entries.length
    for (let index = 0; index < length; index += 1) {
      const entry = entries[index]!
      const key = captureKey(entry.key)
      const value = entry.value
      const ttlMs = entry.ttlMs
      if (typeof value !== 'string') throw new TypeError(StorageErrorText.storageValueInvalid)
      if (ttlMs !== undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
      if (key.firstIndex !== index) throw new TypeError(StorageErrorText.storageBatchDuplicateKey)
      values.push({ ...key, value, ...(ttlMs === undefined ? {} : { ttlMs }) })
    }
    return values
  } catch (cause) {
    if (isStorageErrorFamily(cause)) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { backend, cause })
  }
}

/** Text backends expose real batch reads; multi-key writes require the host's actual WAL bridge. */
export function createTextBatchApi(
  backend: IBackendKind,
  runtime: IBackendRuntime,
  getStore: () => IStorageStore<never>,
  assertLive: () => void,
  read: (keys: readonly IStorageBatchKey[], operation: string) => readonly (string | undefined)[]
): IBrowserBatchApi {
  /** A missing atomic write owner is rejected before a caller can observe a partial mutation. */
  const unsupported = (): never => {
    throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
  }
  return {
    getMany: async (keys, ctx) => {
      assertLive()
      const captured = snapshotStorageBatchKeys(keys, backend)
      if (captured.length === 0) return []
      /** The same stable label identifies native cookie errors and the sole execution endpoint. */
      const operation = storageBackendOperation(backend, BrowserBatchMethod.getMany)
      return observeBrowserBatch(runtime, getStore(), operation, captured.length, () =>
        runtime.execution.run(
          { operation, input: captured.map((item) => item.key), ctx },
          (input) =>
            withAbort(ctx, async () => read(snapshotStorageBatchKeys(input, backend), operation))
        )
      )
    },
    setMany: async (entries) => {
      assertLive()
      const captured = snapshotBrowserBatchEntries(entries, backend)
      if (captured.length === 0) return
      unsupported()
    },
    removeMany: async (keys) => {
      assertLive()
      const captured = snapshotStorageBatchKeys(keys, backend)
      if (captured.length === 0) return 0
      return unsupported()
    },
    removeByPrefix: async (prefix) => {
      assertLive()
      snapshotStorageKeyPrefix(prefix, backend)
      return unsupported()
    }
  }
}
