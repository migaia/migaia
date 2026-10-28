import { PgNames } from './constants.ts'
import { createQuiescenceTracker } from '@migaia/lifecycle'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageResource
} from '@migaia/storage-contract'
import {
  createStorageOperationReporter,
  asyncDisposeKey,
  reportCleanupError
} from '@migaia/storage-host/sdk'
/** Native borrowed resources reuse the original lifecycle tracker for accepted work and release. */
class PgBorrowedResource {
  /** One stable identity lets the canonical tracker own admission and drain. */
  readonly #owner = {}
  /** The shared lifecycle tracker owns accepted native activity. */
  readonly #tracker = createQuiescenceTracker<object>()
  /** Cleanup failures use the existing nonfatal backend diagnostic path. */
  readonly #report = createStorageOperationReporter()
  /** The original native release callback runs only after accepted work drains. */
  readonly #close: () => void | Promise<void>
  /** Explicit disposal returns the same original settlement promise. */
  #main: Promise<void> | undefined
  /** Symbolic disposal returns one report-only settlement promise. */
  #symbolic: Promise<void> | undefined
  /** Bind one native release callback without replacing canonical resource ownership. */
  constructor(close: () => void | Promise<void>) {
    this.#close = close
  }
  /** Seal admission once and release the native borrow after its original drain. */
  readonly dispose = (): Promise<void> => {
    if (this.#main !== undefined) return this.#main
    this.#tracker.seal(this.#owner)
    return (this.#main = this.#tracker.whenZero(this.#owner).then(this.#close))
  }
  /** Extracted namespace methods consult the same original resource seal. */
  readonly assertLive = (): void => {
    if (this.#tracker.isSealed(this.#owner))
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: PgNames.backend
      })
  }
  /** Retain one admitted native operation until its settlement. */
  readonly run = async <T>(invoke: () => Promise<T>): Promise<T> => {
    this.assertLive()
    const release = this.#tracker.retain(this.#owner)
    try {
      return await invoke()
    } finally {
      release()
    }
  }
  /** Expose the original own ports and preserve explicit and symbolic Promise identity. */
  open(): IStorageResource & { assertLive(): void; run<T>(invoke: () => Promise<T>): Promise<T> } {
    return {
      assertLive: this.assertLive,
      run: this.run,
      dispose: this.dispose,
      [asyncDisposeKey]: () =>
        (this.#symbolic ??= this.dispose().catch((cause) =>
          reportCleanupError(this.#report, cause)
        ))
    }
  }
}
/** Build one borrowed native resource around the canonical lifecycle tracker. */
export function pgResource(
  close: () => void | Promise<void>
): IStorageResource & { assertLive(): void; run<T>(invoke: () => Promise<T>): Promise<T> } {
  return new PgBorrowedResource(close).open()
}
