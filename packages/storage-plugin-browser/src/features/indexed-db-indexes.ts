import { IndexedDbFeature } from '../constants.ts'
import { IndexedDbIndexesAssembly } from '../backends/indexed-db-indexes-assembly.ts'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.ts'
/** Explicitly select native secondary indexes and backfill before the backend opens. */
export function indexedDbIndexesFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.indexes, new IndexedDbIndexesAssembly())
}
