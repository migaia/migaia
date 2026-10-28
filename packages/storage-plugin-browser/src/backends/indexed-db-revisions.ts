import {
  StorageError as JournalError,
  StorageErrorText as JournalErrorText
} from '@migaia/storage-host'
import { StorageHostErrorCode as JournalErrorCode } from '@migaia/storage-contract/error-code'
import { encodeFlatStorageKey, createStorageToken } from '@migaia/storage-host/sdk'
import { type IStorageKey } from '@migaia/storage-contract'
/** One physical point retains its birth across deletion and a version for each native attempt. */
export type IIndexedDbPointRevision = { readonly birth: string | null; readonly version: number }
/** These native ports belong to the same data transaction, never a separate log transaction. */
type IIndexedDbRevisionInput = {
  readonly namespace: string
  readonly revisions: IDBObjectStore
  readonly request: <T>(make: () => IDBRequest<T>) => Promise<T>
}
/** One native snapshot advances each observed point at most once. */
type IIndexedDbRevisionEntry = {
  /** Encoded before any await so caller mutation cannot redirect the original version write. */
  readonly physicalKey: IDBValidKey
  readonly loaded: Promise<IIndexedDbPointRevision>
  writing?: Promise<IIndexedDbPointRevision>
}
/** Persisted tag is shared by basic mutation revisions and explicitly selected journal images. */
const revisionTag = 'journal-point'

/** Business clear preserves point tombstones so another explicit journal owner can detect ABA. */
export function isIndexedDbPointRevision(key: IDBValidKey, namespace: string): boolean {
  return Array.isArray(key) && key.length === 4 && key[0] === namespace && key[1] === revisionTag
}

/** Basic storage owns only physical mutation versions; this owner captures no journal images. */
export class IndexedDbPointRevisions {
  /** Native authority remains fixed for this snapshot. */
  readonly #input: IIndexedDbRevisionInput
  /** Repeated mutations share the same original native revision attempt. */
  readonly #entries = new Map<string, IIndexedDbRevisionEntry>()
  /** Borrow the data transaction's existing revision store and request bridge. */
  constructor(input: IIndexedDbRevisionInput) {
    this.#input = input
  }
  /** First observation reads only the original point's persisted revision. */
  read(channel: string, key: IStorageKey): Promise<IIndexedDbPointRevision> {
    return this.entry(channel, key).loaded
  }
  /** Advance once per native attempt, including delete and clear, before the original data request. */
  advance(channel: string, key: IStorageKey): Promise<IIndexedDbPointRevision> {
    const entry = this.entry(channel, key)
    return (entry.writing ??= entry.loaded.then(async (before) => {
      const revision = { birth: before.birth ?? createStorageToken(), version: before.version + 1 }
      if (!Number.isSafeInteger(revision.version))
        throw new JournalError(
          JournalErrorCode.journalRecordInvalid,
          {},
          JournalErrorText.journalRecordInvalid
        )
      await this.#input.request(() => this.#input.revisions.put(revision, entry.physicalKey))
      return revision
    }))
  }
  /** Physical keys use the canonical logical-key encoding and the original native namespace. */
  key(channel: string, key: IStorageKey): IDBValidKey {
    return [
      this.#input.namespace,
      revisionTag,
      channel === 'value' ? 'text' : channel,
      encodeFlatStorageKey(key)
    ]
  }
  /** The same pending observation is published before any native request can resolve. */
  entry(channel: string, key: IStorageKey): IIndexedDbRevisionEntry {
    const physical = this.key(channel, key)
    const identity = JSON.stringify(physical)
    let entry = this.#entries.get(identity)
    if (entry === undefined) {
      entry = {
        physicalKey: physical,
        loaded: this.#input
          .request(() => this.#input.revisions.get(physical))
          .then((raw: unknown) => {
            if (raw === undefined) return { birth: null, version: 0 }
            const revision = raw as IIndexedDbPointRevision
            if (
              typeof revision !== 'object' ||
              revision === null ||
              typeof revision.birth !== 'string' ||
              !Number.isSafeInteger(revision.version) ||
              revision.version < 0
            )
              throw new JournalError(
                JournalErrorCode.journalRecordInvalid,
                {},
                JournalErrorText.journalRecordInvalid
              )
            return revision
          })
      }
      this.#entries.set(identity, entry)
    }
    return entry
  }
}
