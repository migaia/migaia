import { IndexedDbFeature } from '../constants.js'
import { IndexedDbKeysetAssembly } from '../backends/indexed-db-keyset-assembly.js'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.js'

/** Select canonical page/after behavior for raw records queries without granting native indexes. */
export function indexedDbKeysetFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.keyset, new IndexedDbKeysetAssembly())
}
