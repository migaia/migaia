import type { IStorageIterator, IOperationContext } from '@migaia/storage-contract'
import type { IStorageExecutionPort } from '@migaia/storage-host'
import { asyncDisposeKey } from '@migaia/plugin-host'
import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'

/** Add resource disposal to the original generator; its native return owns all actual cleanup. */
export function withStorageIteratorResource<T>(
  iterator: AsyncGenerator<T, void, unknown>,
  endpoint: {
    readonly execution: IStorageExecutionPort
    readonly operation: string
    readonly ctx?: IOperationContext
  }
): IStorageIterator<T> {
  /** The existing generator owns advancement and queuing; the host only supplies its boundary. */
  const next = iterator.next
  /** Explicit disposal retains the native generator's first cleanup outcome. */
  let primary: Promise<void> | undefined
  /** Language disposal reports the same failure and caches its separate successful projection. */
  let symbolic: Promise<void> | undefined
  /** Returning the existing generator releases its request listeners and operation signal once. */
  const dispose = (): Promise<void> => (primary ??= iterator.return().then(() => undefined))
  return Object.assign(iterator, {
    next: (...args: [] | [unknown]) =>
      endpoint.execution.run(
        { operation: endpoint.operation, input: args, ctx: endpoint.ctx },
        (captured) => Reflect.apply(next, iterator, captured) as Promise<IteratorResult<T, void>>
      ),
    dispose,
    [asyncDisposeKey]: (): Promise<void> =>
      (symbolic ??= dispose().catch((error) =>
        reportCleanupError(createStorageOperationReporter(), error)
      ))
  })
}
