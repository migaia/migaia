import { PgNames } from './constants.js'
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
} from '@migaia/storage-host/authoring/backend'
/** Native borrowed resources reuse the original lifecycle tracker for accepted work and release. */
export function pgResource(
  close: () => void | Promise<void>
): IStorageResource & { assertLive(): void; run<T>(invoke: () => Promise<T>): Promise<T> } {
  const owner = {}
  const tracker = createQuiescenceTracker<object>()
  const report = createStorageOperationReporter()
  let main: Promise<void> | undefined
  let symbolic: Promise<void> | undefined
  const dispose = (): Promise<void> => {
    if (main !== undefined) return main
    tracker.seal(owner)
    return (main = tracker.whenZero(owner).then(close))
  }
  /** Extracted namespace methods consult the same original resource seal. */
  const assertLive = (): void => {
    if (tracker.isSealed(owner))
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: PgNames.backend
      })
  }
  return {
    assertLive,
    run: async (invoke) => {
      assertLive()
      const release = tracker.retain(owner)
      try {
        return await invoke()
      } finally {
        release()
      }
    },
    dispose,
    [asyncDisposeKey]: () =>
      (symbolic ??= dispose().catch((cause) => reportCleanupError(report, cause)))
  }
}
