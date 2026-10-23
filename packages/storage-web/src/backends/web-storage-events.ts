import {
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import type { IWebStorageLike } from '../types/storage.js'

/** The native browser event is the sole cross-document source; no polling or injected bus exists. */
const storageEvent = 'storage'

/** Admit only the actual localStorage of this Window and retain its exact listener methods. */
export function subscribeLocalStorageEvents(
  storage: IWebStorageLike,
  listener: (event: StorageEvent) => void
): (() => void) | undefined {
  /** A Storage-like injection without its matching native Window cannot promise notifications. */
  let source: Window
  /** Native methods retain their original receiver through registration and final cleanup. */
  let add: Window['addEventListener']
  /** The same source owns removal even if ambient globals change after construction. */
  let remove: Window['removeEventListener']
  try {
    source = globalThis.window
    if (source === undefined || source.localStorage !== storage) return undefined
    add = source.addEventListener
    remove = source.removeEventListener
    if (typeof add !== 'function' || typeof remove !== 'function') return undefined
  } catch {
    // An unavailable native event source leaves ordinary injected KV usable without a feed claim.
    return undefined
  }
  /** Native dispatch supplies StorageEvent; the backend filters its exact storageArea and keys. */
  const receive = (event: Event): void => listener(event as StorageEvent)
  try {
    Reflect.apply(add, source, [storageEvent, receive])
  } catch (cause) {
    /** Failed acquisition cannot leave an unowned listener behind. */
    const report = createStorageOperationReporter()
    reportCleanupError(report, cause)
    try {
      Reflect.apply(remove, source, [storageEvent, receive])
    } catch (cleanup) {
      reportCleanupError(report, cleanup)
    }
    return undefined
  }
  return () => Reflect.apply(remove, source, [storageEvent, receive])
}
