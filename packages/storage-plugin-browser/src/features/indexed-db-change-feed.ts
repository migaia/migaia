import { IndexedDbFeature } from '../constants.ts'
import { IndexedDbChangeFeedAssembly } from '../backends/indexed-db-change-feed-assembly.ts'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.ts'
/** Explicitly install IndexedDB change-feed behavior before the native database opens. */
export function indexedDbChangeFeedFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(
    IndexedDbFeature.changeFeed,
    new IndexedDbChangeFeedAssembly()
  )
}
