import { IndexedDbFeature } from '../constants.js'
import { IndexedDbNotificationsAssembly } from '../backends/indexed-db-notifications-assembly.js'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.js'
/** Explicitly install IndexedDB notifications behavior before the native database opens. */
export function indexedDbNotificationsFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(
    IndexedDbFeature.notifications,
    new IndexedDbNotificationsAssembly()
  )
}
