import { IndexedDbFeature } from '../constants.js'
import { IndexedDbBatchAssembly } from '../backends/indexed-db-batch-assembly.js'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.js'
/** Explicitly install IndexedDB batch behavior before the native database opens. */
export function indexedDbBatchFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.batch, new IndexedDbBatchAssembly())
}
