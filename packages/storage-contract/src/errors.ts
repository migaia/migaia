import type { IBackendKind } from './capabilities.js'
import type { IStorageKey } from './context.js'
import { StorageContractErrorCode, type IStorageContractErrorCode } from './error-code.js'

export { StorageContractErrorCode, type IStorageContractErrorCode }

/** `source` value stamped onto every contract-level error this package throws. */
export const STORAGE_CONTRACT_SOURCE = '@migaia/storage-contract'

/** Contains neutral contract error details. Provider-specific diagnostics stay with their owner. */
export type IStorageContractErrorDetails = {
  /** Optional provider family for diagnostics. */
  readonly backend?: IBackendKind
  /** Optional offending or affected key; retained by reference rather than copied. */
  readonly key?: string | IStorageKey
  /** Original failure retained through the standard Error cause property. */
  readonly cause?: unknown
  /** Archive version immediately before a failed migration step or reset. */
  readonly fromVersion?: number
  /** Target version of a failed migration step or reset. */
  readonly toVersion?: number
}

/**
 * Represents a contract error with `source` fixed to `@migaia/storage-contract`.
 * `StorageContractErrorCode` defines the codes. Freezes the instance after construction and
 * preserves stack and the reachable cause chain. Details are not deep-frozen or cloned.
 */
export class StorageContractError extends Error {
  /** Stable package identity, always STORAGE_CONTRACT_SOURCE. */
  readonly source: string
  /** Semantic contract failure category from StorageContractErrorCode. */
  readonly code: IStorageContractErrorCode
  /** Provider family supplied in details, or undefined. */
  readonly backend?: IBackendKind
  /** Key supplied in details, or undefined. */
  readonly key?: string | IStorageKey
  /** Failed migration's source version; absent on unrelated failures. */
  readonly fromVersion?: number
  /** Failed migration's target version; absent on unrelated failures. */
  readonly toVersion?: number

  /**
   * Creates and freezes a contract failure. code is required; details defaults to an empty object.
   * message defaults to the storage-contract prefix followed by code. The original details.cause
   * stays reachable without changing its stack or identity; freezing does not freeze that cause.
   */
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
    if (details.fromVersion !== undefined) this.fromVersion = details.fromVersion
    if (details.toVersion !== undefined) this.toVersion = details.toVersion
    Object.freeze(this)
  }
}

/**
 * Checks local StorageContractError instance identity, rather than accepting a source/code
 * lookalike.
 */
export const isStorageContractError = (value: unknown): value is StorageContractError =>
  value instanceof StorageContractError
