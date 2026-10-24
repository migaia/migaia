import { createRecordQuery } from '@migaia/storage-host/authoring/query'

/** Raw IDB keyset queries borrow the canonical planner, cursor and resource owner unchanged. */
export class IndexedDbKeysetAssembly {
  /** Keep pagination implementation reachable only from its explicitly installed Feature. */
  readonly query = createRecordQuery
}
