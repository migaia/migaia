import type { IStorageChange } from '@migaia/storage-contract'
import { createBackendLifecycleController } from '../core/backend-lifecycle.js'
import type {
  IBackendChangeController,
  IBackendChangeControllerOptions,
  IBackendLifecycleController
} from '../core/change-types.js'
import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'

/** Memory base retains physical lifecycle while optional notification calls fail explicitly. */
class MemoryLifecycleController implements IBackendChangeController {
  /** The canonical lightweight controller alone owns mutation drain and finalization. */
  readonly #lifecycle: IBackendLifecycleController
  /** Construct physical lifecycle without an event channel. */
  constructor(input: IBackendChangeControllerOptions) {
    this.#lifecycle = createBackendLifecycleController(input)
  }
  /** Borrow the original immutable construction snapshot. */
  get snapshot() {
    return this.#lifecycle.snapshot
  }
  /** Keep native coordination identity stable without notifications. */
  get origin() {
    return this.#lifecycle.origin
  }
  /** Close admission through the same physical owner. */
  get closingSignal() {
    return this.#lifecycle.closingSignal
  }
  /** Enforce physical liveness. */
  readonly assertLive = (): void => {
    this.#lifecycle.assertLive()
  }
  /** Retain native mutation work. */
  readonly beginMutation = (): (() => void) => {
    return this.#lifecycle.beginMutation()
  }
  /** Base writes have no declared notification stream and allocate no event payload history. */
  readonly publish = (
    _change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>
  ): undefined => {
    return undefined
  }
  /** External notifications require explicit assembly and cannot silently disappear. */
  readonly publishExternal = (_change: IStorageChange): void => {
    throw new StorageError(
      StorageHostErrorCode.changeControllerNotAssembled,
      {},
      StorageErrorText.changeControllerNotAssembled
    )
  }
  /** Subscriptions require the selected notification Feature. */
  readonly subscribe = (_listener: (change: IStorageChange) => void): (() => void) => {
    throw new StorageError(
      StorageHostErrorCode.changeControllerNotAssembled,
      {},
      StorageErrorText.changeControllerNotAssembled
    )
  }
  /** The physical lifecycle retains its original shared disposal promise. */
  readonly dispose = (): Promise<void> => {
    return this.#lifecycle.dispose()
  }
}
/** Construct memory's minimal physical owner without importing the notification implementation. */
export function createMemoryLifecycleController(
  input: IBackendChangeControllerOptions
): IBackendChangeController {
  return new MemoryLifecycleController(input)
}
