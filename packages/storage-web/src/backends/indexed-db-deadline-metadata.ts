import type { IStorageKey } from '@migaia/storage-contract'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import { compareStorageKeys } from '@migaia/storage-host/authoring/key'
import { encodeFlatStorageKey, decodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'

/** Private deadline rows keep one stable layout across basic cleanup and explicit TTL policy. */
export const IndexedDbTtlLayout = {
  namespace: 'ttl',
  index: '__storage_web_ttl_expiry__',
  expiresAt: '__storage_web_expires_at__'
} as const
/** Physical deadline ownership follows the original native data channels. */
type IIndexedDbDeadlineChannel = 'value' | 'bytes' | 'record'
/** Raw metadata access borrows the original native transaction and optional image capture port. */
type IIndexedDbDeadlineInput = {
  readonly metadata: IDBObjectStore
  readonly namespace: string
  readonly keyRange: typeof IDBKeyRange | undefined
  readonly request: <T>(make: () => IDBRequest<T>) => Promise<T>
  readonly deadline: <R>(
    channel: IIndexedDbDeadlineChannel,
    key: IStorageKey,
    before: number | undefined,
    after: number | undefined,
    run: () => Promise<R>
  ) => Promise<R>
}

/** Canonical key encoding is shared; neither caller owns another deadline codec. */
export function indexedDbDeadlineMetadataKey(
  namespace: string,
  channel: IIndexedDbDeadlineChannel,
  key: IStorageKey
): IDBValidKey {
  return [namespace, IndexedDbTtlLayout.namespace, channel, encodeFlatStorageKey(key)]
}

/** Raw metadata maintenance has no clock, expiry observation, timer or TTL capability projection. */
export class IndexedDbDeadlineMetadata {
  /** The existing native transaction alone owns metadata requests and optional image ordering. */
  readonly #input: IIndexedDbDeadlineInput
  /** Borrow raw private rows without selecting TTL behavior. */
  constructor(input: IIndexedDbDeadlineInput) {
    this.#input = input
  }
  /** Physical image reads do not expire data or sample relative time. */
  async read(channel: IIndexedDbDeadlineChannel, key: IStorageKey): Promise<number | undefined> {
    /** Read the private physical row without observing business visibility. */
    const stored = await this.#input.request(() =>
      this.#input.metadata.get(indexedDbDeadlineMetadataKey(this.#input.namespace, channel, key))
    )
    return stored?.[IndexedDbTtlLayout.expiresAt] as number | undefined
  }
  /** Restore one physical image through the original journal ordering without enabling expiry. */
  async write(
    channel: IIndexedDbDeadlineChannel,
    key: IStorageKey,
    deadline: number | undefined
  ): Promise<void> {
    /** Capture the canonical physical identity before the first request can await. */
    const target = indexedDbDeadlineMetadataKey(this.#input.namespace, channel, key)
    /** The original image owner receives the actual physical before value. */
    const before = await this.read(channel, key)
    await this.#input.deadline(channel, key, before, deadline, async () => {
      if (deadline === undefined)
        await this.#input.request(() => this.#input.metadata.delete(target))
      else
        await this.#input.request(() =>
          this.#input.metadata.put({ [IndexedDbTtlLayout.expiresAt]: deadline }, target)
        )
    })
  }
  /** Basic overwrite/delete clears an existing deadline so it cannot govern a new value. */
  async remove(channel: IIndexedDbDeadlineChannel, key: IStorageKey): Promise<void> {
    /** Capture the canonical physical identity before the first request can await. */
    const target = indexedDbDeadlineMetadataKey(this.#input.namespace, channel, key)
    /** The original image owner receives the actual physical before value. */
    const before = await this.read(channel, key)
    if (before === undefined) return
    await this.#input.deadline(channel, key, before, undefined, () =>
      this.#input.request(() => this.#input.metadata.delete(target))
    )
  }
  /** Channel clear removes only that channel's private rows and retains actual image order. */
  async clear(channel: IIndexedDbDeadlineChannel): Promise<void> {
    /** All rows for one original channel occupy the same native array-key range. */
    const prefix = [this.#input.namespace, IndexedDbTtlLayout.namespace, channel]
    /** Reuse the original cursor request for every advancement. */
    const cursorRequest = this.#input.metadata.openCursor(this.#input.keyRange?.lowerBound(prefix))
    /** Only the currently admitted native cursor is retained. */
    let cursor = await this.#input.request(() => cursorRequest)
    if (
      this.#input.keyRange === undefined &&
      cursor !== null &&
      compareStorageKeys(cursor.key as IStorageKey, prefix) < 0
    )
      cursor = await this.#input.request(() => {
        cursor!.continue(prefix)
        return cursorRequest
      })
    while (cursor !== null) {
      /** Stop as soon as iteration leaves this channel namespace. */
      const key = cursor.key
      if (!Array.isArray(key) || key[0] !== prefix[0] || key[1] !== prefix[1] || key[2] !== channel)
        break
      /** Capture the absolute deadline before deleting its exact native row. */
      const before = cursor.value?.[IndexedDbTtlLayout.expiresAt] as number | undefined
      /** Logical keys reuse the original flat-key codec stored in the physical identity. */
      const encoded = key[3]
      /** Image ordering and point revisions use the original logical key. */
      const original = typeof encoded === 'string' ? decodeFlatStorageKey(encoded) : undefined
      if (original === undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      await this.#input.deadline(channel, original, before, undefined, () =>
        this.#input.request(() => cursor!.delete())
      )
      cursor = await this.#input.request(() => {
        cursor!.continue()
        return cursorRequest
      })
    }
  }
}
