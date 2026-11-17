/** Fallback live-query consistency for a backend whose Feature expose states no reactive profile. */
import { StorageReactiveVisibility } from '@migaia/storage-host/sdk'
import { BROWSER_REACTIVE_POLL_INTERVAL_MS } from '../constants.ts'
import type { IStorageReactiveFeatureMetadata } from './types.ts'

/** A backend that states no profile is observed by its controller, else by polling this instance. */
export function defaultReactiveProfile(hasController: boolean): IStorageReactiveFeatureMetadata {
  return hasController
    ? { mode: 'push', visibility: StorageReactiveVisibility.instance }
    : {
        mode: 'polling',
        visibility: StorageReactiveVisibility.instance,
        pollIntervalMs: BROWSER_REACTIVE_POLL_INTERVAL_MS
      }
}
