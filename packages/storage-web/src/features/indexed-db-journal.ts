import { IndexedDbFeature } from '../constants.js'
import { IndexedDbJournalAssembly } from '../backends/indexed-db-journal-assembly.js'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.js'
/** Explicitly install IndexedDB journal behavior before the native database opens. */
export function indexedDbJournalFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.journal, new IndexedDbJournalAssembly())
}
