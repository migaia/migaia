import { IndexedDbFeature } from '../constants.ts'
import { IndexedDbBatchAssembly } from '../backends/indexed-db-batch-assembly.ts'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.ts'
/** Explicitly install IndexedDB batch behavior before the native database opens. */
export function indexedDbBatchFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.batch, new IndexedDbBatchAssembly())
}
