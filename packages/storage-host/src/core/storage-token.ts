/** Monotonic suffix prevents token collisions when host entropy sources repeat. */
let storageTokenSequence = 0

/**
 * Creates the package-private opaque token used for generated record keys, IndexedDB generations,
 * and backend origins. The entropy and suffix format are intentionally stable across backends;
 * callers must treat the result as an opaque same-realm uniqueness token.
 */
export const createStorageToken = (): string => {
  try {
    /** Borrow the native receiver once while preserving the original conditional fallback. */
    const tokenHost = globalThis as unknown as { crypto?: { randomUUID?: () => string } }
    /** Retain the actual crypto receiver without repeating its public getter. */
    const crypto = tokenHost.crypto
    /** The monotonic suffix and fallback entropy format remain unchanged. */
    const entropy =
      typeof crypto?.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    storageTokenSequence += 1
    return `${entropy}-${storageTokenSequence.toString(36)}`
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.unsupported, { cause })
  }
}
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
