/**
 * Storage error codes are declared by storage-contract (`@migaia/storage-contract/error-code`);
 * this package owns no local codes.
 */
export const CacheLocalErrorCode = {} as const

/** No package-local semantic values exist; the code union comes from storage-contract. */
export type ICacheLocalErrorCode = (typeof CacheLocalErrorCode)[keyof typeof CacheLocalErrorCode]
