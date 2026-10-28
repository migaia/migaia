import { IndexedDbFeature } from '../constants.ts'
import { IndexedDbJournalAssembly } from '../backends/indexed-db-journal-assembly.ts'
import {
  createIndexedDbAssemblyFeature,
  type IIndexedDbAssemblyFeature
} from './indexed-db-assembly-feature.ts'
/** Explicitly install IndexedDB journal behavior before the native database opens. */
export function indexedDbJournalFeature(): IIndexedDbAssemblyFeature {
  return createIndexedDbAssemblyFeature(IndexedDbFeature.journal, new IndexedDbJournalAssembly())
}
