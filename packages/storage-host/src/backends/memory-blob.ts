import {
  StorageContractError,
  StorageContractErrorCode,
  prefixStorageOrgKey,
  encodeStorageOrgStringPrefix,
  encodeOrderedStorageKey,
  decodeOrderedStorageKey,
  type IBlobInfo,
  type IStorageKey
} from '@migaia/storage-contract'
import { bytesToBase64, base64ToBytes } from '@migaia/utils/bytes'
import { createOrderedRecordIndex } from '../core/ordered-record-index.js'
import { encodeFlatStorageKey } from '../core/key-domain.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { MemoryState } from './memory-constants.js'

/** One immutable committed object owns its body, public metadata and original physical identity. */
export type IMemoryBlobEntry = {
  readonly key: IStorageKey
  readonly encoded: string
  readonly ordered: Uint8Array
  readonly value: { readonly body: Uint8Array; readonly info: IBlobInfo }
}

/** Blob data belongs to the original namespace; this module has no lifetime or installation rights. */
export function createMemoryBlobData(orgId: string) {
  /** Point access and native prefix access retain references to the same physical entries. */
  const data = new Map<string, IMemoryBlobEntry>()
  /** The original compressed radix supplies byte-order seek without sorting stored objects. */
  const ordered = createOrderedRecordIndex<IMemoryBlobEntry>()
  /** Existing organization composition is the sole physical blob key envelope. */
  const keyOf = (key: string): IStorageKey => prefixStorageOrgKey(orgId, key)
  /** One logical key always resolves to the same original flat encoding of its physical tuple. */
  const encodedOf = (key: string): string => encodeFlatStorageKey(keyOf(key))
  /** Opaque cursors reuse the original ordered-key codec and bind exact organization and prefix. */
  const cursor = (prefix: string, key: string): string =>
    bytesToBase64(
      encodeOrderedStorageKey([MemoryState.blobCursor, orgId, prefix, key], STORAGE_MEMORY_BACKEND)
    )
  /** Reject foreign or malformed cursors before visiting native data. */
  const afterKey = (prefix: string, after: string | undefined): string | undefined => {
    if (after === undefined) return undefined
    try {
      /** This is the inverse of the original tuple writer, not another cursor parser. */
      const value = decodeOrderedStorageKey(base64ToBytes(after), STORAGE_MEMORY_BACKEND)
      if (
        !Array.isArray(value) ||
        value.length !== 4 ||
        value[0] !== MemoryState.blobCursor ||
        value[1] !== orgId ||
        value[2] !== prefix ||
        typeof value[3] !== 'string' ||
        !value[3].startsWith(prefix)
      )
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: STORAGE_MEMORY_BACKEND
        })
      return value[3]
    } catch (cause) {
      if (
        cause instanceof StorageContractError &&
        cause.code === StorageContractErrorCode.invalidArgument
      )
        throw cause
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: STORAGE_MEMORY_BACKEND,
        cause
      })
    }
  }
  /** Stream actual matching leaves, retaining adjacency before a caller can delete the current row. */
  function* rows(prefix: string, after?: string): IterableIterator<IMemoryBlobEntry> {
    /** Shared composition omits only the final string and tuple terminators for an exact prefix. */
    const bytes = encodeStorageOrgStringPrefix(orgId, prefix, STORAGE_MEMORY_BACKEND)
    /** A cursor boundary is exclusive and retains the same physical tuple domain. */
    let leaf =
      after === undefined
        ? ordered.lowerBound(bytes)
        : ordered.lowerBound(encodeOrderedStorageKey(keyOf(after), STORAGE_MEMORY_BACKEND), false)
    while (leaf) {
      if (bytes.some((byte, index) => leaf!.key[index] !== byte)) return
      /** Native unlinking cannot erase the next candidate of this synchronous traversal. */
      const next = leaf.next
      yield leaf.value
      leaf = next
    }
  }
  return {
    get size() {
      return data.size
    },
    encodedOf,
    /** Native point lookup retains the already owned physical tuple identity. */
    get: (key: string): IMemoryBlobEntry | undefined => data.get(encodedOf(key)),
    /** Only the native final turn installs a completely prepared body and frozen metadata. */
    put: (body: Uint8Array, info: IBlobInfo): IMemoryBlobEntry => {
      /** Physical composition and both indexes refer to one namespace-owned committed row. */
      const key = keyOf(info.key)
      /** Capacity and point lookup use this same existing flat key encoding. */
      const encoded = encodeFlatStorageKey(key)
      /** Replacements preserve the original radix key rather than constructing a second index. */
      const current = data.get(encoded)
      /** The body never escapes this native row; reads detach before publication. */
      const entry = {
        key,
        encoded,
        ordered: current?.ordered ?? encodeOrderedStorageKey(key, STORAGE_MEMORY_BACKEND),
        value: { body, info }
      }
      data.set(encoded, entry)
      ordered.set(entry.ordered, entry)
      return entry
    },
    /** Physical removal also serves original capacity victims, without a fabricated logical lock. */
    removeEncoded: (encoded: string): IMemoryBlobEntry | undefined => {
      /** Only an existing row can change capacity membership or native key order. */
      const entry = data.get(encoded)
      if (entry === undefined) return undefined
      data.delete(encoded)
      ordered.delete(entry.ordered)
      return entry
    },
    rows,
    /** A bounded page visits at most its requested rows and one continuation leaf. */
    list: (prefix: string, after: string | undefined, limit: number) => {
      /** Cursor validation completes before any matching native leaf is visited. */
      const last = afterKey(prefix, after)
      /** Only this page's public metadata is retained; native rows remain in their original index. */
      const items: IBlobInfo[] = []
      for (const entry of rows(prefix, last)) {
        if (items.length === limit)
          return {
            items: items,
            next: cursor(prefix, items[items.length - 1]!.key)
          }
        items.push(entry.value.info)
      }
      return { items: items }
    },
    /** Original namespace cleanup releases both references to every owned body. */
    clear: (): void => {
      data.clear()
      ordered.clear()
    }
  }
}
