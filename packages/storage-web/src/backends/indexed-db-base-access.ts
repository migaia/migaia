import { IndexedDbDeadlineMetadata } from './indexed-db-deadline-metadata.js'
import type { IStorageJournalBackendBinding } from '@migaia/storage-host'
import { IndexedDbFeature } from '../constants.js'
import type { IStorageKey } from '@migaia/storage-contract'
import { IndexedDbPointRevisions } from './indexed-db-revisions.js'
import type { createIndexedDbTtlAccess, IIndexedDbTtlInput } from './indexed-db-ttl.js'
import type { createIndexedDbJournalImages } from './indexed-db-images.js'
import type {
  IIndexedDbNativeRegistration,
  IIndexedDbStore,
  IIndexedDbTransactionScope
} from './indexed-db.js'
import type { IBrowserBatchApi } from './construction.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { indexedDbFeatureMissingText } from '../error-text.js'
import { StorageBackend } from '../constants.js'
/** Missing optional operations fail before native admission and identify their required Feature. */
export const indexedDbFeatureMissing = {
  fail(feature: string): never {
    throw new StorageError(
      StorageErrorCode.indexedDbFeatureNotInstalled,
      { backend: StorageBackend.indexedDb },
      indexedDbFeatureMissingText(feature)
    )
  },
  indexes<T>(): Pick<
    IIndexedDbStore<T>,
    | 'ensureRecordIndexes'
    | 'getRecordIndexReadiness'
    | 'putIndexedRecord'
    | 'iterateRecordIndex'
    | 'transactionIndexed'
  > {
    return {
      ensureRecordIndexes: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes),
      getRecordIndexReadiness: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes),
      putIndexedRecord: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes),
      iterateRecordIndex: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes),
      transactionIndexed: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes)
    }
  },
  scopeIndexes<T>(): Pick<
    IIndexedDbTransactionScope<T>,
    'isRecordIndexReady' | 'putIndexedRecord' | 'iterateRecordIndex'
  > {
    return {
      isRecordIndexReady: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes),
      putIndexedRecord: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes),
      iterateRecordIndex: () => indexedDbFeatureMissing.fail(IndexedDbFeature.indexes)
    }
  },
  batch(): IBrowserBatchApi {
    return {
      getMany: () => indexedDbFeatureMissing.fail(IndexedDbFeature.batch),
      setMany: () => indexedDbFeatureMissing.fail(IndexedDbFeature.batch),
      removeMany: () => indexedDbFeatureMissing.fail(IndexedDbFeature.batch),
      removeByPrefix: () => indexedDbFeatureMissing.fail(IndexedDbFeature.batch)
    }
  },
  images(): IIndexedDbNativeRegistration<unknown>['images'] {
    return {
      changes: () => indexedDbFeatureMissing.fail(IndexedDbFeature.journal),
      readImage: () => indexedDbFeatureMissing.fail(IndexedDbFeature.journal),
      writeImage: () => indexedDbFeatureMissing.fail(IndexedDbFeature.journal),
      readRevision: () => indexedDbFeatureMissing.fail(IndexedDbFeature.journal)
    }
  },
  /** Standalone log calls also identify the absent backend Feature without importing its runtime. */
  binding(): IStorageJournalBackendBinding {
    return new IndexedDbMissingJournalBinding()
  },
  journal(): Pick<IIndexedDbStore<unknown>, 'undo'> {
    return { undo: () => indexedDbFeatureMissing.fail(IndexedDbFeature.journal) }
  }
}

/** Basic storage keeps native presence and direct writes; optional policy and images stay external. */
export class IndexedDbBaseAccess {
  /** Basic mutations retain only native version advancement, without capturing images. */
  static images(
    input: Parameters<typeof createIndexedDbJournalImages>[0]
  ): ReturnType<typeof createIndexedDbJournalImages> {
    return new IndexedDbBasicImageAccess(input)
  }
  /** Basic reads use native presence; explicit TTL operations require the TTL Feature. */
  static ttl(input: IIndexedDbTtlInput): ReturnType<typeof createIndexedDbTtlAccess> {
    return new IndexedDbBasicTtlAccess(input)
  }
}

/** One native mutation snapshot owns point revisions independently of optional journal capture. */
class IndexedDbBasicImageAccess implements ReturnType<typeof createIndexedDbJournalImages> {
  /** Canonical point versions retain mutation identity across basic and journal-enabled writers. */
  readonly #revisions: IndexedDbPointRevisions
  /** Borrow the already-open native data transaction and its original revision bridge. */
  constructor(input: Parameters<typeof createIndexedDbJournalImages>[0]) {
    this.#revisions = new IndexedDbPointRevisions(input)
  }
  /** Advance the original point once before performing its actual native write. */
  async mutate<R>(
    channel: 'value' | 'bytes' | 'record',
    key: IStorageKey,
    _present: boolean,
    _value: unknown,
    run: () => Promise<R>
  ): Promise<R> {
    await this.#revisions.advance(channel, key)
    return run()
  }
  /** Clear retains tombstones for every existing native key before its one original native clear. */
  async clear<R>(
    channel: 'value' | 'bytes' | 'record',
    keys: readonly IStorageKey[],
    run: () => Promise<R>
  ): Promise<R> {
    await Promise.all(keys.map((key) => this.#revisions.advance(channel, key)))
    return run()
  }
  /** A selected TTL owner shares the same point version without enabling journal images. */
  deadline = async <R>(
    channel: 'value' | 'bytes' | 'record',
    key: IStorageKey,
    before: number | undefined,
    after: number | undefined,
    run: () => Promise<R>
  ): Promise<R> => {
    if (before !== after) await this.#revisions.advance(channel, key)
    return run()
  }
  /** Journal revision access requires the explicit image protocol instead of a partial result. */
  revision(): never {
    return indexedDbFeatureMissing.fail(IndexedDbFeature.journal)
  }
  /** Basic mutations never manufacture a journal history. */
  changes(): never {
    return indexedDbFeatureMissing.fail(IndexedDbFeature.journal)
  }
}

/** Missing native journal assembly is an explicit rejection boundary, never a second log path. */
class IndexedDbMissingJournalBinding implements IStorageJournalBackendBinding {
  /** Every org retains the same absence; no native handle or namespace can be acquired. */
  forOrg(): IStorageJournalBackendBinding {
    return this
  }
  /** Reject before namespace I/O and identify the exact backend Feature the caller must select. */
  async openNamespace(): Promise<never> {
    return indexedDbFeatureMissing.fail(IndexedDbFeature.journal)
  }
}

/** Basic writes clear inherited deadlines while expiry decisions remain an explicit TTL Feature. */
class IndexedDbBasicTtlAccess implements ReturnType<typeof createIndexedDbTtlAccess> {
  /** Existing channel-presence lookup remains the base reader's only visibility decision. */
  readonly #input: IIndexedDbTtlInput
  /** Shared raw metadata maintenance prevents stale deadlines from governing replacement values. */
  readonly #metadata: IndexedDbDeadlineMetadata
  /** Borrow only raw metadata and original native requests; no clock is sampled. */
  constructor(input: IIndexedDbTtlInput) {
    this.#input = input
    this.#metadata = new IndexedDbDeadlineMetadata(input)
  }
  /** Basic visibility is native presence, independent of relative expiry policy. */
  present(channel: 'value' | 'bytes' | 'record', key: IStorageKey): Promise<boolean> {
    return this.#input.present(channel, key)
  }
  /** Basic reads never classify data as expired. */
  async expired(): Promise<boolean> {
    return false
  }
  /** An overwrite creates an unlimited replacement when TTL was not selected. */
  written(channel: 'value' | 'bytes' | 'record', key: IStorageKey): Promise<void> {
    return this.#metadata.remove(channel, key)
  }
  /** Removing a value also removes its inherited deadline in the same native transaction. */
  removed(channel: 'value' | 'bytes' | 'record', key: IStorageKey): Promise<void> {
    return this.#metadata.remove(channel, key)
  }
  /** Native channel clear shares one canonical metadata range traversal with the TTL owner. */
  clear(channel: 'value' | 'bytes' | 'record'): Promise<void> {
    return this.#metadata.clear(channel)
  }
  /** No TTL observation exists in the basic profile. */
  expiredObservation(): undefined {
    return undefined
  }
  /** Public duration changes require the explicit TTL projection. */
  expire(): never {
    return indexedDbFeatureMissing.fail(IndexedDbFeature.ttl)
  }
  /** Public persistence changes require the explicit TTL projection. */
  persist(): never {
    return indexedDbFeatureMissing.fail(IndexedDbFeature.ttl)
  }
  /** Remaining duration requires the explicit TTL clock and observation owner. */
  remaining(): never {
    return indexedDbFeatureMissing.fail(IndexedDbFeature.ttl)
  }
  /** Journal image restoration writes only raw physical metadata, without starting expiry policy. */
  async restore(
    channel: 'value' | 'bytes' | 'record',
    key: IStorageKey,
    deadline: number | undefined
  ): Promise<void> {
    await this.#metadata.write(channel, key, deadline)
    this.#input.changed(channel, key)
  }
  /** Journal image comparison reads the physical deadline without interpreting it. */
  deadline(channel: 'value' | 'bytes' | 'record', key: IStorageKey): Promise<number | undefined> {
    return this.#metadata.read(channel, key)
  }
}
