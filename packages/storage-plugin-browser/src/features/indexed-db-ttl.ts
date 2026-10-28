import { IndexedDbFeature } from '../constants.js'
import { IndexedDbTtlAssembly } from '../backends/indexed-db-ttl-assembly.js'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.js'
/** Explicitly install IndexedDB ttl behavior before the native database opens. */
export function indexedDbTtlFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.ttl, new IndexedDbTtlAssembly())
}
