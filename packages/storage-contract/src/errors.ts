import type { IBackendKind } from './capabilities.js'
import type { IStorageKey } from './context.js'
import { StorageContractErrorCode, type IStorageContractErrorCode } from './error-code.js'

export { StorageContractErrorCode, type IStorageContractErrorCode }

/** `source` value stamped onto every contract-level error this package throws. */
export const STORAGE_CONTRACT_SOURCE = '@migaia/storage-contract'

/**
 * Contains neutral contract error details. Web diagnostics such as codec, migration, and extension
 * details belong to `storage-web`.
 */
export type IStorageContractErrorDetails = {
  readonly backend?: IBackendKind
  readonly key?: string | IStorageKey
  readonly cause?: unknown
}

/**
 * Represents a contract error with `source` fixed to `@migaia/storage-contract`.
 * `StorageContractErrorCode` defines the codes. Freezes the instance after construction and
 * preserves `stack` and the reachable `cause` chain. See `docs/contracts/error-codes.md`.
 */
export class StorageContractError extends Error {
  readonly source: string
  readonly code: IStorageContractErrorCode
  readonly backend?: IBackendKind
  readonly key?: string | IStorageKey

  constructor(
    code: IStorageContractErrorCode,
    details: IStorageContractErrorDetails = {},
    message?: string
  ) {
    super(message ?? `[storage-contract] ${code}`, { cause: details.cause })
    this.name = 'StorageContractError'
    this.source = STORAGE_CONTRACT_SOURCE
    this.code = code
    this.backend = details.backend
    this.key = details.key
    Object.freeze(this)
  }
}

export const isStorageContractError = (value: unknown): value is StorageContractError =>
  value instanceof StorageContractError
