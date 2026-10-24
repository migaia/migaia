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

/** One endpoint delegates through the original object, preserving native and class receivers. */
type IBrowserEndpointBinding = {
  readonly receiver: Record<string, (...args: unknown[]) => unknown>
  readonly name: string
  readonly contextIndex: number
  readonly operation: string
  readonly runtime: IBackendRuntime
  readonly sync: boolean
  readonly keyFacts?: (name: string, captured: readonly unknown[]) => readonly ILockKey[]
}

/**
 * Publish the host execution boundary before provider admission. The original backend remains
 * private, so its methods can be called directly without replacing or recursively re-entering
 * them.
 */
export function bindBrowserExecution<TStore extends IStorageBase>(
  store: TStore,
  runtime: IBackendRuntime,
  ownExecution: readonly string[] = [],
  keyFacts?: (name: string, captured: readonly unknown[]) => readonly ILockKey[]
): TStore {
  /** This projection separates public execution ports from their original native receivers. */
  const projection = { ...store } as TStore & Record<string, unknown>
  bindGroup(store, projection, asyncEndpoints, store.backend, runtime, ownExecution, keyFacts)
  /** Optional native groups are published on the same ordinary execution projection. */
  const groups: Record<string, unknown> = projection
  if (typeof groups.metadata === 'object' && groups.metadata !== null) {
    /** Metadata keeps its original receiver while the public group enters the host once. */
    const metadata = { ...groups.metadata }
    bindGroup(
      groups.metadata,
      metadata,
      metadataEndpoints,
      store.backend,
      runtime,
      [],
      keyFacts,
      'metadata'
    )
    groups.metadata = metadata
  }
  if (typeof groups.sync === 'object' && groups.sync !== null) {
    /** Native async methods retain their private synchronous primitives. */
    const sync = Object.create(null) as Record<string, unknown>
    bindGroup(
      groups.sync,
      sync,
      syncEndpoints,
      store.backend,
      runtime,
      [],
      keyFacts,
      undefined,
      true
    )
    groups.sync = sync
  }
  return projection
}

/** A fixed endpoint table binds one native group to the existing host execution port. */
function bindGroup(
  receiver: object,
  destination: object,
  endpoints: Readonly<Record<string, number>>,
  backend: IStorageBase['backend'],
  runtime: IBackendRuntime,
  ownExecution: readonly string[],
  keyFacts?: IBrowserEndpointBinding['keyFacts'],
  group?: string,
  sync = false
): void {
  /** The native source is retained for direct method dispatch with its original receiver. */
  const source = receiver as IBrowserEndpointBinding['receiver']
  for (const [name, contextIndex] of Object.entries(endpoints)) {
    if (!sync && group === undefined && ownExecution.includes(name)) continue
    if (typeof source[name] !== 'function') continue
    /** One published endpoint retains only its original source and execution facts. */
    const binding: IBrowserEndpointBinding = {
      receiver: source,
      name,
      contextIndex,
      operation: storageBackendOperation(backend, name, group),
      runtime,
      sync,
      keyFacts
    }
    Object.defineProperty(destination, name, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: (...args: unknown[]) => runBrowserEndpoint(binding, args)
    })
  }
}

/** Capture operation input through the host, then invoke the original method on its owner. */
function runBrowserEndpoint(binding: IBrowserEndpointBinding, args: unknown[]): unknown {
  /** The key projection follows the host-captured input chosen for this admitted operation. */
  let current = args
  /** The host alone owns input capture, cancellation, deadlines and operation completion. */
  const request = {
    operation: binding.operation,
    input: args,
    ctx: args[binding.contextIndex] as IOperationContext,
    ...(binding.keyFacts === undefined
      ? {}
      : { keys: () => binding.keyFacts!(binding.name, current) })
  }
  return binding.sync
    ? binding.runtime.execution.runSync(request, (captured) =>
        binding.receiver[binding.name]!(...captured)
      )
    : binding.runtime.execution.run(request, (captured) => {
        current = captured
        return binding.receiver[binding.name]!(...captured) as Promise<unknown>
      })
}
