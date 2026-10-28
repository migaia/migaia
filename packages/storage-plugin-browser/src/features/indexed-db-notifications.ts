import { IndexedDbFeature } from '../constants.ts'
import { IndexedDbNotificationsAssembly } from '../backends/indexed-db-notifications-assembly.ts'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.ts'
/** Explicitly install IndexedDB notifications behavior before the native database opens. */
export function indexedDbNotificationsFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(
    IndexedDbFeature.notifications,
    new IndexedDbNotificationsAssembly()
  )
}
