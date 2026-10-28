import { IndexedDbFeature } from '../constants.js'
import { IndexedDbChangeFeedAssembly } from '../backends/indexed-db-change-feed-assembly.js'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.js'
/** Explicitly install IndexedDB change-feed behavior before the native database opens. */
export function indexedDbChangeFeedFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(
    IndexedDbFeature.changeFeed,
    new IndexedDbChangeFeedAssembly()
  )
}
