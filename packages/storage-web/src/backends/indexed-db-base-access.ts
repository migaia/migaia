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
  journal(): Pick<IIndexedDbStore<unknown>, 'undo'> {
    return { undo: () => indexedDbFeatureMissing.fail(IndexedDbFeature.journal) }
  }
}

/** Basic storage keeps native presence and direct writes; it owns no deadline or image state. */
export class IndexedDbBaseAccess {
  /** Basic mutations retain only native version advancement, without capturing images. */
  static images(
    input: Parameters<typeof createIndexedDbJournalImages>[0]
  ): ReturnType<typeof createIndexedDbJournalImages> {
    return new IndexedDbBasicImageAccess(input)
  }
  /** Basic reads use native presence; explicit TTL operations require the TTL Feature. */
  static ttl(input: IIndexedDbTtlInput): ReturnType<typeof createIndexedDbTtlAccess> {
    return {
      present: input.present,
      expired: () => Promise.resolve(false),
      written: () => Promise.resolve(),
      removed: () => Promise.resolve(),
      clear: () => Promise.resolve(),
      expiredObservation: () => undefined,
      expire: () => indexedDbFeatureMissing.fail(IndexedDbFeature.ttl),
      persist: () => indexedDbFeatureMissing.fail(IndexedDbFeature.ttl),
      remaining: () => indexedDbFeatureMissing.fail(IndexedDbFeature.ttl),
      restore: () => indexedDbFeatureMissing.fail(IndexedDbFeature.ttl),
      deadline: () => indexedDbFeatureMissing.fail(IndexedDbFeature.ttl)
    }
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
