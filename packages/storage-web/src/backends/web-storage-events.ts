import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import type { IWebStorageLike } from '../types/storage.js'

/** The native browser event is the sole cross-document source; no polling or injected bus exists. */
const storageEvent = 'storage'

/** Admit only the actual localStorage of this Window and retain its native event source. */
export function subscribeLocalStorageEvents(
  storage: IWebStorageLike,
  listener: (event: StorageEvent) => void
): (() => void) | undefined {
  /** A Storage-like injection without its matching native Window cannot promise notifications. */
  let source: Window
  try {
    source = globalThis.window
    if (source === undefined || source.localStorage !== storage) return undefined
    if (
      typeof source.addEventListener !== 'function' ||
      typeof source.removeEventListener !== 'function'
    )
      return undefined
  } catch {
    // An unavailable native event source leaves ordinary injected KV usable without a feed claim.
    return undefined
  }
  /** Native dispatch supplies StorageEvent; the backend filters its exact storageArea and keys. */
  const receive = (event: Event): void => listener(event as StorageEvent)
  try {
    source.addEventListener(storageEvent, receive)
  } catch (cause) {
    /** Failed acquisition cannot leave an unowned listener behind. */
    const report = createStorageOperationReporter()
    reportCleanupError(report, cause)
    try {
      source.removeEventListener(storageEvent, receive)
    } catch (cleanup) {
      reportCleanupError(report, cleanup)
    }
    return undefined
  }
  return () => source.removeEventListener(storageEvent, receive)
}
