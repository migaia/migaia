import { IndexedDbFeature } from '../constants.js'
import { IndexedDbIndexesAssembly } from '../backends/indexed-db-indexes-assembly.js'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.js'
/** Explicitly select native secondary indexes and backfill before the backend opens. */
export function indexedDbIndexesFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.indexes, new IndexedDbIndexesAssembly())
}
