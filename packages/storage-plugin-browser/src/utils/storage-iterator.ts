import type { IStorageIterator, IOperationContext } from '@migaia/storage-contract'
import type { IStorageExecutionPort } from '@migaia/storage-host'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { createStorageOperationReporter, reportCleanupError } from '@migaia/storage-host/sdk'

/** The original execution endpoint supplies admission without taking generator ownership. */
type IStorageIteratorEndpoint = {
  readonly execution: IStorageExecutionPort
  readonly operation: string
  readonly ctx?: IOperationContext
}

/** The native generator alone owns request listeners, advancement and queued return semantics. */
class StorageIteratorResource<T> implements IStorageIterator<T> {
  /** The original generator retains all native iteration and cleanup state. */
  readonly #iterator: AsyncGenerator<T, void, unknown>
  /** This endpoint admits each next call through the existing host execution boundary. */
  readonly #endpoint: IStorageIteratorEndpoint
  /** Explicit disposal retains the native generator's first cleanup outcome. */
  #primary: Promise<void> | undefined
  /** Symbolic disposal reports once through a separately cached successful projection. */
  #symbolic: Promise<void> | undefined

  /** Retain the native generator without replacing its methods or adding a queue. */
  constructor(iterator: AsyncGenerator<T, void, unknown>, endpoint: IStorageIteratorEndpoint) {
    this.#iterator = iterator
    this.#endpoint = endpoint
  }

  /** Iteration and explicit resource access share this one public projection. */
  [Symbol.asyncIterator](): IStorageIterator<T> {
    return this
  }

  /** Admit one advance while preserving its original input and native receiver. */
  readonly next = (...args: [] | [unknown]): Promise<IteratorResult<T, void>> =>
    this.#endpoint.execution.run(
      { operation: this.#endpoint.operation, input: args, ctx: this.#endpoint.ctx },
      (captured) => this.#iterator.next(...(captured as [] | [unknown]))
    )

  /** Forward early return to the native generator's existing completion path. */
  readonly return = (value?: void | PromiseLike<void>): Promise<IteratorResult<T, void>> =>
    this.#iterator.return(value)

  /** Forward thrown iteration failures without changing their native outcome. */
  readonly throw = (error?: unknown): Promise<IteratorResult<T, void>> =>
    this.#iterator.throw(error)

  /** Returning the original generator releases its native requests and signal once. */
  readonly dispose = (): Promise<void> =>
    (this.#primary ??= this.#iterator.return().then(() => undefined))

  /** Language cleanup reports the same failure without replacing explicit cleanup's rejection. */
  readonly [asyncDisposeKey] = (): Promise<void> =>
    (this.#symbolic ??= this.dispose().catch((error) =>
      reportCleanupError(createStorageOperationReporter(), error)
    ))
}

/** Add resource ports while retaining the original generator as the sole native owner. */
export function withStorageIteratorResource<T>(
  iterator: AsyncGenerator<T, void, unknown>,
  endpoint: IStorageIteratorEndpoint
): IStorageIterator<T> {
  return new StorageIteratorResource(iterator, endpoint)
}
