import { IndexedDbFeature } from '../constants.ts'
import { IndexedDbTtlAssembly } from '../backends/indexed-db-ttl-assembly.ts'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.ts'
/** Explicitly install IndexedDB ttl behavior before the native database opens. */
export function indexedDbTtlFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.ttl, new IndexedDbTtlAssembly())
}
