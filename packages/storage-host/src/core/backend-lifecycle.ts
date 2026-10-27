import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { createStringLeaseRegistry, createAbortController } from '@migaia/lifecycle'
import { IdentifyError, isNativeErrorValue } from '@migaia/utils/error'
import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import type {
  IBackendChangeControllerOptions,
  IBackendLifecycleController
} from './change-types.js'
export type { IBackendLifecycleController } from './change-types.js'

/** Same-realm physical origins are unique independently of optional notification assembly. */
let backendOriginSequence = 0
/** One physical owner drains all accepted mutations through the canonical lifecycle registry. */
const mutationLeaseKey = 'backend-mutation'

/** Own physical admission and finalization without allocating notification channels. */
class BackendLifecycleController implements IBackendLifecycleController {
  /** Captured native platform and options remain borrowed references. */
  readonly snapshot: IBackendLifecycleController['snapshot']
  /** Native coordination uses the same stable origin with or without change notifications. */
  readonly origin: string
  /** Native backends reject new work after this original signal closes. */
  readonly closingSignal: IBackendLifecycleController['closingSignal']
  /** Original options retain the finalizer's receiver and native identity. */
  readonly #input: IBackendChangeControllerOptions
  /** Closure rejects new admission while accepted mutations drain. */
  readonly #closing = createAbortController()
  /** The existing lifecycle registry owns mutation lease drain. */
  readonly #mutationLeases = createStringLeaseRegistry()
  /** Every cleanup caller shares the same terminal completion. */
  #disposePromise: Promise<void> | undefined
  /** Physical disposal follows the native finalizer. */
  #disposed = false

  /** Capture supported configuration before acquiring physical resources. */
  constructor(input: IBackendChangeControllerOptions) {
    if (
      typeof input.backend !== 'string' ||
      (input.origin !== undefined && typeof input.origin !== 'string') ||
      (input.finalize !== undefined && typeof input.finalize !== 'function')
    )
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    this.#input = input
    this.snapshot = { backend: input.backend, platform: input.platform, options: input.options }
    this.origin = input.origin ?? `${input.backend}:${(backendOriginSequence += 1).toString(36)}`
    this.closingSignal = this.#closing.signal
  }
  /** Reject only new work after logical or physical closure. */
  readonly assertLive = (): void => {
    if (this.#closing.signal.aborted || this.#disposed)
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: this.snapshot.backend
      })
  }
  /** Retain accepted work in the original mutation lane. */
  readonly beginMutation = (): (() => void) => {
    this.assertLive()
    return this.#mutationLeases.retain(mutationLeaseKey)
  }
  /** Drain accepted work before invoking the original finalizer exactly once. */
  readonly dispose = (): Promise<void> => {
    if (this.#disposePromise !== undefined) return this.#disposePromise
    this.#mutationLeases.seal(mutationLeaseKey)
    this.#disposePromise = this.#mutationLeases.whenZero(mutationLeaseKey).then(async () => {
      try {
        await this.#input.finalize?.()
      } catch (cause) {
        if (isNativeErrorValue(cause) && IdentifyError.identityOf(cause) !== undefined) throw cause
        throw new StorageError(
          StorageHostErrorCode.storageHostDisposeFailed,
          { backend: this.snapshot.backend, cause },
          StorageErrorText.storageHostDisposeFailed
        )
      } finally {
        this.#disposed = true
      }
    })
    this.#closing.abort(
      new StorageContractError(StorageContractErrorCode.disposed, {
        backend: this.snapshot.backend
      })
    )
    return this.#disposePromise
  }
}
/** Select the minimal physical lifecycle owner; notifications remain a separate assembly. */
export function createBackendLifecycleController(
  input: IBackendChangeControllerOptions
): IBackendLifecycleController {
  return new BackendLifecycleController(input)
}
