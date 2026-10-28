import { IndexedDbFeature } from '../constants.ts'
import { IndexedDbKeysetAssembly } from '../backends/indexed-db-keyset-assembly.ts'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.ts'

/** Select canonical page/after behavior for raw records queries without granting native indexes. */
export function indexedDbKeysetFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.keyset, new IndexedDbKeysetAssembly())
}
