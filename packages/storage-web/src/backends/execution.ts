import type { IStorageBase, IOperationContext, ILockKey } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-contract'
import type { IBackendRuntime } from './construction.js'
import { storageBackendOperation } from '../constants.js'

/** Declared async endpoints retain the exact existing operation-context argument position. */
const asyncEndpoints = {
  get: 1,
  set: 2,
  remove: 1,
  has: 1,
  keys: 0,
  clearValues: 0,
  clearAll: 0,
  getBytes: 1,
  setBytes: 2,
  removeBytes: 1,
  clearBytes: 0,
  getRecord: 1,
  putRecord: 2,
  deleteRecord: 1,
  clearRecords: 0,
  ensureRecordIndexes: 2,
  getRecordIndexReadiness: 1,
  inspectLocks: 0
} as const

/** The sync projection publishes only the already-declared synchronous KV endpoints. */
const syncEndpoints = { get: 1, set: 2, remove: 1, has: 1, keys: 0, clearValues: 0 } as const

/** Native metadata remains a separate existing group with its original context slots. */
const metadataEndpoints = { get: 1, set: 2, delete: 1 } as const

/** Text-only native backends supply their canonical scalar facts after pipeline input capture. */
export const textExecutionKeys = (name: string, args: readonly unknown[]): readonly ILockKey[] =>
  (name === 'get' || name === 'set' || name === 'remove' || name === 'has') &&
  typeof args[0] === 'string'
    ? [lockKey.text(args[0])]
    : []

/**
 * Attach the host's existing execution boundary to concrete browser methods. This mutates the
 * original backend object before provider admission; it creates no executor, queue or lifetime.
 */
export function bindBrowserExecution<TStore extends IStorageBase>(
  store: TStore,
  runtime: IBackendRuntime,
  ownExecution: readonly string[] = [],
  keyFacts?: (name: string, captured: readonly unknown[]) => readonly ILockKey[]
): TStore {
  /** Methods are captured once while the concrete backend is still private to construction. */
  const target = store as TStore & Record<string, unknown>
  bindGroup(target, target, asyncEndpoints)
  if (typeof target.metadata === 'object' && target.metadata !== null)
    bindGroup(target.metadata, target.metadata, metadataEndpoints, 'metadata')
  if (typeof target.sync === 'object' && target.sync !== null) {
    /** Async business functions retain their private sync primitives and never re-enter this view. */
    const original = target.sync
    /** The public sync view delegates to the same primitive exactly once through the sync runner. */
    const projection = Object.create(null) as Record<string, unknown>
    bindGroup(original, projection, syncEndpoints, undefined, true)
    Object.defineProperty(target, 'sync', {
      value: projection,
      enumerable: true,
      configurable: true
    })
  }
  return store

  /** A fixed method table supplies backend-specific arguments to the one host execution port. */
  function bindGroup(
    receiver: object,
    destination: object,
    endpoints: Readonly<Record<string, number>>,
    group?: string,
    sync = false
  ): void {
    for (const [name, contextIndex] of Object.entries(endpoints)) {
      /** Native root coordinators already enclose their complete admission/terminal pipeline. */
      if (!sync && group === undefined && ownExecution.includes(name)) continue
      /** Absent optional native APIs remain absent rather than gaining a placeholder endpoint. */
      const method = Reflect.get(receiver, name) as unknown
      if (typeof method !== 'function') continue
      /** Stable operation labels are formed in the package's existing contract-string owner. */
      const operation = storageBackendOperation(store.backend, name, group)
      Object.defineProperty(destination, name, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: (...args: unknown[]) => {
          /** The original context is borrowed, without cloning or reading any option getter here. */
          let current = args
          const request = {
            operation,
            input: args,
            ctx: args[contextIndex] as IOperationContext,
            ...(keyFacts === undefined ? {} : { keys: () => keyFacts(name, current) })
          }
          return sync
            ? runtime.execution.runSync(request, (captured) =>
                Reflect.apply(method, receiver, captured)
              )
            : runtime.execution.run(request, (captured) => {
                current = captured
                return Reflect.apply(method, receiver, captured) as Promise<unknown>
              })
        }
      })
    }
  }
}
